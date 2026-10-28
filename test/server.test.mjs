// Self-check for server.mjs. Runs the real server against fake claude/agy/docker binaries.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, chmod, rm, copyFile } from 'node:fs/promises';
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
    { id: 'frames-mac', title: 'Frames carry MAC', layer: 'L2', prereqs: [], truth: 't', twins: {}, lab: '', sim: null, sources: ['https://example.com/x'], status: 'gap', evidence: '' },
    { id: 'switch-mac-table', title: 'Switch: MAC to port', layer: 'L2', prereqs: ['frames-mac'], truth: 't', twins: {}, lab: '', sim: 'switch-learning', sources: [], status: 'untested', evidence: '' },
    { id: 'vlan-basics', title: 'VLANs', layer: 'L2', prereqs: [], truth: 't', twins: {}, lab: '', sim: null, sources: [], status: 'untested', evidence: '' },
  ],
};

const CHAPTER = { node: 'switch-mac-table', title: 'Switch chapter' };

// Fake claude: logs argv, returns canned structured_output. control file: ok | slow | hang | error.
const FAKE_CLAUDE = `
import { appendFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
appendFileSync(path.join(dir, 'claude-calls.jsonl'), JSON.stringify(args) + '\\n');
const ctl = path.join(dir, 'control');
const control = existsSync(ctl) ? readFileSync(ctl, 'utf8').trim() : 'ok';
const message = args[args.length - 1];
const canned = message.startsWith('CONTEXT:')
  ? { say: 'hi', question: null, sim: null, lab: null, lesson_done: false,
      node_updates: [{ id: 'switch-mac-table', status: 'shaky', note: 'said IP to MAC' }],
      propositions: [{ claim: 'Switch learns MAC from source', because: ['frames-mac'], node: 'switch-mac-table' }] }
  : { say: 'next', question: null, sim: null, lab: null, lesson_done: false,
      node_updates: [{ id: 'frames-mac', status: 'solid', note: 'answered correctly' }],
      propositions: [{ claim: 'Frames carry src and dst MAC', because: [], node: 'frames-mac' }] };
const tf = path.join(dir, 'turn.json');
let turn = existsSync(tf) ? JSON.parse(readFileSync(tf, 'utf8')) : canned;
// A write call (mode "write") gets the chapter fixture; FAKE_DIR/chapter-bad cuts it to one section.
if (message.startsWith('CONTEXT:') && message.includes('"mode": "write"')) {
  turn = JSON.parse(readFileSync(path.join(dir, 'chapter-raw.json'), 'utf8'));
  if (existsSync(path.join(dir, 'chapter-bad'))) turn.sections = turn.sections.slice(0, 1);
  // chapter-bad-once: the first write call is invalid, later ones are valid.
  if (existsSync(path.join(dir, 'chapter-bad-once'))) { turn.sections = turn.sections.slice(0, 1); unlinkSync(path.join(dir, 'chapter-bad-once')); }
}
const reply = control === 'error'
  ? { type: 'result', is_error: true, result: 'rate limited boom', session_id: 'sess-err' }
  : { type: 'result', is_error: false, session_id: 'sess-abc', structured_output: turn, total_cost_usd: 0 };
setTimeout(() => process.stdout.write(JSON.stringify(reply)), control === 'hang' ? 60000 : control === 'slow' ? 800 : 0);
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
  const c = st.containers[args.at(-1)];
  if (!c) process.exit(1);
  process.stdout.write((c.running ? 'true' : 'false') + '|' + c.label + '\\n');
  process.exit(0);
}
if (cmd === 'run') {
  const label = (args.find((a) => a.startsWith('mindgap.request=')) ?? '').slice('mindgap.request='.length);
  st.containers[args[args.indexOf('--name') + 1]] = { running: true, label };
  save();
  process.exit(0);
}
if (cmd === 'start') { st.containers[args[1]].running = true; save(); process.exit(0); }
if (cmd === 'rm') { delete st.containers[args.at(-1)]; save(); process.exit(0); }
if (cmd === 'exec') {
  if (args[2] === 'sh') process.exit(0);
  process.stdout.write('EXEC:' + args.slice(1).join(' '));
} else {
  process.exitCode = 2;
}
`;

// Fake agy: logs argv, cwd and whether the turn schema sits in cwd; always returns the same canned turn.
const FAKE_AGY = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
const cwd = process.cwd();
appendFileSync(path.join(dir, 'agy-calls.jsonl'), JSON.stringify({ args, cwd, schema: existsSync(path.join(cwd, 'turn-schema.json')) }) + '\\n');
// FAKE_DIR/agy-deny holds N: the next N calls end on a refused command, as agy 1.4.7 does.
const denyFile = path.join(dir, 'agy-deny');
if (existsSync(denyFile)) {
  const n = Number(readFileSync(denyFile, 'utf8'));
  if (n > 0) {
    writeFileSync(denyFile, String(n - 1));
    process.stdout.write(JSON.stringify({ conversation_id: 'conv-denied', status: 'SUCCESS', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] }));
    process.exit(0);
  }
}
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
  await mkdir(path.join(courseDir, 'lab'), { recursive: true });
  await writeFile(path.join(courseDir, 'lab', 'Dockerfile'), 'FROM scratch\n');
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
  assert.deepEqual(r.json, [{ slug: 'net', title: 'Net', solid: 0, total: 3, lastLesson: null }]);
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
  await mkdir(path.join(capDir, 'lab'), { recursive: true });
  await writeFile(path.join(capDir, 'lab', 'Dockerfile'), 'FROM scratch\n');
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

test('agy refused command: the server resumes that conversation once and the lesson starts', async () => {
  const { srv, port: agyPort } = startServer({ MINDGAP_DATA_DIR: dataDir, MINDGAP_TUTOR: 'agy', AGY_BIN: path.join(dir, 'agy'), FAKE_DIR: dir });
  try {
    const before = (await readAgyCalls()).length;
    await writeFile(path.join(dir, 'agy-deny'), '1');
    const r = await call('POST', '/api/lesson', { course: 'net', node_id: 'switch-mac-table', mode: 'teach' }, await agyPort);
    assert.equal(r.status, 200, r.text);
    const calls = (await readAgyCalls()).slice(before);
    assert.equal(calls.length, 2);
    const retry = calls[1].args;
    assert.equal(retry[retry.indexOf('--conversation') + 1], 'conv-denied');
    assert.match(retry.at(-1), /^SERVER: that command was refused/);
  } finally {
    srv.kill();
  }
});

