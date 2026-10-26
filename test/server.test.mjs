// Self-check for server.mjs. Runs the real server against fake claude/agy/docker binaries.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');
const CONTRACTS = path.join(HERE, '..', 'CONTRACTS.md');
const PROMPTS = path.join(HERE, '..', 'prompts');
const EVENT_PREFIX = 'EVENT:\n';
const CONTEXT_PREFIX = 'CONTEXT:\n';

const MAP = {
  nodes: [
    { id: 'frames-mac', title: 'Frames carry MAC', layer: 'L2', prereqs: [], truth: 't', twins: {}, lab: '', sim: null, sources: [], status: 'gap', evidence: '' },
    { id: 'switch-mac-table', title: 'Switch: MAC to port', layer: 'L2', prereqs: ['frames-mac'], truth: 't', twins: {}, lab: '', sim: 'switch-learning', sources: [], status: 'untested', evidence: '' },
    { id: 'vlan-basics', title: 'VLANs', layer: 'L2', prereqs: [], truth: 't', twins: {}, lab: '', sim: null, sources: [], status: 'untested', evidence: '' },
  ],
};

const CHAPTER = { node: 'switch-mac-table', title: 'Switch chapter' };

// Fake claude: logs argv, returns canned structured_output. control file: ok | slow | error.
const FAKE_CLAUDE = `
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
appendFileSync(path.join(dir, 'claude-calls.jsonl'), JSON.stringify(args) + '\\n');
const ctl = path.join(dir, 'control');
const control = existsSync(ctl) ? readFileSync(ctl, 'utf8').trim() : 'ok';
const message = args[args.length - 1];
const turn = message.startsWith('CONTEXT:')
  ? { say: 'hi', question: null, sim: null, lab: null, lesson_done: false,
      node_updates: [{ id: 'switch-mac-table', status: 'shaky', note: 'said IP to MAC' }],
      propositions: [{ claim: 'Switch learns MAC from source', because: ['frames-mac'], node: 'switch-mac-table' }] }
  : { say: 'next', question: null, sim: null, lab: null, lesson_done: false,
      node_updates: [{ id: 'frames-mac', status: 'solid', note: 'answered correctly' }],
      propositions: [{ claim: 'Frames carry src and dst MAC', because: [], node: 'frames-mac' }] };
const reply = control === 'error'
  ? { type: 'result', is_error: true, result: 'rate limited boom', session_id: 'sess-err' }
  : { type: 'result', is_error: false, session_id: 'sess-abc', structured_output: turn, total_cost_usd: 0 };
setTimeout(() => process.stdout.write(JSON.stringify(reply)), control === 'slow' ? 800 : 0);
`;

