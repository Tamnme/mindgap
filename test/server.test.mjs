// Self-check for server.mjs. Runs the real server against fake claude/orb binaries.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');
const CONTRACTS = path.join(HERE, '..', 'CONTRACTS.md');
const EVENT_PREFIX = 'EVENT:\n';
const CONTEXT_PREFIX = 'CONTEXT:\n';

const MAP = {
  nodes: [
    { id: 'frames-mac', title: 'Frames carry MAC', layer: 'L2', prereqs: [], truth: 't', twins: {}, lab: '', sim: null, sources: [], status: 'gap', evidence: '' },
    { id: 'switch-mac-table', title: 'Switch: MAC to port', layer: 'L2', prereqs: ['frames-mac'], truth: 't', twins: {}, lab: '', sim: 'switch-learning', sources: [], status: 'untested', evidence: '' },
    { id: 'vlan-basics', title: 'VLANs', layer: 'L2', prereqs: [], truth: 't', twins: {}, lab: '', sim: null, sources: [], status: 'untested', evidence: '' },
  ],
};

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

const FAKE_ORB = `
process.stdout.write('ORB:' + process.argv.slice(2).join(' '));
`;

let dir;
let dataDir;
let child;
let port;
let lessonId;

function call(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {};
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
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

const setControl = (v) => writeFile(path.join(dir, 'control'), v);

async function readJsonl(file) {
  const text = await readFile(file, 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'underlay-test-'));
  dataDir = path.join(dir, 'learner');
  await mkdir(dataDir);
  await writeFile(path.join(dataDir, 'map.json'), JSON.stringify(MAP, null, 2));

  const claudeJs = path.join(dir, 'fake-claude.mjs');
  const orbJs = path.join(dir, 'fake-orb.mjs');
  await writeFile(claudeJs, FAKE_CLAUDE);
  await writeFile(orbJs, FAKE_ORB);
  const claudeBin = path.join(dir, 'claude');
  const orbBin = path.join(dir, 'orb');
  await writeFile(claudeBin, `#!/bin/sh\nexec "${process.execPath}" "${claudeJs}" "$@"\n`);
  await writeFile(orbBin, `#!/bin/sh\nexec "${process.execPath}" "${orbJs}" "$@"\n`);
  await chmod(claudeBin, 0o755);
  await chmod(orbBin, 0o755);

  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: '0',
      UNDERLAY_DATA_DIR: dataDir,
      UNDERLAY_MODEL: 'opus',
      CLAUDE_BIN: claudeBin,
      ORB_BIN: orbBin,
      FAKE_DIR: dir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  port = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${stderr}`)));
  });
});

after(async () => {
  if (child) child.kill();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('lesson start and turn: argv, node_update applied, proposition appended', async () => {
  const start = await call('POST', '/api/lesson', { node_id: 'switch-mac-table', mode: 'teach' });
  assert.equal(start.status, 200, start.text);
  lessonId = start.json.lesson_id;
  assert.match(lessonId, /^switch-mac-table-\d+$/);
  assert.equal(start.json.turn.say, 'hi');

  const first = (await readCalls()).at(-1);
  assert.deepEqual(first.slice(0, 4), ['-p', '--safe-mode', '--tools', '']);
  assert.equal(first[first.indexOf('--model') + 1], 'opus');
  assert.ok(!first.includes('--resume'));
  const message = first.at(-1);
  assert.ok(message.startsWith(CONTEXT_PREFIX));
  const ctx = JSON.parse(message.slice(CONTEXT_PREFIX.length));
  assert.equal(ctx.target.id, 'switch-mac-table');
  assert.deepEqual(ctx.prereqs, [{ id: 'frames-mac', title: 'Frames carry MAC', status: 'gap' }]);
  assert.deepEqual(ctx.other_nodes.map((n) => n.id), ['vlan-basics']);

  const map = await call('GET', '/api/map');
  const node = map.json.nodes.find((n) => n.id === 'switch-mac-table');
  assert.equal(node.status, 'shaky');
  assert.equal(node.evidence, 'said IP to MAC');

  const props = await readJsonl(path.join(dataDir, 'propositions.jsonl'));
  assert.equal(props.length, 1);
  assert.equal(props[0].claim, 'Switch learns MAC from source');
  assert.equal(props[0].lesson_id, lessonId);
  assert.ok(props[0].ts);

  const t = await call('POST', '/api/turn', { lesson_id: lessonId, event: { type: 'answer', choice: 'A', confidence: 4 } });
  assert.equal(t.status, 200, t.text);
  assert.equal(t.json.turn.say, 'next');

  const second = (await readCalls()).at(-1);
  assert.equal(second[second.indexOf('--resume') + 1], 'sess-abc');
  assert.ok(second.at(-1).startsWith(EVENT_PREFIX));
  assert.equal(JSON.parse(second.at(-1).slice(EVENT_PREFIX.length)).type, 'answer');

  const map2 = await call('GET', '/api/map');
  assert.equal(map2.json.nodes.find((n) => n.id === 'frames-mac').status, 'solid');
  assert.equal((await readJsonl(path.join(dataDir, 'propositions.jsonl'))).length, 2);

  const lesson = await call('GET', `/api/lesson/${lessonId}`);
  assert.equal(lesson.status, 200);
  assert.deepEqual(lesson.json.events.map((e) => e.role), ['system', 'tutor', 'learner', 'tutor']);
});

test('second concurrent turn on the same lesson gets 409', async () => {
  await setControl('slow');
  try {
    const [a, b] = await Promise.all([
      call('POST', '/api/turn', { lesson_id: lessonId, event: { type: 'lost' } }),
      call('POST', '/api/turn', { lesson_id: lessonId, event: { type: 'lost' } }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  } finally {
    await setControl('ok');
  }
});

test('lab output is recorded and included in the next tutor message only', async () => {
  const lab = await call('POST', '/api/lab', { lesson_id: lessonId, cmd: 'ip -br link' });
  assert.equal(lab.status, 200, lab.text);
  assert.equal(lab.json.code, 0);
  assert.match(lab.json.stdout, /ORB:-m netlab -u root bash -lc ip -br link/);

  const t = await call('POST', '/api/turn', { lesson_id: lessonId, event: { type: 'lost', text: '?' } });
  assert.equal(t.status, 200, t.text);
  const withLab = (await readCalls()).at(-1).at(-1);
  assert.ok(withLab.startsWith(EVENT_PREFIX));
  assert.match(withLab, /LAB_OUTPUT/);
  assert.ok(withLab.includes('ip -br link'));
  assert.ok(withLab.includes('ORB:'));

  await call('POST', '/api/turn', { lesson_id: lessonId, event: { type: 'ask', text: 'why' } });
  const withoutLab = (await readCalls()).at(-1).at(-1);
  assert.ok(!withoutLab.includes('LAB_OUTPUT'));

  const lesson = await call('GET', `/api/lesson/${lessonId}`);
  assert.ok(lesson.json.events.some((e) => e.role === 'lab' && e.data.type === 'lab_output' && e.data.cmd === 'ip -br link'));
});

test('claude is_error becomes HTTP 502 with the message', async () => {
  await setControl('error');
  try {
    const r = await call('POST', '/api/turn', { lesson_id: lessonId, event: { type: 'lost' } });
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
    assert.ok(!r.text.includes('underlay contracts'), p);
  }
  const contracts = await readFile(CONTRACTS, 'utf8');
  assert.ok(contracts.length > 0);
  const missing = await call('GET', '/nope.html');
  assert.equal(missing.status, 404);
});

test('unknown lesson, oversized body and bad lab cmd are rejected', async () => {
  const unknown = await call('POST', '/api/turn', { lesson_id: 'nope-1', event: { type: 'lost' } });
  assert.equal(unknown.status, 404);

  const big = await call('POST', '/api/lab', { lesson_id: lessonId, cmd: 'x'.repeat(300 * 1024) });
  assert.equal(big.status, 413);

  const long = await call('POST', '/api/lab', { lesson_id: lessonId, cmd: 'x'.repeat(4001) });
  assert.equal(long.status, 400);

  const empty = await call('POST', '/api/lab', { lesson_id: lessonId, cmd: '   ' });
  assert.equal(empty.status, 400);
});

test('chapter lesson: no tutor call to create, reused, context on first event, answers kept when the tutor fails', async () => {
  const callsBefore = (await readCalls()).length;
  const a = await call('POST', '/api/chapter', { node_id: 'switch-mac-table' });
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.meta.mode, 'chapter');
  assert.deepEqual(a.json.events, []);
  assert.equal((await readCalls()).length, callsBefore);
  const b = await call('POST', '/api/chapter', { node_id: 'switch-mac-table' });
  assert.equal(b.json.lesson_id, a.json.lesson_id);
  const id = a.json.lesson_id;

  const ev = { type: 'checkpoint', id: 'c1', chosen: 'x', key: 'y', correct: false, confidence: 2 };
  const t1 = await call('POST', '/api/turn', { lesson_id: id, event: ev });
  assert.equal(t1.status, 200, t1.text);
  const first = (await readCalls()).at(-1);
  assert.ok(!first.includes('--resume'));
  const msg = first.at(-1);
  assert.ok(msg.startsWith(CONTEXT_PREFIX));
  const ctx = JSON.parse(msg.slice(CONTEXT_PREFIX.length, msg.indexOf('\nEVENT:\n')));
  assert.equal(ctx.mode, 'chapter');
  assert.match(ctx.chapter_source, /export default/);
  assert.equal(JSON.parse(msg.slice(msg.indexOf('\nEVENT:\n') + 8)).id, 'c1');
  assert.ok(first[first.indexOf('--system-prompt-file') + 1].endsWith('chapter.md'));

  await setControl('error');
  try {
    const t2 = await call('POST', '/api/turn', { lesson_id: id, event: { ...ev, id: 'c2' } });
    assert.equal(t2.status, 502);
  } finally {
    await setControl('ok');
  }
  const second = (await readCalls()).at(-1);
  assert.equal(second[second.indexOf('--resume') + 1], 'sess-abc');
  assert.ok(second.at(-1).startsWith(EVENT_PREFIX));

  const lesson = await call('GET', `/api/lesson/${id}`);
  assert.deepEqual(lesson.json.events.map((e) => `${e.role}:${e.data.id ?? ''}`), ['learner:c1', 'tutor:', 'learner:c2']);

  assert.equal((await call('POST', '/api/chapter', { node_id: 'vlan-basics' })).status, 404);
  assert.equal((await call('POST', '/api/lesson', { node_id: 'switch-mac-table', mode: 'chapter' })).status, 400);
});

test('first run copies the clean seed map into an empty data dir', async () => {
  const fresh = path.join(dir, 'fresh');
  const srv = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: '0', UNDERLAY_DATA_DIR: fresh },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const freshPort = await new Promise((resolve, reject) => {
      let out = '';
      srv.stdout.on('data', (c) => {
        out += c;
        const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (m) resolve(Number(m[1]));
      });
      srv.on('exit', (code) => reject(new Error(`server exited ${code}`)));
    });
    const map = await (await fetch(`http://127.0.0.1:${freshPort}/api/map`)).json();
    const seed = JSON.parse(await readFile(path.join(HERE, '..', 'learner', 'map.seed.json'), 'utf8'));
    assert.equal(map.nodes.length, seed.nodes.length);
    assert.ok(map.nodes.every((n) => n.status === 'untested' && n.evidence === ''));
  } finally {
    srv.kill();
  }
});