test('agy refused command twice: one retry only, then 502', async () => {
  const { srv, port: agyPort } = startServer({ MINDGAP_DATA_DIR: dataDir, MINDGAP_TUTOR: 'agy', AGY_BIN: path.join(dir, 'agy'), FAKE_DIR: dir });
  try {
    const before = (await readAgyCalls()).length;
    await writeFile(path.join(dir, 'agy-deny'), '2');
    const r = await call('POST', '/api/lesson', { course: 'net', node_id: 'switch-mac-table', mode: 'teach' }, await agyPort);
    assert.equal(r.status, 502, r.text);
    assert.match(r.json.error, /no structured_output/);
    assert.equal((await readAgyCalls()).length - before, 2);
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

// rawCall sends exactly the headers it is given, so a test can forge Host or Content-Type.
function rawCall(method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('POST with a non-JSON content type is 415 and changes no approval', async () => {
  const file = path.join(dataDir, 'courses', 'capnet', 'state', 'lab-approval.json');
  const before = await readFile(file, 'utf8').catch(() => null);
  const body = JSON.stringify({ caps: ['NET_ADMIN'], network: true });
  const r = await rawCall('POST', '/api/courses/capnet/lab-approval', { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(body) }, body);
  assert.equal(r.status, 415, r.text);
  assert.equal(await readFile(file, 'utf8').catch(() => null), before);
});

test('an /api request with a foreign Host is 403', async () => {
  const r = await rawCall('GET', '/api/courses', { host: `evil.example:${port}` });
  assert.equal(r.status, 403, r.text);
  const ok = await rawCall('GET', '/api/courses', { host: `localhost:${port}` });
  assert.equal(ok.status, 200, ok.text);
});

test('a hung docker info does not hang the course page: the lab is unavailable after ~5 s', async () => {
  const hung = path.join(dir, 'hung-docker');
  await writeFile(hung, '#!/bin/sh\nexec sleep 30\n');
  await chmod(hung, 0o755);
  const started = startServer({ MINDGAP_DATA_DIR: dataDir, DOCKER_BIN: hung });
  try {
    const hungPort = await started.port;
    const t0 = Date.now();
    const r = await call('GET', '/api/courses/net', undefined, hungPort);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.lab.available, false);
    assert.match(r.json.lab.reason, /timed out/);
    assert.ok(Date.now() - t0 < 6500, `took ${Date.now() - t0} ms`);
  } finally {
    started.srv.kill();
  }
});

test('a malformed lab block is reported on the course page and refused with 503, never a 500', async () => {
  const badDir = path.join(dir, 'courses', 'badlab');
  await mkdir(path.join(badDir, 'lab'), { recursive: true });
  await writeFile(path.join(badDir, 'course.json'), JSON.stringify({ slug: 'badlab', title: 'Bad lab', layers: [], lab: { dockerfile: 'lab/Dockerfile', caps: 'NET_ADMIN', network: true, hostname: 'netlab' } }));
  await writeFile(path.join(badDir, 'lab', 'Dockerfile'), 'FROM scratch\n');
  await writeFile(path.join(badDir, 'map.seed.json'), JSON.stringify(MAP, null, 2));
  const info = await call('GET', '/api/courses/badlab');
  assert.equal(info.status, 200, info.text);
  assert.equal(info.json.lab.available, false);
  assert.match(info.json.lab.reason, /lab\.caps/);
  const started = await call('POST', '/api/lesson', { course: 'badlab', node_id: 'switch-mac-table', mode: 'teach' });
  assert.equal(started.status, 200, started.text);
  const r = await call('POST', '/api/lab', { course: 'badlab', lesson_id: started.json.lesson_id, cmd: 'true' });
  assert.equal(r.status, 503, r.text);
  assert.match(r.json.error, /lab\.caps/);
});

test('a non-string lab.hostname is reported on the course page as unavailable, never a 500', async () => {
  const badDir = path.join(dir, 'courses', 'badhost');
  await mkdir(path.join(badDir, 'lab'), { recursive: true });
  await writeFile(path.join(badDir, 'course.json'), JSON.stringify({ slug: 'badhost', title: 'Bad host', layers: [], lab: { dockerfile: 'lab/Dockerfile', caps: [], network: false, hostname: 42 } }));
  await writeFile(path.join(badDir, 'lab', 'Dockerfile'), 'FROM scratch\n');
  await writeFile(path.join(badDir, 'map.seed.json'), JSON.stringify(MAP, null, 2));
  const info = await call('GET', '/api/courses/badhost');
  assert.equal(info.status, 200, info.text);
  assert.equal(info.json.lab.available, false);
  assert.match(info.json.lab.reason, /lab\.hostname/);
});

test('course schema extends the turn schema: same seven fields, five more required', async () => {
  const turn = JSON.parse(await readFile(path.join(PROMPTS, 'turn-schema.json'), 'utf8'));
  const course = JSON.parse(await readFile(path.join(PROMPTS, 'course-schema.json'), 'utf8'));
  assert.deepEqual(course.required, [...turn.required, 'goal', 'assessment', 'plan', 'approved', 'read_sections']);
  for (const key of Object.keys(turn.properties)) {
    assert.deepEqual(course.properties[key], turn.properties[key], key);
  }
  const plan = course.properties.plan;
  assert.deepEqual(plan.required, ['approach', 'in_scope', 'sources', 'new_layers', 'new_nodes']);
  assert.deepEqual(Object.keys(plan.properties), plan.required);
  assert.deepEqual(plan.properties.new_layers.items.required, ['id', 'name']);
  assert.deepEqual(plan.properties.new_nodes.items.required, ['id', 'title', 'layer', 'prereqs', 'truth', 'status', 'evidence']);
  for (const k of ['new_layers', 'new_nodes']) assert.equal(plan.properties[k].items.additionalProperties, false);
});

// Course-session tests. FAKE_CLAUDE answers with <dir>/turn.json while it exists.
const courseTurn = (o = {}) => ({
  say: 'ok', question: null, sim: null, lab: null, node_updates: [], propositions: [], lesson_done: false,
  goal: null, assessment: null, plan: null, approved: false, read_sections: [], ...o,
});
const GOAL = { text: 'Debug a VLAN outage', background: 'runs a home lab' };
const ASSESSMENT = { strands: [{ strand: 'L2', assessment: 'knows frames' }], summary: 'enter at switching' };
const setTurn = (t) => writeFile(path.join(dir, 'turn.json'), JSON.stringify(courseTurn(t)));
const goalPath = () => path.join(stateDir(), 'goal.json');
const startCourse = () => call('POST', '/api/lesson', { course: 'net', mode: 'course' });
const say = (id) => call('POST', '/api/turn', { course: 'net', lesson_id: id, event: { type: 'ask', text: 'hello' } });
const lastMessage = async () => (await readCalls()).at(-1).at(-1);

// Runs fn, then puts the shared map back and removes goal.json and the canned turn.
async function withCourseState(fn) {
  const before = await readFile(path.join(stateDir(), 'map.json'), 'utf8');
  try {
    await fn(JSON.parse(before));
  } finally {
    await rm(path.join(dir, 'turn.json'), { force: true });
    await rm(goalPath(), { force: true });
    await writeFile(path.join(stateDir(), 'map.json'), before);
  }
}

test('course mode starts without a node_id: schema, context, lesson id', () => withCourseState(async () => {
  await setTurn({ say: 'what do you want?' });
  const r = await startCourse();
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.lesson_id, /^course-\d+$/);
  const argv = (await readCalls()).at(-1);
  const schema = JSON.parse(argv[argv.indexOf('--json-schema') + 1]);
  assert.ok(schema.properties.plan);
  const ctx = JSON.parse(argv.at(-1).slice(CONTEXT_PREFIX.length));
  assert.equal(ctx.mode, 'course');
  assert.equal(ctx.learner, null);
  assert.deepEqual(ctx.nodes.map((n) => n.id), MAP.nodes.map((n) => n.id));
  assert.equal(ctx.course.slug, 'net');
  const meta = (await call('GET', `/api/lesson/${r.json.lesson_id}?course=net`)).json.meta;
  assert.equal(meta.mode, 'course');
  assert.equal(meta.node_id, null);
}));

test('course context carries existing source_sections on a node', () => withCourseState(async (map) => {
  map.nodes[0].source_sections = ['sx-1'];
  await writeFile(path.join(stateDir(), 'map.json'), JSON.stringify(map));
  await setTurn({ say: 'hi' });
  assert.equal((await startCourse()).status, 200);
  const ctx = JSON.parse((await lastMessage()).slice(CONTEXT_PREFIX.length));
  assert.deepEqual(ctx.nodes[0].source_sections, ['sx-1']);
  assert.ok(!('source_sections' in ctx.nodes[1]));
}));

test('course session happy path: plan approved, map scoped, goal saved, lab approval untouched', () => withCourseState(async (mapBefore) => {
  await setTurn({ goal: GOAL, assessment: ASSESSMENT });
  const r = await startCourse();
  assert.equal(r.status, 200, r.text);
  const id = r.json.lesson_id;
  await setTurn({ plan: { approach: 'macs then table', in_scope: ['frames-mac', 'switch-mac-table'] } });
  assert.equal((await say(id)).json.turn.plan.in_scope.length, 2);
  await setTurn({ approved: true, lesson_done: true });
  const last = await say(id);
  assert.equal(last.json.turn.lesson_done, true);
  assert.equal(last.json.turn.approved, true);

  const map = (await call('GET', '/api/courses/net/map')).json;
  assert.equal(map.nodes.find((n) => n.id === 'vlan-basics').in_scope, false);
  assert.ok(!('in_scope' in map.nodes.find((n) => n.id === 'frames-mac')));
  assert.ok(!('in_scope' in map.nodes.find((n) => n.id === 'switch-mac-table')));
  assert.deepEqual(map.nodes.map(({ in_scope, source_sections, ...n }) => n), mapBefore.nodes);
  assert.deepEqual(map.nodes.find((n) => n.id === 'frames-mac').sources, ['https://example.com/x']);
  const goal = JSON.parse(await readFile(goalPath(), 'utf8'));
  assert.equal(goal.goal, GOAL.text);
  assert.equal(goal.background, GOAL.background);
  assert.ok(goal.approved_at);
  assert.ok(!existsSync(path.join(stateDir(), 'lab-approval.json')));
}));

test('a refused plan is nulled, then reported once in a SERVER block', () => withCourseState(async () => {
  await setTurn({ goal: GOAL, assessment: ASSESSMENT });
  const id = (await startCourse()).json.lesson_id;
  await setTurn({ plan: { approach: 'x', in_scope: ['switch-mac-table'] } });
  const bad = await say(id);
  assert.equal(bad.json.turn.plan, null);
  await setTurn({});
  await say(id);
  const msg = await lastMessage();
  assert.ok(msg.startsWith('SERVER:\n- plan refused'), msg);
  assert.match(msg.split('EVENT:')[0], /frames-mac/);
  assert.ok(msg.includes('\nEVENT:\n'));
  await say(id);
  assert.ok((await lastMessage()).startsWith(EVENT_PREFIX));
}));

test('an abandoned course session leaves map.json and goal.json alone', () => withCourseState(async (mapBefore) => {
  await setTurn({ goal: GOAL, assessment: ASSESSMENT });
  const id = (await startCourse()).json.lesson_id;
  await setTurn({ plan: { approach: 'x', in_scope: ['frames-mac', 'switch-mac-table'] } });
  await say(id);
  assert.deepEqual((await call('GET', '/api/courses/net/map')).json, mapBefore);
  assert.ok(!existsSync(goalPath()));
}));

test('after an approved session a teach lesson sees the learner and off-goal nodes', () => withCourseState(async () => {
  await setTurn({ goal: GOAL, assessment: ASSESSMENT });
  const id = (await startCourse()).json.lesson_id;
  await setTurn({ plan: { approach: 'x', in_scope: ['frames-mac', 'switch-mac-table'] } });
  await say(id);
  await setTurn({ approved: true });
  await say(id);
  await rm(path.join(dir, 'turn.json'));
  const t = await call('POST', '/api/lesson', { course: 'net', node_id: 'switch-mac-table', mode: 'teach' });
  assert.equal(t.status, 200, t.text);
  const ctx = JSON.parse((await lastMessage()).slice(CONTEXT_PREFIX.length));
  assert.equal(ctx.learner.goal, GOAL.text);
  assert.equal(ctx.other_nodes.find((n) => n.id === 'vlan-basics').in_scope, false);
}));

test('teach mode still needs a node_id, and the mode error lists only /api/lesson modes', async () => {
  const r = await call('POST', '/api/lesson', { course: 'net', mode: 'teach' });
  assert.equal(r.status, 400);
  const bad = await call('POST', '/api/lesson', { course: 'net', node_id: 'frames-mac', mode: 'chapter' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /teach, practice, probe, course$/);
});

test('course prompt: credit line, every course field, subject-neutral', async () => {
  const p = await readFile(path.join(PROMPTS, 'course.md'), 'utf8');
  assert.ok(p.startsWith('<!-- Adapted from amosblomqvist/learnharness (AGPL-3.0). -->'));
  for (const f of ['goal', 'assessment', 'plan', 'in_scope', 'approved', 'SERVER:']) assert.ok(p.includes(f), f);
  assert.doesNotMatch(p, /\b(switch|VLAN|MAC|AWS)\b/);
});

test('networking course prompt no longer carries the learner background', async () => {
  const p = await readFile(path.join(HERE, '..', 'courses', 'networking', 'prompt.md'), 'utf8');
  assert.ok(!p.includes('is a cloud engineer'));
  assert.ok(p.includes('learner.background'));
});

test('shared mode prompts are subject-neutral; the networking specifics live in the course prompt', async () => {
  for (const f of ['teacher.md', 'practice.md', 'prober.md', 'chapter.md']) {
    const p = await readFile(path.join(PROMPTS, f), 'utf8');
    assert.doesNotMatch(p, /[Nn]etwork|cloud engineer|AWS|Kubernetes|Cilium|Proxmox|netlab|VLAN|subnet|TCP|[Pp]acket|router|\bMAC\b/, f);
  }
  const net = await readFile(path.join(HERE, '..', 'courses', 'networking', 'prompt.md'), 'utf8');
  for (const k of ['cloud twin', 'netlab', 'VLAN', 'ARP', 'tcpdump']) assert.ok(net.includes(k), k);
  assert.doesNotMatch(net, /cloud engineer|[Ll]earners here/, 'no learner profile in the shipped prompt');
});

// A tutor turn with the course fields missing entirely (not null) must not break the session.
const setRaw = (t) => writeFile(path.join(dir, 'turn.json'), JSON.stringify(t));

test('a middle turn that omits goal entirely still approves cleanly: map and goal.json agree', () => withCourseState(async () => {
  await setTurn({ goal: GOAL, assessment: ASSESSMENT });
  const id = (await startCourse()).json.lesson_id;
  await setTurn({ plan: { approach: 'x', in_scope: ['frames-mac', 'switch-mac-table'] } });
  await say(id);
  await setRaw({ say: 'agreed', approved: true, lesson_done: true });
  const last = await say(id);
  assert.equal(last.status, 200, last.text);
  assert.equal(last.json.turn.approved, true);
  assert.equal(JSON.parse(await readFile(goalPath(), 'utf8')).goal, GOAL.text);
  const map = (await call('GET', '/api/courses/net/map')).json;
  assert.equal(map.nodes.find((n) => n.id === 'vlan-basics').in_scope, false);
}));

test('approval with no goal on record is refused and leaves the map and goal.json alone', () => withCourseState(async (mapBefore) => {
  await setTurn({ say: 'hello' });
  const id = (await startCourse()).json.lesson_id;
  await setRaw({ say: 'done', approved: true, lesson_done: true });
  const r = await say(id);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.turn.approved, false);
  assert.equal(r.json.turn.lesson_done, false);
  assert.deepEqual((await call('GET', '/api/courses/net/map')).json, mapBefore);
  assert.ok(!existsSync(goalPath()));
}));

test('a corrupt goal.json does not stop a teach lesson: learner is null', () => withCourseState(async () => {
  await writeFile(goalPath(), '{not json');
  const t = await call('POST', '/api/lesson', { course: 'net', node_id: 'switch-mac-table', mode: 'teach' });
  assert.equal(t.status, 200, t.text);
  const ctx = JSON.parse((await lastMessage()).slice(CONTEXT_PREFIX.length));
  assert.equal(ctx.learner, null);
}));

// Source routes. FAKE_MARKITDOWN turns stdin into "# Doc\n\n<stdin>" and records the -x hint.
const FAKE_MARKITDOWN = `
let s = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (s += c));
process.stdin.on('end', () => process.stdout.write('# Doc\\n\\n' + s + '\\n\\n## Part two\\n\\nmore'));
`;

async function startSourcesServer(bin) {
  const started = startServer({ MINDGAP_DATA_DIR: path.join(dir, 'src-data'), MARKITDOWN_BIN: bin });
  return { srv: started.srv, at: await started.port };
}

test('sources: add by URL and upload, list, delete, path safety, guards', async () => {
  const js = path.join(dir, 'fake-markitdown.mjs');
  const bin = path.join(dir, 'markitdown');
  await writeFile(js, FAKE_MARKITDOWN);
  await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
  await chmod(bin, 0o755);
  const site = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<p>from the web</p>');
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const { srv, at } = await startSourcesServer(bin);
  try {
    const url = `http://127.0.0.1:${site.address().port}/page`;
    const a = await call('POST', '/api/courses/net/sources', { url }, at);
    assert.equal(a.status, 201, a.text);
    assert.equal(a.json.origin.kind, 'url');
    const b = await call('POST', '/api/courses/net/sources', { filename: 'n.txt', data_base64: Buffer.from('hello upload').toString('base64') }, at);
    assert.equal(b.status, 201, b.text);
    assert.equal(b.json.origin.value, 'n.txt');

    const list = await call('GET', '/api/courses/net/sources', undefined, at);
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.map((s) => s.id).sort(), [a.json.id, b.json.id].sort());
    assert.ok(list.json[0].sections.every((x) => x.chars > 0 && x.heading));

    // exactly one of url / data_base64; filename required; data must be a string
    for (const body of [{}, { url, filename: 'a.txt', data_base64: 'aGk=' }, { data_base64: 'aGk=' }, { filename: 'a.txt', data_base64: 5 }]) {
      assert.equal((await call('POST', '/api/courses/net/sources', body, at)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call('POST', '/api/courses/nope/sources', { url }, at)).status, 404);

    // guards: static still refuses DELETE; a non-JSON POST is 415
    assert.equal((await call('DELETE', '/index.html', undefined, at)).status, 405);
    const raw = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: at, method: 'POST', path: '/api/courses/net/sources', headers: { 'content-type': 'text/plain' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(raw, 415);

    assert.equal((await call('DELETE', '/api/courses/net/sources/..', undefined, at)).status, 404);
    assert.equal((await call('DELETE', '/api/courses/net/sources/..%2Fetc', undefined, at)).status, 404);
    assert.equal((await call('DELETE', `/api/courses/net/sources/${a.json.id}`, undefined, at)).status, 204);
    assert.equal((await call('DELETE', `/api/courses/net/sources/${a.json.id}`, undefined, at)).status, 404);
    assert.equal((await call('GET', '/api/courses/net/sources', undefined, at)).json.length, 1);
  } finally {
    srv.kill();
    site.close();
  }
});

test('sources: missing markitdown is 503 with the install line', async () => {
  const { srv, at } = await startSourcesServer('/nonexistent/markitdown');
  try {
    const r = await call('POST', '/api/courses/net/sources', { filename: 'n.txt', data_base64: 'aGk=' }, at);
    assert.equal(r.status, 503, r.text);
    assert.match(r.json.install, /markitdown\[all\]/);
  } finally {
    srv.kill();
  }
});

test('sources: the 413 message names the real limit', async () => {
  const { srv, at } = await startSourcesServer('/nonexistent/markitdown');
  try {
    const big = Buffer.alloc(300 * 1024, 'a').toString('base64');
    const r = await call('POST', '/api/lesson', { pad: big }, at);
    assert.equal(r.status, 413);
    assert.match(r.json.error, /256 KB/);
  } finally {
    srv.kill();
  }
});

// Slice f1: sources reach the tutor. Sources are written straight into learner data, as importSource would.
const srcDir = () => path.join(dataDir, 'courses', 'net', 'sources');
async function putSource(id, title, texts) {
  await mkdir(srcDir(), { recursive: true });
  const sections = texts.map((text, i) => ({ id: `${id}-${i + 1}`, heading: `H${i + 1}`, text }));
  await writeFile(path.join(srcDir(), `${id}.json`), JSON.stringify({ id, title, origin: { kind: 'file', value: 'x.txt' }, added: '2026-01-01T00:00:00.000Z', truncated: false, sections }));
}
async function withSources(fn) {
  try { await fn(); } finally { await rm(srcDir(), { recursive: true, force: true }); }
}
const ctxOf = (msg) => JSON.parse(msg.slice(msg.indexOf(CONTEXT_PREFIX) + CONTEXT_PREFIX.length));

test('sources: course context carries the TOC without text; read_sections brings SOURCES: next turn only', () => withCourseState(() => withSources(async () => {
  await putSource('sa', 'Book', ['alpha text', 'beta text']);
  await setTurn({ say: 'hello' });
  const id = (await startCourse()).json.lesson_id;
  const ctx = ctxOf(await lastMessage());
  assert.deepEqual(ctx.sources, [{ id: 'sa', title: 'Book', sections: [{ id: 'sa-1', heading: 'H1', chars: 10 }, { id: 'sa-2', heading: 'H2', chars: 9 }] }]);
  assert.ok(!(await lastMessage()).includes('alpha text'));
  await setTurn({ read_sections: ['sa-2'] });
  await say(id);
  assert.ok(!(await lastMessage()).includes('SOURCES:'));
  await setTurn({});
  await say(id);
  const m = await lastMessage();
  assert.ok(m.startsWith('SOURCES:\n'), m);
  assert.deepEqual(JSON.parse(m.slice('SOURCES:\n'.length, m.indexOf('\nEVENT:'))), [{ id: 'sa-2', source: 'sa', heading: 'H2', text: 'beta text' }]);
  await say(id);
  assert.ok(!(await lastMessage()).includes('SOURCES:'));
})));

test('sources: an unknown read_sections id is refused with a SERVER note and nothing is read', () => withCourseState(() => withSources(async () => {
  await putSource('sa', 'Book', ['alpha text']);
  await setTurn({});
  const id = (await startCourse()).json.lesson_id;
  await setTurn({ read_sections: ['sa-1', 'sz-9'] });
  await say(id);
  await setTurn({});
  await say(id);
  const m = await lastMessage();
  assert.ok(m.startsWith('SERVER:\n- read_sections refused'), m);
  assert.match(m, /sz-9/);
  assert.ok(!m.includes('SOURCES:'));
  assert.ok(!m.includes('alpha text'));
})));

test('sources: approval tags nodes, teach lesson gets the excerpt; truncation at EXCERPT_MAX; deleted source skipped', () => withCourseState(() => withSources(async () => {
  await putSource('sa', 'Book', ['a'.repeat(12000), 'b'.repeat(12000), 'tiny']);
  await setTurn({ goal: GOAL, assessment: ASSESSMENT });
  const id = (await startCourse()).json.lesson_id;
  const sources = [{ node: 'switch-mac-table', sections: ['sa-1', 'sa-2'] }, { node: 'frames-mac', sections: ['sa-3', 'sgone-1'] }];
  await setTurn({ plan: { approach: 'x', in_scope: ['frames-mac', 'switch-mac-table'], sources } });
  const refused = await say(id);
  assert.equal(refused.json.turn.plan, null);
  await setTurn({ plan: { approach: 'x', in_scope: ['frames-mac', 'switch-mac-table'], sources: [sources[0], { node: 'frames-mac', sections: ['sa-3'] }] } });
  await say(id);
  await setTurn({ approved: true });
  await say(id);
  const map = (await call('GET', '/api/courses/net/map')).json;
  assert.deepEqual(map.nodes.find((n) => n.id === 'switch-mac-table').source_sections, ['sa-1', 'sa-2']);
  assert.deepEqual(map.nodes.find((n) => n.id === 'frames-mac').source_sections, ['sa-3']);
  assert.deepEqual(map.nodes.find((n) => n.id === 'frames-mac').sources, ['https://example.com/x']);
  assert.ok(!('source_sections' in map.nodes.find((n) => n.id === 'vlan-basics')));

  await rm(path.join(dir, 'turn.json'));
  await call('POST', '/api/lesson', { course: 'net', node_id: 'switch-mac-table', mode: 'teach' });
  const t = ctxOf(await lastMessage());
  assert.deepEqual(t.sources.map((x) => x.id), ['sa-1']);
  assert.equal(t.sources[0].text.length, 12000);

  await call('POST', '/api/lesson', { course: 'net', node_id: 'frames-mac', mode: 'practice' });
  assert.deepEqual(ctxOf(await lastMessage()).sources, [{ id: 'sa-3', source: 'sa', heading: 'H3', text: 'tiny' }]);

  await rm(srcDir(), { recursive: true, force: true });
  await call('POST', '/api/lesson', { course: 'net', node_id: 'frames-mac', mode: 'teach' });
  assert.ok(!('sources' in ctxOf(await lastMessage())));
})));

// Create a course, then grow its map by approval (f2 task 3).
const NODE = (id, prereqs = []) => ({ id, title: id, layer: 'basics', prereqs, truth: `${id} truth`, status: 'untested', evidence: '' });

async function drawSession(slug, plan) {
  const callIn = (p, b) => call('POST', p, b);
  await setTurn({ goal: GOAL, assessment: ASSESSMENT });
  const id = (await callIn('/api/lesson', { course: slug, mode: 'course' })).json.lesson_id;
  const say = () => callIn('/api/turn', { course: slug, lesson_id: id, event: { type: 'ask', text: 'ok' } });
  await setTurn({ plan });
  const shown = await say();
  await setTurn({ approved: true, lesson_done: true });
  return { shown, approved: await say() };
}

test('POST /api/courses creates the folder, files and goal background; the list shows it', async () => {
  const r = await call('POST', '/api/courses', { title: ' Rust Basics ', background: 'knows C' });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.json, { slug: 'rust-basics' });
  const cdir = path.join(dataDir, 'courses', 'rust-basics');
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'course.json'), 'utf8')), { slug: 'rust-basics', title: 'Rust Basics', layers: [], lab: null });
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'map.seed.json'), 'utf8')), { nodes: [] });
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'chapters', 'index.json'), 'utf8')), []);
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'state', 'goal.json'), 'utf8')), { goal: null, background: 'knows C' });
  assert.ok((await call('GET', '/api/courses')).json.some((c) => c.slug === 'rust-basics' && c.title === 'Rust Basics'));
  assert.deepEqual((await call('GET', '/api/courses/rust-basics/map')).json, { nodes: [] });
  assert.equal((await call('GET', '/api/courses/rust-basics')).json.generated, true);
  assert.equal((await call('GET', '/api/courses/net')).json.generated, false);
});