// Fake docker: logs argv to docker-calls.jsonl, keeps image and container state in docker-state.json.
// exec with sh is the /proc/sys/net remount; any other exec echoes its argv.
const FAKE_DOCKER = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
appendFileSync(path.join(dir, 'docker-calls.jsonl'), JSON.stringify(args) + '\\n');
const sf = path.join(dir, 'docker-state.json');
const st = existsSync(sf) ? JSON.parse(readFileSync(sf, 'utf8')) : { images: {}, containers: {} };
const save = () => writeFileSync(sf, JSON.stringify(st));
const cmd = args[0];
if (cmd === 'info') process.exit(0);
if (cmd === 'image') process.exit(st.images[args[2]] ? 0 : 1);
if (cmd === 'build') { st.images[args[2]] = true; save(); process.exit(0); }
if (cmd === 'inspect') {
  const state = st.containers[args.at(-1)];
  if (!state) process.exit(1);
  process.stdout.write((state === 'running' ? 'true' : 'false') + '\\n');
  process.exit(0);
}
if (cmd === 'run') { st.containers[args[args.indexOf('--name') + 1]] = 'running'; save(); process.exit(0); }
if (cmd === 'start') { st.containers[args[1]] = 'running'; save(); process.exit(0); }
if (cmd === 'exec') {
  if (args[2] === 'sh') process.exit(0);
  process.stdout.write('EXEC:' + args.slice(1).join(' '));
} else {
  process.exitCode = 2;
}
`;

// Fake agy: logs argv, cwd and whether the turn schema sits in cwd; always returns the same canned turn.
const FAKE_AGY = `
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
const cwd = process.cwd();
appendFileSync(path.join(dir, 'agy-calls.jsonl'), JSON.stringify({ args, cwd, schema: existsSync(path.join(cwd, 'turn-schema.json')) }) + '\\n');
const turn = { say: 'hi from agy', question: null, sim: null, lab: null, lesson_done: false, node_updates: [], propositions: [] };
process.stdout.write(JSON.stringify({ conversation_id: 'conv-1', structured_output: turn }));
`;

let dir;
let dataDir;
let child;
let port;
let lessonId;

function call(method, urlPath, body, at = port) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {};
    const req = http.request({ host: '127.0.0.1', port: at, method, path: urlPath, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function readCalls() {
  const text = await readFile(path.join(dir, 'claude-calls.jsonl'), 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function readAgyCalls() {
  const text = await readFile(path.join(dir, 'agy-calls.jsonl'), 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const setControl = (v) => writeFile(path.join(dir, 'control'), v);

async function readJsonl(file) {
  const text = await readFile(file, 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const stateDir = () => path.join(dataDir, 'courses', 'net', 'state');

// Resolves with the child's exit code; kills it and fails if it has not exited within ms.
function exitWithin(srv, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      srv.kill();
      reject(new Error(`server did not exit within ${ms} ms`));
    }, ms);
    srv.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function startServer(env) {
  const srv = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: '0', MINDGAP_COURSES_DIR: path.join(dir, 'courses'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  srv.stderr.on('data', (c) => (stderr += c));
  const port = new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      srv.kill();
      reject(new Error(`server did not listen within 10 s: ${stderr}`));
    }, 10_000);
    srv.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    srv.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}: ${stderr}`));
    });
  });
  return { srv, port };
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mindgap-test-'));
  dataDir = path.join(dir, 'data');
  const courseDir = path.join(dir, 'courses', 'net');
  await mkdir(path.join(courseDir, 'chapters'), { recursive: true });
  // A lab with no extra privileges, so it runs without approval.
  await writeFile(path.join(courseDir, 'course.json'), JSON.stringify({ slug: 'net', title: 'Net', layers: [{ id: 'L2', name: 'L2' }], lab: { dockerfile: 'lab/Dockerfile', caps: [], network: false, hostname: 'netlab' } }));
  await writeFile(path.join(courseDir, 'map.seed.json'), JSON.stringify(MAP, null, 2));
  await writeFile(path.join(courseDir, 'prompt.md'), 'COURSE-PROMPT-MARKER');
  await writeFile(path.join(courseDir, 'chapters', 'index.json'), JSON.stringify(['switch-mac-table']));
  await writeFile(path.join(courseDir, 'chapters', 'switch-mac-table.json'), JSON.stringify(CHAPTER));

  const claudeJs = path.join(dir, 'fake-claude.mjs');
  const dockerJs = path.join(dir, 'fake-docker.mjs');
  const agyJs = path.join(dir, 'fake-agy.mjs');
  await writeFile(claudeJs, FAKE_CLAUDE);
  await writeFile(dockerJs, FAKE_DOCKER);
  await writeFile(agyJs, FAKE_AGY);
  const claudeBin = path.join(dir, 'claude');
  const dockerBin = path.join(dir, 'docker');
  const agyBin = path.join(dir, 'agy');
  await writeFile(claudeBin, `#!/bin/sh\nexec "${process.execPath}" "${claudeJs}" "$@"\n`);
  await writeFile(dockerBin, `#!/bin/sh\nexec "${process.execPath}" "${dockerJs}" "$@"\n`);
  await writeFile(agyBin, `#!/bin/sh\nexec "${process.execPath}" "${agyJs}" "$@"\n`);
  await chmod(claudeBin, 0o755);
  await chmod(dockerBin, 0o755);
  await chmod(agyBin, 0o755);

  const started = startServer({
    MINDGAP_DATA_DIR: dataDir,
    MINDGAP_MODEL: 'opus',
    MINDGAP_TUTOR: 'claude',
    CLAUDE_BIN: claudeBin,
    AGY_BIN: agyBin,
    DOCKER_BIN: dockerBin,
    FAKE_DIR: dir,
  });
  child = started.srv;
  port = await started.port;
});

