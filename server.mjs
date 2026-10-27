// mindgap HTTP server. Contracts: CONTRACTS.md. No npm deps.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, appendFile, readdir, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listCourses, loadCourse, ensureState, createCourse, CourseNotFound, InvalidCourse } from './lib/courses.mjs';
import { getTutor, TUTORS } from './lib/tutors/index.mjs';
import { reviewTurn, applyPlan } from './lib/course-session.mjs';
import { SourceError, UPLOAD_MAX, validId, listSources, importSource, removeSource, sectionIds, readSections } from './lib/sources.mjs';
import { normalizeChapter, checkChapter } from './lib/chapters.mjs';
import { labStatus, labRequest, isApproved, approve, runLab, ApprovalMismatch } from './lib/labs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const PROMPTS_DIR = path.join(HERE, 'prompts');
const SCHEMAS = { course: 'course-schema.json', write: 'chapter-schema.json' };
const schemaFor = (mode) => path.join(PROMPTS_DIR, SCHEMAS[mode] ?? 'turn-schema.json');
const DATA_DIR = path.resolve(process.env.MINDGAP_DATA_DIR || path.join(HERE, 'learner'));
const COURSE_OPTS = {
  coursesDir: path.resolve(process.env.MINDGAP_COURSES_DIR || path.join(HERE, 'courses')),
  dataDir: DATA_DIR,
};
const PORT = Number(process.env.PORT ?? 4810);
const TUTOR = process.env.MINDGAP_TUTOR || 'claude';
if (!TUTORS.includes(TUTOR)) {
  console.error(`MINDGAP_TUTOR=${TUTOR} is not a tutor. Valid: ${TUTORS.join(', ')}`);
  process.exit(1);
}
const tutor = getTutor(TUTOR);
const MODEL = process.env.MINDGAP_MODEL || (TUTOR === 'claude' ? 'opus' : undefined);
// agy's default effort runs a teach turn past TUTOR_TIMEOUT_MS and medium took 168s; low took 12s. Claude ignores it.
const EFFORT = process.env.MINDGAP_EFFORT || (TUTOR === 'agy' ? 'low' : undefined);
const MODES = { teach: 'teacher.md', practice: 'practice.md', probe: 'prober.md', chapter: 'chapter.md', course: 'course.md', write: 'writer.md' };
const BODY_LIMIT = 256 * 1024;
const TUTOR_TIMEOUT_MS = 180_000;
export const CHAPTER_TIMEOUT_MS = 300_000;
const LAB_CMD_MAX = 4000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ponytail: in-memory lock, single process only; a second server instance would race.
const busy = new Set();
// ponytail: one map write chain per course serializes its read-modify-writes; per-file locks if this ever matters.
const mapChains = new Map();

class HttpError extends Error {
  // body, when given, replaces the default {error: message} response.
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readJson(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, `request body exceeds ${limit >= 1024 * 1024 ? `${Math.ceil(limit / (1024 * 1024))} MB` : `${Math.ceil(limit / 1024)} KB`}`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
        resolve(body);
      } catch {
        reject(new HttpError(400, 'invalid JSON body (expected an object)'));
      }
    });
    req.on('error', reject);
  });
}