test('POST /api/courses: same title gets -2, a shipped slug is skipped, bad input is 400', async () => {
  assert.equal((await call('POST', '/api/courses', { title: 'Rust Basics' })).json.slug, 'rust-basics-2');
  const shipped = await call('POST', '/api/courses', { title: 'Net' });
  assert.equal(shipped.json.slug, 'net-2');
  assert.ok(!existsSync(path.join(dataDir, 'courses', 'net', 'course.json')));
  assert.ok(!existsSync(path.join(dataDir, 'courses', 'rust-basics-2', 'state')));
  for (const body of [{}, { title: '   ' }, { title: 'x'.repeat(81) }, { title: 5 }, { title: 'ok', background: 'y'.repeat(2001) }, { title: 'ok', background: 7 }]) {
    assert.equal((await call('POST', '/api/courses', body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
});

test('approval on a generated course adds nodes and the layer, writes no chapters; a second session keeps the first', async () => {
  const slug = (await call('POST', '/api/courses', { title: 'Grow Me' })).json.slug;
  const cdir = path.join(dataDir, 'courses', slug);
  const plan1 = { approach: 'draw', in_scope: ['a', 'b', 'c'], new_layers: [{ id: 'basics', name: 'Basics' }], new_nodes: [NODE('a'), NODE('b', ['a']), NODE('c', ['b'])] };
  const one = await drawSession(slug, plan1);
  assert.equal(one.shown.json.turn.plan.in_scope.length, 3, one.shown.text);
  assert.equal(one.approved.json.turn.approved, true, one.approved.text);
  const map1 = (await call('GET', `/api/courses/${slug}/map`)).json;
  assert.deepEqual(map1.nodes.map((n) => [n.id, n.status, n.evidence]), [['a', 'untested', ''], ['b', 'untested', ''], ['c', 'untested', '']]);
  const cj = JSON.parse(await readFile(path.join(cdir, 'course.json'), 'utf8'));
  assert.deepEqual(cj.layers, [{ id: 'basics', name: 'Basics' }]);
  assert.equal(cj.title, 'Grow Me');
  assert.deepEqual(await readdir(path.join(cdir, 'chapters')), ['index.json']);
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'state', 'goal.json'), 'utf8')).goal, GOAL.text);

  // Learner evidence on an existing node survives a later growth.
  map1.nodes[0].status = 'shaky';
  map1.nodes[0].evidence = 'mixed up';
  await writeFile(path.join(cdir, 'state', 'map.json'), JSON.stringify(map1));
  const two = await drawSession(slug, { approach: 'more', in_scope: ['a', 'b', 'c', 'd'], new_layers: [], new_nodes: [{ ...NODE('d', ['c']), status: 'gap', evidence: 'confused X with Y' }] });
  assert.equal(two.approved.json.turn.approved, true, two.approved.text);
  const map2 = (await call('GET', `/api/courses/${slug}/map`)).json;
  assert.deepEqual(map2.nodes.slice(0, 3), map1.nodes);
  assert.deepEqual(map2.nodes[3], { ...NODE('d', ['c']), status: 'gap', evidence: 'confused X with Y' });
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'course.json'), 'utf8')).layers, [{ id: 'basics', name: 'Basics' }]);
  assert.deepEqual(await readdir(path.join(cdir, 'chapters')), ['index.json']);
});