after(async () => {
  if (child) child.kill();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('GET /api/courses lists the course', async () => {
  const r = await call('GET', '/api/courses');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, [{ slug: 'net', title: 'Net' }]);
});

test('GET /api/courses/net returns course.json plus its chapter index', async () => {
  const r = await call('GET', '/api/courses/net');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.title, 'Net');
  assert.deepEqual(r.json.chapters, ['switch-mac-table']);
});

test('chapter JSON is served by course and id; absent chapters are 404', async () => {
  const r = await call('GET', '/api/courses/net/chapters/switch-mac-table');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, CHAPTER);
  assert.equal((await call('GET', '/api/courses/net/chapters/vlan-basics')).status, 404);
});

test('bad or unknown course slugs are 404 on every course route', async () => {
  for (const p of ['/api/courses/..%2fnet/map', '/api/courses/%2e%2e/map', '/api/courses/nope/map', '/api/courses/..%2fnet']) {
    const r = await call('GET', p);
    assert.equal(r.status, 404, p);
  }
  const lesson = await call('POST', '/api/lesson', { course: '../net', node_id: 'switch-mac-table', mode: 'teach' });
  assert.equal(lesson.status, 404, lesson.text);
});

test('lesson start and turn: argv, node_update applied, proposition appended', async () => {
  const start = await call('POST', '/api/lesson', { course: 'net', node_id: 'switch-mac-table', mode: 'teach' });
  assert.equal(start.status, 200, start.text);
  lessonId = start.json.lesson_id;
  assert.match(lessonId, /^switch-mac-table-\d+$/);
  assert.equal(start.json.turn.say, 'hi');

  const first = (await readCalls()).at(-1);
  assert.deepEqual(first.slice(0, 4), ['-p', '--safe-mode', '--tools', '']);
  assert.equal(first[first.indexOf('--model') + 1], 'opus');
  assert.ok(!first.includes('--resume'));
  assert.ok(!first.includes('--system-prompt-file'));
  const sys = first[first.indexOf('--system-prompt') + 1];
  assert.ok(sys.includes('COURSE-PROMPT-MARKER'));
  assert.ok(sys.startsWith(await readFile(path.join(PROMPTS, 'teacher.md'), 'utf8')));
  const message = first.at(-1);
  assert.ok(message.startsWith(CONTEXT_PREFIX));
  const ctx = JSON.parse(message.slice(CONTEXT_PREFIX.length));
  assert.equal(ctx.target.id, 'switch-mac-table');
  assert.deepEqual(ctx.prereqs, [{ id: 'frames-mac', title: 'Frames carry MAC', status: 'gap' }]);
  assert.deepEqual(ctx.other_nodes.map((n) => n.id), ['vlan-basics']);

  const map = await call('GET', '/api/courses/net/map');
  const node = map.json.nodes.find((n) => n.id === 'switch-mac-table');
  assert.equal(node.status, 'shaky');
  assert.equal(node.evidence, 'said IP to MAC');

  const props = await readJsonl(path.join(stateDir(), 'propositions.jsonl'));
  assert.equal(props.length, 1);
  assert.equal(props[0].claim, 'Switch learns MAC from source');
  assert.equal(props[0].lesson_id, lessonId);
  assert.ok(props[0].ts);

  const t = await call('POST', '/api/turn', { course: 'net', lesson_id: lessonId, event: { type: 'answer', choice: 'A', confidence: 4 } });
  assert.equal(t.status, 200, t.text);
  assert.equal(t.json.turn.say, 'next');

  const second = (await readCalls()).at(-1);
  assert.equal(second[second.indexOf('--resume') + 1], 'sess-abc');
  assert.ok(second.at(-1).startsWith(EVENT_PREFIX));
  assert.equal(JSON.parse(second.at(-1).slice(EVENT_PREFIX.length)).type, 'answer');

  const map2 = await call('GET', '/api/courses/net/map');
  assert.equal(map2.json.nodes.find((n) => n.id === 'frames-mac').status, 'solid');
  assert.equal((await readJsonl(path.join(stateDir(), 'propositions.jsonl'))).length, 2);

  const lesson = await call('GET', `/api/lesson/${lessonId}?course=net`);
  assert.equal(lesson.status, 200);
  assert.equal(lesson.json.meta.course, 'net');
  assert.equal(lesson.json.meta.tutor, 'claude');
  assert.equal(lesson.json.meta.tutor_session_id, 'sess-abc');
  assert.ok(!('claude_session_id' in lesson.json.meta));
  assert.deepEqual(lesson.json.events.map((e) => e.role), ['system', 'tutor', 'learner', 'tutor']);
});