async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function readLines(file) {
  const text = (await readOptional(file)) ?? '';
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Loads the course and creates its state dir (seeded map, sessions) on first access.
async function openCourse(slug) {
  let course;
  try {
    course = await loadCourse(COURSE_OPTS, slug);
  } catch (err) {
    if (err instanceof CourseNotFound) throw new HttpError(404, err.message);
    throw err;
  }
  await ensureState(course);
  return course;
}

const mapPath = (c) => path.join(c.stateDir, 'map.json');
const goalPath = (c) => path.join(c.stateDir, 'goal.json');
const propsPath = (c) => path.join(c.stateDir, 'propositions.jsonl');
const sessDir = (c) => path.join(c.stateDir, 'sessions');
const metaPath = (c, id) => path.join(sessDir(c), `${id}.meta.json`);
const transcriptPath = (c, id) => path.join(sessDir(c), `${id}.jsonl`);
const sourcesDir = (c) => path.join(DATA_DIR, 'courses', c.slug, 'sources');
const chapterPath = (c, id) => path.join(c.dir, 'chapters', `${id}.json`);

async function loadMap(c) {
  return JSON.parse(await readFile(mapPath(c), 'utf8'));
}

function updateMap(c, fn) {
  const prev = mapChains.get(c.slug) ?? Promise.resolve();
  const next = prev.then(async () => {
    const map = await loadMap(c);
    fn(map);
    await writeAtomic(mapPath(c), JSON.stringify(map, null, 2) + '\n');
  });
  mapChains.set(c.slug, next.catch(() => {}));
  return next;
}

function applyNodeUpdates(map, updates) {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  for (const u of updates) {
    const node = byId.get(u.id);
    if (!node) {
      console.warn(`node_update for unknown node ${u.id} ignored`);
      continue;
    }
    node.status = u.status;
    node.evidence = u.note;
  }
}

async function loadMeta(c, id) {
  if (!validId(id)) throw new HttpError(404, 'unknown lesson');
  try {
    return JSON.parse(await readFile(metaPath(c, id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new HttpError(404, 'unknown lesson');
    throw e;
  }
}

async function readEvents(c, id) {
  return readLines(transcriptPath(c, id));
}

async function appendRecords(c, id, records) {
  const ts = new Date().toISOString();
  await appendFile(transcriptPath(c, id), records.map((r) => JSON.stringify({ ts, ...r }) + '\n').join(''));
}

async function contextFor(c, map, nodeId, mode) {
  const ctx = await baseContext(c, map, nodeId, mode);
  // The tutor reviews checkpoints against the chapter the learner is reading, so it gets the source.
  if (mode === 'chapter') ctx.chapter_source = await readFile(chapterPath(c, nodeId), 'utf8');
  return ctx;
}

// {goal, background} from goal.json, either may be null; null when the learner has no goal file.
async function readLearner(c) {
  const text = await readOptional(goalPath(c));
  if (text === null) return null;
  let g;
  try {
    g = JSON.parse(text);
  } catch (e) {
    console.warn(`goal.json is not valid JSON, ignoring it: ${e.message}`);
    return null;
  }
  if (!g || typeof g !== 'object') return null;
  return { goal: g.goal ?? null, background: g.background ?? null };
}

// First message of a course session: the whole map, the learner so far, recent propositions.
async function courseContext(c, map) {
  const lines = await readLines(propsPath(c));
  return {
    mode: 'course',
    course: { slug: c.slug, title: c.title, layers: c.layers, generated: c.generated },
    learner: await readLearner(c),
    nodes: map.nodes.map((n) => ({
      id: n.id, title: n.title, layer: n.layer, prereqs: n.prereqs, truth: n.truth, status: n.status, evidence: n.evidence,
      ...(n.in_scope === false ? { in_scope: false } : {}),
      ...(n.source_sections?.length ? { source_sections: n.source_sections } : {}),
    })),
    propositions: lines.slice(-200),
    sources: (await listSources(sourcesDir(c))).map((s) => ({ id: s.id, title: s.title, sections: s.sections })),
  };
}

async function baseContext(c, map, nodeId, mode) {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const target = byId.get(nodeId);
  const prereqs = (target.prereqs ?? []).map((id) => byId.get(id)).filter(Boolean);
  const inScope = new Set([target.id, ...prereqs.map((n) => n.id)]);
  const propositions = (await readLines(propsPath(c))).filter((p) => inScope.has(p.node));
  // Lessons get the sections their node is tagged with (dangling ids skipped), up to the excerpt cap.
  const excerpts = target.source_sections?.length ? await readSections(sourcesDir(c), target.source_sections) : [];
  return {
    mode,
    learner: await readLearner(c),
    target,
    prereqs: prereqs.map((n) => ({ id: n.id, title: n.title, status: n.status })),
    other_nodes: map.nodes
      .filter((n) => !inScope.has(n.id))
      .map((n) => ({ id: n.id, title: n.title, status: n.status, ...(n.in_scope === false ? { in_scope: false } : {}) })),
    propositions,
    ...(excerpts.length ? { sources: excerpts } : {}),
  };
}

// Mode prompt, then the course's own prompt.md when it has one.
async function systemPrompt(c, mode) {
  const base = await readFile(path.join(PROMPTS_DIR, MODES[mode]), 'utf8');
  const course = await readOptional(path.join(c.dir, 'prompt.md'));
  return course === null ? base : base + '\n\n' + course;
}

// Every tutor call runs in a fresh empty cwd (holds the turn schema, no repo access), removed afterwards.
async function callTutor(c, meta, message, timeoutMs = TUTOR_TIMEOUT_MS) {
  const schema = await readFile(schemaFor(meta.mode), 'utf8');
  const sys = await systemPrompt(c, meta.mode);
  const cwd = await mkdtemp(path.join(tmpdir(), 'mindgap-turn-'));
  try {
    const schemaFile = path.join(cwd, 'turn-schema.json');
    await writeFile(schemaFile, schema);
    const run = async (msg, sessionId) => {
      const { bin, args } = tutor.buildCall({
        systemPrompt: sys, schemaText: schema, message: msg, sessionId, model: MODEL, effort: EFFORT, schemaFile,
      });
      const r = await new Promise((resolve) => {
        const child = execFile(bin, args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
          (e, o, s) => resolve({ err: e, stdout: o, stderr: s }));
        // An early-exiting tutor makes the write to stdin fail with EPIPE; that must not crash the server.
        child.stdin.on('error', () => {});
        child.stdin.end();
      });
      if (r.err && r.err.code === 'ENOENT') throw new HttpError(502, `${TUTOR} not found on PATH`);
      return { ...r, parsed: tutor.parseOutput(r.stdout ?? '') };
    };
    let { err, stderr, parsed } = await run(message, meta.tutor_session_id);
    // The adapter asks for one resume when a refused tool call ate the turn (agy).
    if (parsed.retry) ({ err, stderr, parsed } = await run(parsed.retry, parsed.sessionId));
    if (parsed.error) {
      const detail = (stderr || (err && err.message) || '').trim().slice(0, 500);
      throw new HttpError(502, detail ? `${parsed.error}: ${detail}` : parsed.error);
    }
    return parsed;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

// Calls the tutor, then persists everything. labsTotal = lab events the message has seen.
// event: the learner event this turn answers, null for the first turn.
async function advance(c, id, meta, message, record, labsTotal, event = null) {
  const called = await callTutor(c, meta, message);
  const { sessionId } = called;
  let turn = called.turn;
  const ts = new Date().toISOString();
  let accepted = false;
  if (meta.mode === 'course') {
    // The server keeps only what the acceptance rules allow; the reviewed turn is what gets stored and returned.
    const r = reviewTurn({
      meta, turn, map: await loadMap(c), event, sectionIds: await sectionIds(sourcesDir(c)),
      course: { generated: c.generated, layers: c.layers.map((l) => l.id) },
    });
    turn = r.turn;
    accepted = turn.approved;
    Object.assign(meta, r.meta);
    // Notes already sent in this message are spent; this turn's notes go out with the next one.
    meta.server_notes = r.notes;
  }

  meta.tutor_session_id = sessionId || meta.tutor_session_id || null;
  meta.labs_sent = labsTotal;
  // Build goal.json before touching the map, so nothing can throw after the trim is written.
  const goal = accepted && meta.goal
    ? { goal: meta.goal.text, background: meta.goal.background, approved_at: ts }
    : null;
  if (accepted && !goal) throw new Error('approval accepted without a goal on record');
  // New layers extend the course's own course.json (read fresh, every other key kept); built before any write.
  const newLayers = accepted ? meta.pending_plan.new_layers ?? [] : [];
  let courseJson = null;
  if (newLayers.length) {
    const cj = JSON.parse(await readFile(path.join(c.dir, 'course.json'), 'utf8'));
    cj.layers = [...(cj.layers ?? []), ...newLayers.map(({ id, name }) => ({ id, name }))];
    courseJson = JSON.stringify(cj, null, 2) + '\n';
  }
  await updateMap(c, (map) => {
    applyNodeUpdates(map, turn.node_updates ?? []);
    if (accepted) {
      const { in_scope, sources, new_nodes } = meta.pending_plan;
      Object.assign(map, applyPlan(map, in_scope, sources ?? [], new_nodes ?? []));
    }
  });
  if (courseJson) await writeAtomic(path.join(c.dir, 'course.json'), courseJson);
  if (goal) await writeAtomic(goalPath(c), JSON.stringify(goal, null, 2) + '\n');

  const props = turn.propositions ?? [];
  if (props.length) {
    await appendFile(propsPath(c), props.map((p) => JSON.stringify({ ...p, lesson_id: id, ts }) + '\n').join(''));
  }
  await appendRecords(c, id, record ? [record, { role: 'tutor', data: turn }] : [{ role: 'tutor', data: turn }]);
  await writeAtomic(metaPath(c, id), JSON.stringify(meta, null, 2));
  return turn;
}

async function startLesson(body) {
  const c = await openCourse(body.course);
  const { mode } = body;
  if (!Object.hasOwn(MODES, mode) || mode === 'chapter' || mode === 'write') {
    throw new HttpError(400, `mode must be one of: ${Object.keys(MODES).filter((m) => m !== 'chapter' && m !== 'write').join(', ')}`);
  }
  const map = await loadMap(c);
  if (mode === 'course') {
    // A course session spans the whole map, so any node_id is ignored.
    const lesson_id = `course-${Date.now()}`;
    const meta = { course: c.slug, tutor: TUTOR, tutor_session_id: null, node_id: null, mode, started: new Date().toISOString(), labs_sent: 0 };
    await writeAtomic(metaPath(c, lesson_id), JSON.stringify(meta, null, 2));
    const message = 'CONTEXT:\n' + JSON.stringify(await courseContext(c, map), null, 2);
    const turn = await advance(c, lesson_id, meta, message, { role: 'system', data: { type: 'start', node_id: null, mode } }, 0);
    return { lesson_id, turn };
  }
  const { node_id } = body;
  if (!validId(node_id)) throw new HttpError(400, 'node_id is required');
  if (!map.nodes.some((n) => n.id === node_id)) throw new HttpError(404, `unknown node: ${node_id}`);

  const lesson_id = `${node_id}-${Date.now()}`;
  const meta = { course: c.slug, tutor: TUTOR, tutor_session_id: null, node_id, mode, started: new Date().toISOString(), labs_sent: 0 };
  await writeAtomic(metaPath(c, lesson_id), JSON.stringify(meta, null, 2));

  const ctx = await contextFor(c, map, node_id, mode);
  const message = 'CONTEXT:\n' + JSON.stringify(ctx, null, 2);
  const turn = await advance(c, lesson_id, meta, message, { role: 'system', data: { type: 'start', node_id, mode } }, 0);
  return { lesson_id, turn };
}

async function turn(body) {
  const { lesson_id, event } = body;
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
    throw new HttpError(400, 'event.type is required');
  }
  if (busy.has(lesson_id)) throw new HttpError(409, 'a turn is already in flight for this lesson');
  busy.add(lesson_id);
  try {
    const c = await openCourse(body.course);
    const meta = await loadMeta(c, lesson_id);
    // Lessons predating the tutor field were all started with claude.
    const lessonTutor = meta.tutor ?? 'claude';
    if (lessonTutor !== TUTOR) {
      throw new HttpError(409, `lesson ${lesson_id} was started with ${lessonTutor}; this server runs ${TUTOR}`);
    }
    const labs = (await readEvents(c, lesson_id)).filter((e) => e.role === 'lab');
    const pending = labs.slice(meta.labs_sent ?? 0).map((e) => e.data);
    let message = 'EVENT:\n' + JSON.stringify(event, null, 2);
    // Notes from reviewing the previous turn go first; advance() clears them once this turn persists.
    // Sections the tutor asked for last turn; advance() replaces pending_reads, so they are sent once.
    if (meta.mode === 'course' && meta.pending_reads?.length) {
      const sections = await readSections(sourcesDir(c), meta.pending_reads);
      message = 'SOURCES:\n' + JSON.stringify(sections, null, 2) + '\n' + message;
    }
    if (meta.server_notes?.length) message = 'SERVER:\n' + meta.server_notes.map((n) => `- ${n}\n`).join('') + message;
    if (pending.length) message += '\nLAB_OUTPUT:\n' + JSON.stringify(pending, null, 2);
    // Chapter lessons start without a tutor call, so their first event carries the context.
    if (!meta.tutor_session_id && meta.mode === 'chapter') {
      const ctx = await contextFor(c, await loadMap(c), meta.node_id, 'chapter');
      message = 'CONTEXT:\n' + JSON.stringify(ctx, null, 2) + '\n' + message;
    }
    const record = { role: 'learner', data: event };
    // A checkpoint answer is the learner's evidence: keep it even if the tutor call fails.
    if (meta.mode === 'chapter') await appendRecords(c, lesson_id, [record]);
    const t = await advance(c, lesson_id, meta, message, meta.mode === 'chapter' ? null : record, labs.length, event);
    return { turn: t };
  } finally {
    busy.delete(lesson_id);
  }
}

async function lab(body) {
  const c = await openCourse(body.course);
  const { lesson_id, cmd } = body;
  await loadMeta(c, lesson_id);
  if (typeof cmd !== 'string' || cmd.trim() === '') throw new HttpError(400, 'cmd must be a non-empty string');
  if (cmd.length > LAB_CMD_MAX) throw new HttpError(400, `cmd exceeds ${LAB_CMD_MAX} characters`);
  const status = await labStatus(c);
  if (!status.available) throw new HttpError(503, status.reason);
  if (!(await isApproved(c))) {
    throw new HttpError(428, 'lab needs approval', { error: 'lab needs approval', request: labRequest(c) });
  }
  const r = await runLab(c, cmd);
  await appendRecords(c, lesson_id, [{ role: 'lab', data: { type: 'lab_output', cmd, ...r } }]);
  return r;
}

async function labApproval(slug, body) {
  const c = await openCourse(slug);
  try {
    await approve(c, body);
  } catch (err) {
    if (err instanceof ApprovalMismatch) throw new HttpError(400, err.message);
    throw err;
  }
}

// One chapter lesson per node: reuse the latest, else create it without calling the tutor.
async function chapterLesson(body) {
  const c = await openCourse(body.course);
  const { node_id } = body;
  if (!validId(node_id)) throw new HttpError(400, 'node_id is required');
  if ((await readOptional(chapterPath(c, node_id))) === null) {
    throw new HttpError(404, `no chapter for node: ${node_id}`);
  }
  // ponytail: scans every meta file; fine for hundreds of lessons, index by node if it grows.
  const ids = (await readdir(sessDir(c))).filter((f) => f.startsWith(`${node_id}-`) && f.endsWith('.meta.json'))
    .map((f) => f.slice(0, -'.meta.json'.length)).sort();
  for (const id of ids.reverse()) {
    const meta = await loadMeta(c, id);
    // A chapter lesson bound to another tutor is skipped, so a fresh one is created under this tutor.
    if (meta.mode === 'chapter' && meta.node_id === node_id && (meta.tutor ?? 'claude') === TUTOR) {
      return { lesson_id: id, meta, events: await readEvents(c, id) };
    }
  }
  const lesson_id = `${node_id}-${Date.now()}`;
  const meta = { course: c.slug, tutor: TUTOR, tutor_session_id: null, node_id, mode: 'chapter', started: new Date().toISOString(), labs_sent: 0 };
  await writeAtomic(metaPath(c, lesson_id), JSON.stringify(meta, null, 2));
  return { lesson_id, meta, events: [] };
}

// One tutor call writes one chapter: no session, nothing under sessions/. Invalid output is never stored.
async function writeChapter(slug, id) {
  if (!validId(id)) throw new HttpError(400, 'invalid node id');
  const c = await openCourse(slug);
  if (!c.generated) throw new HttpError(409, 'chapters are written only for generated courses');
  const map = await loadMap(c);
  const target = map.nodes.find((n) => n.id === id);
  if (!target) throw new HttpError(404, `unknown node: ${id}`);
  if ((await readOptional(chapterPath(c, id))) !== null) throw new HttpError(409, `chapter already exists: ${id}`);
  const key = `write:${c.slug}:${id}`;
  if (busy.has(key)) throw new HttpError(409, 'a chapter is already being written for this node');
  busy.add(key);
  try {
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const prereqs = (target.prereqs ?? []).map((p) => byId.get(p)).filter(Boolean);
    const inScope = new Set([target.id, ...prereqs.map((n) => n.id)]);
    const layer = c.layers.find((l) => l.id === target.layer);
    const excerpts = target.source_sections?.length ? await readSections(sourcesDir(c), target.source_sections) : [];
    const ctx = {
      mode: 'write',
      course: { slug: c.slug, title: c.title },
      learner: await readLearner(c),
      target: { id: target.id, title: target.title, layer: target.layer, layer_name: layer?.name ?? target.layer, truth: target.truth, prereqs: target.prereqs },
      prereqs: prereqs.map((n) => ({ id: n.id, title: n.title, status: n.status })),
      other_nodes: map.nodes.filter((n) => !inScope.has(n.id)).map((n) => ({ id: n.id, title: n.title })),
      ...(excerpts.length ? { sources: excerpts } : {}),
    };
    const { turn: raw } = await callTutor(c, { mode: 'write', tutor_session_id: null }, 'CONTEXT:\n' + JSON.stringify(ctx, null, 2), CHAPTER_TIMEOUT_MS);
    const indexFile = path.join(c.dir, 'chapters', 'index.json');
    const readIndex = async () => JSON.parse((await readOptional(indexFile)) ?? '[]');
    const chapter = normalizeChapter(raw, { node: id, number: (await readIndex()).length + 1, kicker: layer?.name ?? target.layer });
    const problem = checkChapter(chapter);
    if (problem) throw new HttpError(502, `chapter refused: ${problem}`);
    await mkdir(path.join(c.dir, 'chapters'), { recursive: true });
    await writeAtomic(chapterPath(c, id), JSON.stringify(chapter, null, 2) + '\n');
    const index = await readIndex();
    if (!index.includes(id)) index.push(id);
    await writeAtomic(indexFile, JSON.stringify(index, null, 2) + '\n');
    return { node: id };
  } finally {
    busy.delete(key);
  }
}

async function getLesson(c, id) {
  const meta = await loadMeta(c, id);
  return { meta, events: await readEvents(c, id) };
}

async function courseInfo(slug) {
  const c = await openCourse(slug);
  const course = JSON.parse(await readFile(path.join(c.dir, 'course.json'), 'utf8'));
  const index = await readOptional(path.join(c.dir, 'chapters', 'index.json'));
  let lab;
  try {
    lab = { ...(await labStatus(c)), request: labRequest(c), approved: await isApproved(c) };
  } catch (err) {
    // A malformed lab block must not take the course page down; the reason says what to fix.
    lab = { available: false, reason: err.message };
  }
  return { ...course, chapters: index === null ? [] : JSON.parse(index), lab };
}

async function getChapter(slug, id) {
  const c = await openCourse(slug);
  const text = validId(id) ? await readOptional(chapterPath(c, id)) : null;
  if (text === null) throw new HttpError(404, 'no such chapter');
  return JSON.parse(text);
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

// Cross-site guard: a browser page on another origin can send text/plain POSTs and reach 127.0.0.1, but it
// cannot make the Host header say our port, and a JSON POST needs a CORS preflight it will not get.
function checkRequest(req) {
  const port = server.address().port;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) throw new HttpError(403, 'forbidden host');
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (req.method === 'POST' && type !== 'application/json') throw new HttpError(415, 'content-type must be application/json');
}

async function api(req, res, pathname) {
  checkRequest(req);
  const method = req.method;
  const query = new URLSearchParams(req.url.split('?')[1] ?? '');
  const lessonM = pathname.match(/^\/api\/lesson\/([^/]+)$/);
  const mapM = pathname.match(/^\/api\/courses\/([^/]+)\/map$/);
  const chapterM = pathname.match(/^\/api\/courses\/([^/]+)\/chapters\/([^/]+)$/);
  const writeM = pathname.match(/^\/api\/courses\/([^/]+)\/chapters\/([^/]+)\/write$/);
  const approvalM = pathname.match(/^\/api\/courses\/([^/]+)\/lab-approval$/);
  const sourcesM = pathname.match(/^\/api\/courses\/([^/]+)\/sources$/);
  const sourceM = pathname.match(/^\/api\/courses\/([^/]+)\/sources\/([^/]+)$/);
  const courseM = pathname.match(/^\/api\/courses\/([^/]+)$/);
  if (method === 'GET' && pathname === '/api/courses') return send(res, 200, await listCourses(COURSE_OPTS));
  if (method === 'POST' && pathname === '/api/courses') {
    try {
      return send(res, 201, await createCourse(COURSE_OPTS, await readJson(req)));
    } catch (err) {
      if (err instanceof InvalidCourse) throw new HttpError(400, err.message);
      throw err;
    }
  }
  if (method === 'GET' && courseM) return send(res, 200, await courseInfo(safeDecode(courseM[1])));
  if (method === 'GET' && mapM) return send(res, 200, await loadMap(await openCourse(safeDecode(mapM[1]))));
  if (method === 'GET' && chapterM) return send(res, 200, await getChapter(safeDecode(chapterM[1]), safeDecode(chapterM[2])));
  if (method === 'POST' && writeM) return send(res, 201, await writeChapter(safeDecode(writeM[1]), safeDecode(writeM[2])));
  if (method === 'GET' && lessonM) {
    return send(res, 200, await getLesson(await openCourse(query.get('course')), safeDecode(lessonM[1])));
  }
  if (method === 'GET' && sourcesM) return send(res, 200, await listSources(sourcesDir(await openCourse(safeDecode(sourcesM[1])))));
  if (method === 'POST' && sourcesM) return send(res, 201, await addSource(safeDecode(sourcesM[1]), req));
  if (method === 'DELETE' && sourceM) {
    const c = await openCourse(safeDecode(sourceM[1]));
    if (!(await removeSource(sourcesDir(c), safeDecode(sourceM[2])))) throw new HttpError(404, 'unknown source');
    res.writeHead(204);
    return res.end();
  }
  if (method === 'POST' && pathname === '/api/lesson') return send(res, 200, await startLesson(await readJson(req)));
  if (method === 'POST' && pathname === '/api/chapter') return send(res, 200, await chapterLesson(await readJson(req)));
  if (method === 'POST' && pathname === '/api/turn') return send(res, 200, await turn(await readJson(req)));
  if (method === 'POST' && pathname === '/api/lab') return send(res, 200, await lab(await readJson(req)));
  if (method === 'POST' && approvalM) {
    await labApproval(safeDecode(approvalM[1]), await readJson(req));
    res.writeHead(204);
    return res.end();
  }
  throw new HttpError(404, 'not found');
}

const UPLOAD_BODY_LIMIT = Math.ceil(UPLOAD_MAX * 4 / 3) + 64 * 1024;

async function addSource(slug, req) {
  const c = await openCourse(slug);
  const body = await readJson(req, UPLOAD_BODY_LIMIT);
  const hasUrl = body.url !== undefined;
  const hasData = body.data_base64 !== undefined;
  if (hasUrl === hasData) throw new HttpError(400, 'send exactly one of url or data_base64');
  if (hasUrl) {
    if (typeof body.url !== 'string') throw new HttpError(400, 'url must be a string');
    return importSource(sourcesDir(c), { url: body.url });
  }
  if (typeof body.data_base64 !== 'string' || typeof body.filename !== 'string' || !body.filename) {
    throw new HttpError(400, 'data_base64 and filename must be strings');
  }
  return importSource(sourcesDir(c), { filename: body.filename, data: Buffer.from(body.data_base64, 'base64') });
}

async function serveStatic(res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(404, 'not found');
  }
  if (rel.includes('\0')) throw new HttpError(404, 'not found');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'not found');
  let body;
  try {
    body = await readFile(file);
  } catch {
    throw new HttpError(404, 'not found');
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'content-length': body.length,
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    // Raw path, not new URL(): WHATWG URL would normalise %2e%2e before our guard sees it.
    const pathname = req.url.split('?')[0];
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
    return await serveStatic(res, pathname);
  } catch (e) {
    let err = e;
    if (err instanceof SourceError) err = new HttpError(err.status, err.message, err.body);
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, err.body ?? { error: err.message || 'internal error' });
    else res.end();
  }
});

if (existsSync(path.join(DATA_DIR, 'map.json'))) {
  console.error(`Old data layout found in ${DATA_DIR}. Run: node scripts/migrate-learner-v1.mjs`);
  process.exit(1);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mindgap listening on http://127.0.0.1:${server.address().port}`);
});