test('a shipped course session with new_nodes is refused and its map is untouched', () => withCourseState(async (mapBefore) => {
  const { shown } = await drawSession('net', { approach: 'x', in_scope: ['frames-mac', 'zz'], new_layers: [{ id: 'basics', name: 'B' }], new_nodes: [NODE('zz')] });
  assert.equal(shown.json.turn.plan, null);
  assert.deepEqual((await call('GET', '/api/courses/net/map')).json, mapBefore);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'courses', 'net', 'course.json'), 'utf8')).layers.length, 1);
}));

// --- write a chapter on demand (generated courses only) ---
async function writableCourse(title) {
  await copyFile(path.join(HERE, 'fixtures', 'chapter-raw.json'), path.join(dir, 'chapter-raw.json'));
  const slug = (await call('POST', '/api/courses', { title, background: 'bakes bread' })).json.slug;
  const cdir = path.join(dataDir, 'courses', slug);
  await call('GET', `/api/courses/${slug}/map`); // seeds state
  const node = (id, layer, prereqs, sections) => ({ id, title: `T ${id}`, layer, prereqs, truth: `truth ${id}`, status: 'untested', evidence: '', ...(sections ? { source_sections: sections } : {}) });
  await writeFile(path.join(cdir, 'state', 'map.json'), JSON.stringify({ nodes: [node('alpha', 'basics', []), node('beta', 'basics', ['alpha'], ['s1-1', 's1-2']), node('gamma', 'basics', [])] }));
  await writeFile(path.join(cdir, 'course.json'), JSON.stringify({ slug, title, layers: [{ id: 'basics', name: 'Basics' }], lab: null }));
  await mkdir(path.join(cdir, 'sources'), { recursive: true });
  await writeFile(path.join(cdir, 'sources', 's1.json'), JSON.stringify({ id: 's1', title: 'Src', origin: { kind: 'file', value: 'a.txt' }, added: '2026-01-01T00:00:00Z', truncated: false, sections: [{ id: 's1-1', heading: 'Heading One', text: 'EXCERPT-ONE' }, { id: 's1-2', heading: 'Heading Two', text: 'EXCERPT-TWO' }] }));
  return { slug, cdir };
}