test('lesson lookup needs a valid course', async () => {
  assert.equal((await call('GET', `/api/lesson/${lessonId}`)).status, 404);
  assert.equal((await call('GET', `/api/lesson/${lessonId}?course=nope`)).status, 404);
});

test('second concurrent turn on the same lesson gets 409', async () => {
  await setControl('slow');
  try {
    const [a, b] = await Promise.all([
      call('POST', '/api/turn', { course: 'net', lesson_id: lessonId, event: { type: 'lost' } }),
      call('POST', '/api/turn', { course: 'net', lesson_id: lessonId, event: { type: 'lost' } }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  } finally {
    await setControl('ok');
  }
});

test('lab output is recorded and included in the next tutor message only', async () => {
  const lab = await call('POST', '/api/lab', { course: 'net', lesson_id: lessonId, cmd: 'ip -br link' });
  assert.equal(lab.status, 200, lab.text);
  assert.equal(lab.json.code, 0);
  assert.match(lab.json.stdout, /EXEC:mindgap-net bash -lc ip -br link/);

  const t = await call('POST', '/api/turn', { course: 'net', lesson_id: lessonId, event: { type: 'lost', text: '?' } });
  assert.equal(t.status, 200, t.text);
  const withLab = (await readCalls()).at(-1).at(-1);
  assert.ok(withLab.startsWith(EVENT_PREFIX));
  assert.match(withLab, /LAB_OUTPUT/);
  assert.ok(withLab.includes('ip -br link'));
  assert.ok(withLab.includes('EXEC:'));

  await call('POST', '/api/turn', { course: 'net', lesson_id: lessonId, event: { type: 'ask', text: 'why' } });
  const withoutLab = (await readCalls()).at(-1).at(-1);
  assert.ok(!withoutLab.includes('LAB_OUTPUT'));

  const lesson = await call('GET', `/api/lesson/${lessonId}?course=net`);
  assert.ok(lesson.json.events.some((e) => e.role === 'lab' && e.data.type === 'lab_output' && e.data.cmd === 'ip -br link'));
});

test('lab with extra privileges: 428 until approved, 400 for a mismatched approval, then runs with the approved request', async () => {
  // Created here, not in before(): the course list test pins the set of courses.
  const capDir = path.join(dir, 'courses', 'capnet');
  await mkdir(capDir, { recursive: true });
  await writeFile(path.join(capDir, 'course.json'), JSON.stringify({ slug: 'capnet', title: 'Capnet', layers: [{ id: 'L2', name: 'L2' }], lab: { dockerfile: 'lab/Dockerfile', caps: ['NET_ADMIN'], network: true, hostname: 'netlab' } }));
  await writeFile(path.join(capDir, 'map.seed.json'), JSON.stringify(MAP, null, 2));
  const started = await call('POST', '/api/lesson', { course: 'capnet', node_id: 'frames-mac', mode: 'teach' });
  assert.equal(started.status, 200, started.text);
  const id = started.json.lesson_id;

  const info = await call('GET', '/api/courses/capnet');
  assert.equal(info.json.lab.available, true);
  assert.equal(info.json.lab.approved, false);
  assert.deepEqual(info.json.lab.request, { caps: ['NET_ADMIN'], network: true });

  const needs = await call('POST', '/api/lab', { course: 'capnet', lesson_id: id, cmd: 'true' });
  assert.equal(needs.status, 428, needs.text);
  assert.deepEqual(needs.json, { error: 'lab needs approval', request: { caps: ['NET_ADMIN'], network: true } });
  const beforeApproval = await call('GET', `/api/lesson/${id}?course=capnet`);
  assert.ok(!beforeApproval.json.events.some((e) => e.role === 'lab'), 'a refused lab is not recorded');

  const wrong = await call('POST', '/api/courses/capnet/lab-approval', { caps: ['SYS_ADMIN'], network: true });
  assert.equal(wrong.status, 400, wrong.text);
  assert.equal((await call('GET', '/api/courses/capnet')).json.lab.approved, false);

  const ok = await call('POST', '/api/courses/capnet/lab-approval', { caps: ['NET_ADMIN'], network: true });
  assert.equal(ok.status, 204, ok.text);
  assert.equal((await call('GET', '/api/courses/capnet')).json.lab.approved, true);

  const ran = await call('POST', '/api/lab', { course: 'capnet', lesson_id: id, cmd: 'ip -br link' });
  assert.equal(ran.status, 200, ran.text);
  assert.match(ran.json.stdout, /EXEC:mindgap-capnet bash -lc ip -br link/);
  const runCalls = (await readJsonl(path.join(dir, 'docker-calls.jsonl'))).filter((a) => a[0] === 'run' && a.includes('mindgap-capnet'));
  assert.ok(runCalls.length >= 1);
  assert.deepEqual(runCalls.at(-1).slice(0, 9), ['run', '-d', '--name', 'mindgap-capnet', '--hostname', 'netlab', '--network', 'bridge', '--cap-add']);
  assert.ok(!runCalls.at(-1).includes('--privileged'));
});

test('docker missing: lab is 503 with a reason, not 500, and nothing is recorded', async () => {
  const noDocker = startServer({
    MINDGAP_DATA_DIR: dataDir,
    MINDGAP_TUTOR: 'claude',
    CLAUDE_BIN: path.join(dir, 'claude'),
    DOCKER_BIN: '/nonexistent/docker',
    FAKE_DIR: dir,
  });
  const noDockerPort = await noDocker.port;
  try {
    const r = await call('POST', '/api/lab', { course: 'net', lesson_id: lessonId, cmd: 'true' }, noDockerPort);
    assert.equal(r.status, 503, r.text);
    assert.match(r.json.error, /docker/);
    const info = await call('GET', '/api/courses/net', undefined, noDockerPort);
    assert.equal(info.json.lab.available, false);
  } finally {
    noDocker.srv.kill();
  }
});

test('claude is_error becomes HTTP 502 with the message', async () => {
  await setControl('error');
  try {
    const r = await call('POST', '/api/turn', { course: 'net', lesson_id: lessonId, event: { type: 'lost' } });
    assert.equal(r.status, 502, r.text);
    assert.match(r.json.error, /rate limited boom/);
  } finally {
    await setControl('ok');
  }
});

test('static path traversal is blocked', async () => {
  // Raw request paths: encoded and literal dot-segments that try to reach CONTRACTS.md.
  for (const p of ['/..%2fCONTRACTS.md', '/%2e%2e/CONTRACTS.md', '/../CONTRACTS.md', '/..%2f..%2fserver.mjs']) {
    const r = await call('GET', p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.text.includes('mindgap contracts'), p);
  }
  const contracts = await readFile(CONTRACTS, 'utf8');
  assert.ok(contracts.length > 0);
  const missing = await call('GET', '/nope.html');
  assert.equal(missing.status, 404);
});

test('unknown lesson, oversized body and bad lab cmd are rejected', async () => {
  const unknown = await call('POST', '/api/turn', { course: 'net', lesson_id: 'nope-1', event: { type: 'lost' } });
  assert.equal(unknown.status, 404);

  const big = await call('POST', '/api/lab', { course: 'net', lesson_id: lessonId, cmd: 'x'.repeat(300 * 1024) });
  assert.equal(big.status, 413);

  const long = await call('POST', '/api/lab', { course: 'net', lesson_id: lessonId, cmd: 'x'.repeat(4001) });
  assert.equal(long.status, 400);

  const empty = await call('POST', '/api/lab', { course: 'net', lesson_id: lessonId, cmd: '   ' });
  assert.equal(empty.status, 400);
});

test('chapter lesson: no tutor call to create, reused, context on first event, answers kept when the tutor fails', async () => {
  const callsBefore = (await readCalls()).length;
  const a = await call('POST', '/api/chapter', { course: 'net', node_id: 'switch-mac-table' });
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.meta.mode, 'chapter');
  assert.equal(a.json.meta.course, 'net');
  assert.deepEqual(a.json.events, []);
  assert.equal((await readCalls()).length, callsBefore);
  const b = await call('POST', '/api/chapter', { course: 'net', node_id: 'switch-mac-table' });
  assert.equal(b.json.lesson_id, a.json.lesson_id);
  const id = a.json.lesson_id;

  const ev = { type: 'checkpoint', id: 'c1', chosen: 'x', key: 'y', correct: false, confidence: 2 };
  const t1 = await call('POST', '/api/turn', { course: 'net', lesson_id: id, event: ev });
  assert.equal(t1.status, 200, t1.text);
  const first = (await readCalls()).at(-1);
  assert.ok(!first.includes('--resume'));
  const msg = first.at(-1);
  assert.ok(msg.startsWith(CONTEXT_PREFIX));
  const ctx = JSON.parse(msg.slice(CONTEXT_PREFIX.length, msg.indexOf('\nEVENT:\n')));
  assert.equal(ctx.mode, 'chapter');
  assert.deepEqual(JSON.parse(ctx.chapter_source), CHAPTER);
  assert.equal(JSON.parse(msg.slice(msg.indexOf('\nEVENT:\n') + 8)).id, 'c1');
  const sys = first[first.indexOf('--system-prompt') + 1];
  assert.ok(sys.startsWith(await readFile(path.join(PROMPTS, 'chapter.md'), 'utf8')));
  assert.ok(sys.includes('COURSE-PROMPT-MARKER'));

  await setControl('error');
  try {
    const t2 = await call('POST', '/api/turn', { course: 'net', lesson_id: id, event: { ...ev, id: 'c2' } });
    assert.equal(t2.status, 502);
  } finally {
    await setControl('ok');
  }
  const second = (await readCalls()).at(-1);
  assert.equal(second[second.indexOf('--resume') + 1], 'sess-abc');
  assert.ok(second.at(-1).startsWith(EVENT_PREFIX));

  const lesson = await call('GET', `/api/lesson/${id}?course=net`);
  assert.deepEqual(lesson.json.events.map((e) => `${e.role}:${e.data.id ?? ''}`), ['learner:c1', 'tutor:', 'learner:c2']);

  assert.equal((await call('POST', '/api/chapter', { course: 'net', node_id: 'vlan-basics' })).status, 404);
  assert.equal((await call('POST', '/api/lesson', { course: 'net', node_id: 'switch-mac-table', mode: 'chapter' })).status, 400);
});

test('first access copies the clean seed map into the course state dir', async () => {
  const fresh = path.join(dir, 'fresh');
  const { srv, port: freshPort } = startServer({ MINDGAP_DATA_DIR: fresh });
  try {
    const map = await (await fetch(`http://127.0.0.1:${await freshPort}/api/courses/net/map`)).json();
    const seed = JSON.parse(await readFile(path.join(dir, 'courses', 'net', 'map.seed.json'), 'utf8'));
    assert.equal(map.nodes.length, seed.nodes.length);
    const copied = JSON.parse(await readFile(path.join(fresh, 'courses', 'net', 'state', 'map.json'), 'utf8'));
    assert.deepEqual(copied, seed);
  } finally {
    srv.kill();
  }
});

test('agy server: lesson runs in an empty temp cwd with the schema file, removed afterwards', async () => {
  const { srv, port: agyPort } = startServer({ MINDGAP_DATA_DIR: dataDir, MINDGAP_TUTOR: 'agy', AGY_BIN: path.join(dir, 'agy'), FAKE_DIR: dir });
  try {
    const start = await call('POST', '/api/lesson', { course: 'net', node_id: 'switch-mac-table', mode: 'teach' }, await agyPort);
    assert.equal(start.status, 200, start.text);
    assert.equal(start.json.turn.say, 'hi from agy');

    const first = (await readAgyCalls()).at(-1);
    assert.notEqual(first.cwd, path.resolve(HERE, '..'));
    assert.ok(first.cwd.includes('mindgap-turn-'), first.cwd);
    assert.equal(first.schema, true);
    assert.ok(!first.args.includes('--conversation'));
    assert.ok(first.args.includes('--json-schema'));
    assert.equal(existsSync(first.cwd), false);

    const lesson = await call('GET', `/api/lesson/${start.json.lesson_id}?course=net`, undefined, await agyPort);
    assert.equal(lesson.json.meta.tutor, 'agy');
    assert.equal(lesson.json.meta.tutor_session_id, 'conv-1');

    const t = await call('POST', '/api/turn', { course: 'net', lesson_id: start.json.lesson_id, event: { type: 'lost' } }, await agyPort);
    assert.equal(t.status, 200, t.text);
    const second = (await readAgyCalls()).at(-1);
    assert.equal(second.args[second.args.indexOf('--conversation') + 1], 'conv-1');
  } finally {
    srv.kill();
  }
});

test('agy server refuses a claude lesson with 409 naming both tutors', async () => {
  const { srv, port: agyPort } = startServer({ MINDGAP_DATA_DIR: dataDir, MINDGAP_TUTOR: 'agy', AGY_BIN: path.join(dir, 'agy'), FAKE_DIR: dir });
  try {
    const r = await call('POST', '/api/turn', { course: 'net', lesson_id: lessonId, event: { type: 'lost' } }, await agyPort);
    assert.equal(r.status, 409, r.text);
    assert.match(r.json.error, /claude/);
    assert.match(r.json.error, /agy/);
  } finally {
    srv.kill();
  }
});

test('agy server with a missing binary: lesson start is 502 naming the tutor', async () => {
  const { srv, port: agyPort } = startServer({ MINDGAP_DATA_DIR: path.join(dir, 'missing-data'), MINDGAP_TUTOR: 'agy', AGY_BIN: '/nonexistent/agy' });
  try {
    const r = await call('POST', '/api/lesson', { course: 'net', node_id: 'switch-mac-table', mode: 'teach' }, await agyPort);
    assert.equal(r.status, 502, r.text);
    assert.match(r.json.error, /agy not found/);
  } finally {
    srv.kill();
  }
});

test('unknown MINDGAP_TUTOR exits 1 and lists the valid tutors', async () => {
  const srv = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: '0', MINDGAP_DATA_DIR: path.join(dir, 'bogus-data'), MINDGAP_TUTOR: 'bogus' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  srv.stderr.on('data', (c) => (stderr += c));
  try {
    const code = await exitWithin(srv, 5000);
    assert.equal(code, 1);
    assert.match(stderr, /claude, agy/);
  } finally {
    srv.kill();
  }
});

test('agy server does not reuse a claude chapter lesson; it creates one tagged agy', async () => {
  const claudeChapter = await call('POST', '/api/chapter', { course: 'net', node_id: 'switch-mac-table' });
  assert.equal(claudeChapter.json.meta.tutor, 'claude');
  const { srv, port: agyPort } = startServer({ MINDGAP_DATA_DIR: dataDir, MINDGAP_TUTOR: 'agy', AGY_BIN: path.join(dir, 'agy'), FAKE_DIR: dir });
  try {
    const r = await call('POST', '/api/chapter', { course: 'net', node_id: 'switch-mac-table' }, await agyPort);
    assert.equal(r.status, 200, r.text);
    assert.notEqual(r.json.lesson_id, claudeChapter.json.lesson_id);
    assert.equal(r.json.meta.tutor, 'agy');
  } finally {
    srv.kill();
  }
});
