// mindgap HTTP server. Contracts: CONTRACTS.md. No npm deps.
import { createServer } from 'node:http';
import { readFile, writeFile, rename, appendFile, mkdir, readdir, copyFile, constants } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const PROMPTS_DIR = path.join(HERE, 'prompts');
const SCHEMA_PATH = path.join(PROMPTS_DIR, 'turn-schema.json');
const DATA_DIR = path.resolve(process.env.MINDGAP_DATA_DIR || path.join(HERE, 'learner'));
const SEED_PATH = path.join(HERE, 'courses', 'networking', 'map.seed.json');
const MAP_PATH = path.join(DATA_DIR, 'map.json');
const PROPS_PATH = path.join(DATA_DIR, 'propositions.jsonl');
const SESS_DIR = path.join(DATA_DIR, 'sessions');
const PORT = Number(process.env.PORT ?? 4810);
const MODEL = process.env.MINDGAP_MODEL || 'opus';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const ORB_BIN = process.env.ORB_BIN || 'orb';
const MODES = { teach: 'teacher.md', practice: 'practice.md', probe: 'prober.md', chapter: 'chapter.md' };
const CHAPTERS_DIR = path.join(PUBLIC_DIR, 'chapters');
const BODY_LIMIT = 256 * 1024;
const TUTOR_TIMEOUT_MS = 180_000;
const LAB_TIMEOUT_MS = 30_000;
const LAB_CAP = 64 * 1024;
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
// ponytail: global lock serializes all map.json read-modify-writes; per-file locks if this ever matters.
let mapChain = Promise.resolve();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > BODY_LIMIT) {
        failed = true;
        reject(new HttpError(413, 'request body exceeds 256 KB'));
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

async function readLines(file) {
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

const metaPath = (id) => path.join(SESS_DIR, `${id}.meta.json`);
const transcriptPath = (id) => path.join(SESS_DIR, `${id}.jsonl`);

async function loadMap() {
  return JSON.parse(await readFile(MAP_PATH, 'utf8'));
}

function updateMap(fn) {
  const next = mapChain.then(async () => {
    const map = await loadMap();
    fn(map);
    await writeAtomic(MAP_PATH, JSON.stringify(map, null, 2) + '\n');
  });
  mapChain = next.catch(() => {});
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

async function loadMeta(id) {
  if (!validId(id)) throw new HttpError(404, 'unknown lesson');
  try {
    return JSON.parse(await readFile(metaPath(id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new HttpError(404, 'unknown lesson');
    throw e;
  }
}

async function readEvents(id) {
  return readLines(transcriptPath(id));
}

async function appendRecords(id, records) {
  const ts = new Date().toISOString();
  await appendFile(transcriptPath(id), records.map((r) => JSON.stringify({ ts, ...r }) + '\n').join(''));
}

async function contextFor(map, nodeId, mode) {
  const ctx = await baseContext(map, nodeId, mode);
  // The tutor reviews checkpoints against the chapter the learner is reading, so it gets the source.
  if (mode === 'chapter') ctx.chapter_source = await readFile(path.join(CHAPTERS_DIR, `${nodeId}.js`), 'utf8');
  return ctx;
}

async function baseContext(map, nodeId, mode) {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const target = byId.get(nodeId);
  const prereqs = (target.prereqs ?? []).map((id) => byId.get(id)).filter(Boolean);
  const inScope = new Set([target.id, ...prereqs.map((n) => n.id)]);
  const propositions = (await readLines(PROPS_PATH)).filter((p) => inScope.has(p.node));
  return {
    mode,
    target,
    prereqs: prereqs.map((n) => ({ id: n.id, title: n.title, status: n.status })),
    other_nodes: map.nodes
      .filter((n) => !inScope.has(n.id))
      .map((n) => ({ id: n.id, title: n.title, status: n.status })),
    propositions,
  };
}

async function callTutor(meta, message) {
  const schema = await readFile(SCHEMA_PATH, 'utf8');
  const args = [
    '-p', '--safe-mode', '--tools', '', '--model', MODEL,
    '--output-format', 'json', '--json-schema', schema,
    '--system-prompt-file', path.join(PROMPTS_DIR, MODES[meta.mode]),
  ];
  if (meta.claude_session_id) args.push('--resume', meta.claude_session_id);
  args.push(message);

  const { err, stdout, stderr } = await new Promise((resolve) =>
    execFile(CLAUDE_BIN, args, { timeout: TUTOR_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (e, o, s) => resolve({ err: e, stdout: o, stderr: s })));

  let out;
  try {
    out = JSON.parse(stdout);
  } catch {
    const why = err ? err.message : (stderr || stdout || 'empty output').trim();
    throw new HttpError(502, `tutor returned no JSON: ${why}`);
  }
  if (out.is_error || !out.structured_output) {
    throw new HttpError(502, String(out.result ?? 'tutor returned no structured_output'));
  }
  return out;
}

// Calls the tutor, then persists everything. labsTotal = lab events the message has seen.
async function advance(id, meta, message, record, labsTotal) {
  const out = await callTutor(meta, message);
  const turn = out.structured_output;
  const ts = new Date().toISOString();

  meta.claude_session_id = out.session_id || meta.claude_session_id || null;
  meta.labs_sent = labsTotal;
  await updateMap((map) => applyNodeUpdates(map, turn.node_updates ?? []));

  const props = turn.propositions ?? [];
  if (props.length) {
    await appendFile(PROPS_PATH, props.map((p) => JSON.stringify({ ...p, lesson_id: id, ts }) + '\n').join(''));
  }
  await appendRecords(id, record ? [record, { role: 'tutor', data: turn }] : [{ role: 'tutor', data: turn }]);
  await writeAtomic(metaPath(id), JSON.stringify(meta, null, 2));
  return turn;
}

async function startLesson(body) {
  const { node_id, mode } = body;
  if (!validId(node_id)) throw new HttpError(400, 'node_id is required');
  if (!Object.hasOwn(MODES, mode) || mode === 'chapter') {
    throw new HttpError(400, `mode must be one of: ${Object.keys(MODES).join(', ')}`);
  }
  const map = await loadMap();
  if (!map.nodes.some((n) => n.id === node_id)) throw new HttpError(404, `unknown node: ${node_id}`);

  const lesson_id = `${node_id}-${Date.now()}`;
  await mkdir(SESS_DIR, { recursive: true });
  const meta = { claude_session_id: null, node_id, mode, started: new Date().toISOString(), labs_sent: 0 };
  await writeAtomic(metaPath(lesson_id), JSON.stringify(meta, null, 2));

  const ctx = await contextFor(map, node_id, mode);
  const message = 'CONTEXT:\n' + JSON.stringify(ctx, null, 2);
  const turn = await advance(lesson_id, meta, message, { role: 'system', data: { type: 'start', node_id, mode } }, 0);
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
    const meta = await loadMeta(lesson_id);
    const labs = (await readEvents(lesson_id)).filter((e) => e.role === 'lab');
    const pending = labs.slice(meta.labs_sent ?? 0).map((e) => e.data);
    let message = 'EVENT:\n' + JSON.stringify(event, null, 2);
    if (pending.length) message += '\nLAB_OUTPUT:\n' + JSON.stringify(pending, null, 2);
    // Chapter lessons start without a tutor call, so their first event carries the context.
    if (!meta.claude_session_id && meta.mode === 'chapter') {
      message = 'CONTEXT:\n' + JSON.stringify(await contextFor(await loadMap(), meta.node_id, 'chapter'), null, 2) + '\n' + message;
    }
    const record = { role: 'learner', data: event };
    // A checkpoint answer is the learner's evidence: keep it even if the tutor call fails.
    if (meta.mode === 'chapter') await appendRecords(lesson_id, [record]);
    const t = await advance(lesson_id, meta, message, meta.mode === 'chapter' ? null : record, labs.length);
    return { turn: t };
  } finally {
    busy.delete(lesson_id);
  }
}

function capture(stream) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  stream.on('data', (c) => {
    const room = LAB_CAP - size;
    if (c.length > room) truncated = true;
    if (room > 0) {
      const part = c.subarray(0, Math.min(room, c.length));
      chunks.push(part);
      size += part.length;
    }
  });
  return {
    text: () => Buffer.concat(chunks).toString('utf8') + (truncated ? '\n[output truncated at 64 KB]' : ''),
  };
}

function runOrb(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn(ORB_BIN, ['-m', 'netlab', '-u', 'root', 'bash', '-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = capture(child.stdout);
    const err = capture(child.stderr);
    let timedOut = false;
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        stdout: out.text(),
        stderr: err.text() + (timedOut ? `\n[killed after ${LAB_TIMEOUT_MS / 1000} s]` : ''),
        code: timedOut ? null : code,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      finish(null);
    }, LAB_TIMEOUT_MS);
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', finish);
  });
}

async function lab(body) {
  const { lesson_id, cmd } = body;
  await loadMeta(lesson_id);
  if (typeof cmd !== 'string' || cmd.trim() === '') throw new HttpError(400, 'cmd must be a non-empty string');
  if (cmd.length > LAB_CMD_MAX) throw new HttpError(400, `cmd exceeds ${LAB_CMD_MAX} characters`);
  const r = await runOrb(cmd);
  await appendRecords(lesson_id, [{ role: 'lab', data: { type: 'lab_output', cmd, ...r } }]);
  return r;
}

// One chapter lesson per node: reuse the latest, else create it without calling the tutor.
async function chapterLesson(body) {
  const { node_id } = body;
  if (!validId(node_id)) throw new HttpError(400, 'node_id is required');
  try {
    await readFile(path.join(CHAPTERS_DIR, `${node_id}.js`));
  } catch {
    throw new HttpError(404, `no chapter for node: ${node_id}`);
  }
  await mkdir(SESS_DIR, { recursive: true });
  // ponytail: scans every meta file; fine for hundreds of lessons, index by node if it grows.
  const ids = (await readdir(SESS_DIR)).filter((f) => f.startsWith(`${node_id}-`) && f.endsWith('.meta.json'))
    .map((f) => f.slice(0, -'.meta.json'.length)).sort();
  for (const id of ids.reverse()) {
    const meta = await loadMeta(id);
    if (meta.mode === 'chapter' && meta.node_id === node_id) return { lesson_id: id, meta, events: await readEvents(id) };
  }
  const lesson_id = `${node_id}-${Date.now()}`;
  const meta = { claude_session_id: null, node_id, mode: 'chapter', started: new Date().toISOString(), labs_sent: 0 };
  await writeAtomic(metaPath(lesson_id), JSON.stringify(meta, null, 2));
  return { lesson_id, meta, events: [] };
}

async function getLesson(id) {
  const meta = await loadMeta(id);
  return { meta, events: await readEvents(id) };
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

async function api(req, res, pathname) {
  const m = pathname.match(/^\/api\/lesson\/([^/]+)$/);
  const method = req.method;
  if (method === 'GET' && pathname === '/api/map') return send(res, 200, await loadMap());
  if (method === 'GET' && m) return send(res, 200, await getLesson(safeDecode(m[1])));
  if (method === 'POST' && pathname === '/api/lesson') return send(res, 200, await startLesson(await readJson(req)));
  if (method === 'POST' && pathname === '/api/chapter') return send(res, 200, await chapterLesson(await readJson(req)));
  if (method === 'POST' && pathname === '/api/turn') return send(res, 200, await turn(await readJson(req)));
  if (method === 'POST' && pathname === '/api/lab') return send(res, 200, await lab(await readJson(req)));
  throw new HttpError(404, 'not found');
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
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: err.message || 'internal error' });
    else res.end();
  }
});

// First run: start from the clean seed map. COPYFILE_EXCL never overwrites a learner's progress.
await mkdir(DATA_DIR, { recursive: true });
await copyFile(SEED_PATH, MAP_PATH, constants.COPYFILE_EXCL).catch((e) => {
  if (e.code !== 'EEXIST') throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mindgap listening on http://127.0.0.1:${server.address().port}`);
});