test('write: 201 stores the chapter with number and kicker, indexes it, serves it, sends tagged excerpts', async () => {
  const { slug, cdir } = await writableCourse('Write One');
  const before = (await readCalls()).length;
  const r = await call('POST', `/api/courses/${slug}/chapters/beta/write`, {});
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.json, { node: 'beta' });
  const ch = (await call('GET', `/api/courses/${slug}/chapters/beta`)).json;
  assert.equal(ch.node, 'beta');
  assert.equal(ch.number, '1');
  assert.equal(ch.kicker, 'Basics');
  assert.ok(ch.sections.every((s) => s.blocks.every((b) => Object.keys(b).length === 1)));
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'chapters', 'index.json'), 'utf8')), ['beta']);
  const calls = await readCalls();
  assert.equal(calls.length, before + 1);
  const argv = calls.at(-1);
  assert.ok(!argv.includes('--resume'));
  assert.ok(argv[argv.indexOf('--system-prompt') + 1].startsWith(await readFile(path.join(PROMPTS, 'writer.md'), 'utf8')));
  const ctx = JSON.parse(argv.at(-1).slice(CONTEXT_PREFIX.length));
  assert.equal(ctx.mode, 'write');
  assert.deepEqual(ctx.course, { slug, title: 'Write One' });
  assert.deepEqual(ctx.learner, { goal: null, background: 'bakes bread' });
  assert.equal(ctx.target.layer_name, 'Basics');
  assert.deepEqual(ctx.prereqs, [{ id: 'alpha', title: 'T alpha', status: 'untested', evidence: '' }]);
  assert.deepEqual(ctx.other_nodes, [{ id: 'gamma', title: 'T gamma' }]);
  assert.deepEqual(ctx.sources.map((s) => s.text), ['EXCERPT-ONE', 'EXCERPT-TWO']);
  // Nothing under sessions/, and the second node numbers 2.
  assert.deepEqual(await readdir(path.join(cdir, 'state', 'sessions')), []);
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/gamma/write`, {})).status, 201);
  assert.equal((await call('GET', `/api/courses/${slug}/chapters/gamma`)).json.number, '2');
  assert.ok(!('sources' in JSON.parse((await readCalls()).at(-1).at(-1).slice(CONTEXT_PREFIX.length))));
});

test('write: an invalid chapter is 502 and nothing is written; then a valid retry works', async () => {
  const { slug, cdir } = await writableCourse('Write Bad');
  await writeFile(path.join(dir, 'chapter-bad'), '');
  const r = await call('POST', `/api/courses/${slug}/chapters/alpha/write`, {});
  await rm(path.join(dir, 'chapter-bad'));
  assert.equal(r.status, 502, r.text);
  assert.match(r.json.error, /^chapter refused: /);
  assert.deepEqual(await readdir(path.join(cdir, 'chapters')), ['index.json']);
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'chapters', 'index.json'), 'utf8')), []);
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/alpha/write`, {})).status, 201);
});

test('write: tutor failure is 502; a second write of the same node, a shipped course, bad ids are refused', async () => {
  const { slug, cdir } = await writableCourse('Write Guards');
  await setControl('error');
  const failed = await call('POST', `/api/courses/${slug}/chapters/alpha/write`, {});
  await setControl('ok');
  assert.equal(failed.status, 502, failed.text);
  assert.deepEqual(await readdir(path.join(cdir, 'chapters')), ['index.json']);
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/alpha/write`, {})).status, 201);
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/alpha/write`, {})).status, 409);
  const shipped = await call('POST', '/api/courses/net/chapters/vlan-basics/write', {});
  assert.equal(shipped.status, 409, shipped.text);
  assert.ok(!existsSync(path.join(dir, 'courses', 'net', 'chapters', 'vlan-basics.json')));
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/..%2f..%2fx/write`, {})).status, 400);
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/..%2findex/write`, {})).status, 400);
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/nope/write`, {})).status, 404);
  assert.deepEqual((await readdir(path.join(cdir, 'chapters'))).sort(), ['alpha.json', 'index.json']);
});

test('write: a concurrent write of the same node is 409, and /api/lesson refuses mode write', async () => {
  const { slug } = await writableCourse('Write Busy');
  await setControl('slow');
  const first = call('POST', `/api/courses/${slug}/chapters/alpha/write`, {});
  await new Promise((r) => setTimeout(r, 300));
  const second = await call('POST', `/api/courses/${slug}/chapters/alpha/write`, {});
  const done = await first;
  await setControl('ok');
  assert.equal(second.status, 409, second.text);
  assert.equal(done.status, 201, done.text);
  assert.equal((await call('POST', '/api/lesson', { course: slug, node_id: 'alpha', mode: 'write' })).status, 400);
});

test('write: an orphan chapter file (no index entry) is overwritten; id index is refused; a malformed index writes nothing', async () => {
  const { slug, cdir } = await writableCourse('Write Orphan');
  await writeFile(path.join(cdir, 'chapters', 'alpha.json'), '{"orphan":true}');
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/alpha/write`, {})).status, 201);
  assert.equal(JSON.parse(await readFile(path.join(cdir, 'chapters', 'alpha.json'), 'utf8')).node, 'alpha');
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'chapters', 'index.json'), 'utf8')), ['alpha']);
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/index/write`, {})).status, 400);
  assert.equal((await call('GET', `/api/courses/${slug}/chapters/index`)).status, 404);
  await writeFile(path.join(cdir, 'chapters', 'index.json'), '{not json');
  const before = (await readCalls()).length;
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/gamma/write`, {})).status, 500);
  assert.equal((await readCalls()).length, before);
  assert.ok(!existsSync(path.join(cdir, 'chapters', 'gamma.json')));
});

test('write calls use CHAPTER_TIMEOUT_MS = 300 s, passed to callTutor', async () => {
  // ponytail: a source check, not a behavioural one; the server is a script, so importing it would start it.
  const src = await readFile(SERVER, 'utf8');
  assert.match(src, /const CHAPTER_TIMEOUT_MS = 300_000;/);
  assert.match(src, /callTutor\(c, \{ mode: 'write', tutor_session_id: null \}, .*, CHAPTER_TIMEOUT_MS\)/);
  assert.match(src, /timeout: timeoutMs,/);
});

test('write: a refused chapter is retried once with a SERVER line; refused twice is 502 and nothing is written', async () => {
  const { slug, cdir } = await writableCourse('Write Retry');
  await writeFile(path.join(dir, 'chapter-bad-once'), '');
  const before = (await readCalls()).length;
  const r = await call('POST', `/api/courses/${slug}/chapters/alpha/write`, {});
  assert.equal(r.status, 201, r.text);
  const calls = (await readCalls()).slice(before);
  assert.equal(calls.length, 2);
  assert.ok(!calls[1].includes('--resume'));
  assert.ok(calls[0].at(-1).startsWith(CONTEXT_PREFIX) && !calls[0].at(-1).includes('SERVER:'));
  assert.ok(calls[1].at(-1).startsWith(calls[0].at(-1)));
  assert.match(calls[1].at(-1), /\nSERVER:\n- your previous chapter was refused: .+\. Write the whole chapter again, following the output rules\.$/);

  await writeFile(path.join(dir, 'chapter-bad'), '');
  const n = (await readCalls()).length;
  const bad = await call('POST', `/api/courses/${slug}/chapters/gamma/write`, {});
  await rm(path.join(dir, 'chapter-bad'));
  assert.equal(bad.status, 502, bad.text);
  assert.equal((await readCalls()).length, n + 2);
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'chapters', 'index.json'), 'utf8')), ['alpha']);
  assert.ok(!existsSync(path.join(cdir, 'chapters', 'gamma.json')));
});

test('stale approval: a plan that no longer fits the map is refused with a note and applies nothing', async () => {
  const slug = (await call('POST', '/api/courses', { title: 'Stale Plan' })).json.slug;
  const cdir = path.join(dataDir, 'courses', slug);
  const plan = { approach: 'x', in_scope: ['x'], new_layers: [{ id: 'basics', name: 'Basics' }], new_nodes: [NODE('x')] };
  const open = async () => {
    await setTurn({ goal: GOAL, assessment: ASSESSMENT });
    const id = (await call('POST', '/api/lesson', { course: slug, mode: 'course' })).json.lesson_id;
    const say = () => call('POST', '/api/turn', { course: slug, lesson_id: id, event: { type: 'ask', text: 'ok' } });
    await setTurn({ plan });
    assert.ok((await say()).json.turn.plan, 'plan presented');
    return { id, say };
  };
  const A = await open();
  const B = await open();
  await setTurn({ approved: true, lesson_done: true });
  assert.equal((await B.say()).json.turn.approved, true);
  const refused = await A.say();
  assert.equal(refused.json.turn.approved, false);
  assert.equal(refused.json.turn.lesson_done, false);
  const map = (await call('GET', `/api/courses/${slug}/map`)).json;
  assert.equal(map.nodes.filter((n) => n.id === 'x').length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'course.json'), 'utf8')).layers, [{ id: 'basics', name: 'Basics' }]);
  await setTurn({});
  await A.say();
  assert.match((await lastMessage()).split('EVENT:')[0], /approval refused: the plan no longer fits the map \(new layer id collides with an existing layer: basics\); present a fresh plan/);
  await rm(path.join(dir, 'turn.json'), { force: true });
});

test('instruments: a generated course (lab null) never returns a sim or lab; a shipped course with a lab keeps both', async () => {
  const slug = (await call('POST', '/api/courses', { title: 'No Instruments' })).json.slug;
  const cdir = path.join(dataDir, 'courses', slug);
  await call('GET', `/api/courses/${slug}/map`);
  await writeFile(path.join(cdir, 'state', 'map.json'), JSON.stringify({ nodes: [{ id: 'alpha', title: 'A', layer: 'basics', prereqs: [], truth: 't', status: 'untested', evidence: '' }] }));
  await writeFile(path.join(cdir, 'course.json'), JSON.stringify({ slug, title: 'No Instruments', layers: [{ id: 'basics', name: 'Basics' }], lab: null }));
  const instruments = { sim: { name: 'switch-learning' }, lab: { cmd: 'ls' } };
  await setTurn(instruments);
  const r = await call('POST', '/api/lesson', { course: slug, node_id: 'alpha', mode: 'teach' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.turn.sim, null);
  assert.equal(r.json.turn.lab, null);
  const stored = (await call('GET', `/api/lesson/${r.json.lesson_id}?course=${slug}`)).json.events.filter((e) => e.role === 'tutor');
  assert.ok(stored.every((e) => e.data.sim === null && e.data.lab === null));
  const t = await call('POST', '/api/turn', { course: slug, lesson_id: r.json.lesson_id, event: { type: 'ask', text: 'hi' } });
  assert.equal(t.json.turn.sim, null);
  assert.equal(t.json.turn.lab, null);

  const net = await call('POST', '/api/lesson', { course: 'net', node_id: 'frames-mac', mode: 'teach' });
  assert.deepEqual(net.json.turn.sim, instruments.sim);
  assert.deepEqual(net.json.turn.lab, instruments.lab);
  await rm(path.join(dir, 'turn.json'), { force: true });
});

// --- cancel a running AI call ---
async function waitForCalls(n) {
  for (let i = 0; i < 100; i++) {
    if ((await readCalls()).length >= n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('fake tutor never started');
}

test('cancel during a turn: 200 cancelled, the turn fails as cancelled, lesson log unchanged, next turn works', async () => {
  const before = (await call('GET', `/api/lesson/${lessonId}?course=net`)).json.events;
  const n = (await readCalls()).length;
  await setControl('hang');
  const turnReq = call('POST', '/api/turn', { course: 'net', lesson_id: lessonId, event: { type: 'lost', text: 'cancel me' } });
  await waitForCalls(n + 1);
  const c = await call('POST', '/api/courses/net/cancel', {});
  await setControl('ok');
  assert.equal(c.status, 200, c.text);
  assert.deepEqual(c.json, { cancelled: true });
  const t = await turnReq;
  assert.equal(t.status, 499, t.text);
  assert.equal(t.json.cancelled, true);
  const after = (await call('GET', `/api/lesson/${lessonId}?course=net`)).json.events;
  assert.deepEqual(after, before);
  const again = await call('POST', '/api/turn', { course: 'net', lesson_id: lessonId, event: { type: 'lost', text: 'cancel me' } });
  assert.equal(again.status, 200, again.text);
});

test('cancel during a chapter write: no chapter file, index unchanged, the write can be retried', async () => {
  const { slug, cdir } = await writableCourse('Write Cancel');
  const n = (await readCalls()).length;
  await setControl('hang');
  const w = call('POST', `/api/courses/${slug}/chapters/alpha/write`, {});
  await waitForCalls(n + 1);
  const c = await call('POST', `/api/courses/${slug}/cancel`, {});
  await setControl('ok');
  assert.deepEqual(c.json, { cancelled: true });
  const r = await w;
  assert.equal(r.status, 499, r.text);
  assert.equal((await readCalls()).length, n + 1, 'a cancelled write is not retried');
  assert.deepEqual(await readdir(path.join(cdir, 'chapters')), ['index.json']);
  assert.deepEqual(JSON.parse(await readFile(path.join(cdir, 'chapters', 'index.json'), 'utf8')), []);
  assert.equal((await call('POST', `/api/courses/${slug}/chapters/alpha/write`, {})).status, 201);
});

test('cancel with nothing running is 200 cancelled:false; unknown course is 404', async () => {
  const r = await call('POST', '/api/courses/net/cancel', {});
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { cancelled: false });
  assert.equal((await call('POST', '/api/courses/nope/cancel', {})).status, 404);
});
