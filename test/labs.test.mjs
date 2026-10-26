// Self-check for lib/labs.mjs. Uses a fake docker binary that keeps its state in a file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, chmod, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { labStatus, labRequest, isApproved, approve, runLab } from '../lib/labs.mjs';

// Fake docker: logs argv, keeps image and container state in docker-state.json.
// Containers are {running, label}; inspect prints "<running>|<label>" like the real format string.
// exec with `sh` is the remount; exec with `big` prints 70 KB; any other exec echoes its argv.
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
  const name = args[args.indexOf('--name') + 1];
  const label = (args.find((a) => a.startsWith('mindgap.request=')) ?? '').slice('mindgap.request='.length);
  st.containers[name] = { running: true, label };
  save();
  process.exit(0);
}
if (cmd === 'start') { st.containers[args[1]].running = true; save(); process.exit(0); }
if (cmd === 'rm') { delete st.containers[args.at(-1)]; save(); process.exit(0); }
if (cmd === 'exec') {
  if (args[2] === 'sh') process.exit(0);
  // No process.exit after a large write: it can drop the unflushed pipe data. Let the process end on its own.
  process.stdout.write(args.at(-1) === 'big' ? 'x'.repeat(70 * 1024) : 'EXEC:' + args.slice(1).join(' '));
} else {
  process.exitCode = 2;
}
`;

const REMOUNT = 'mount --bind /proc/sys/net /proc/sys/net && mount -o remount,bind,rw /proc/sys/net';
const NET_LAB = { caps: ['NET_ADMIN', 'SYS_ADMIN'], network: true, hostname: 'netlab' };
const NET_REQUEST = JSON.stringify({ caps: ['NET_ADMIN', 'SYS_ADMIN'], network: true });

let dir;
let fakeBin;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mindgap-labs-'));
  const fakeJs = path.join(dir, 'fake-docker.mjs');
  fakeBin = path.join(dir, 'docker');
  await writeFile(fakeJs, FAKE_DOCKER);
  await writeFile(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${fakeJs}" "$@"\n`);
  await chmod(fakeBin, 0o755);
  process.env.DOCKER_BIN = fakeBin;
  process.env.FAKE_DIR = dir;
});

after(async () => {
  delete process.env.DOCKER_BIN;
  delete process.env.FAKE_DIR;
  if (dir) await rm(dir, { recursive: true, force: true });
});

// Each test gets its own course dir and state dir, so approval files and Dockerfiles never leak between tests.
// The Dockerfile is written at lab.dockerfile, resolved against the course dir, so runLab's containment check sees a real file.
function course(lab, name) {
  const c = {
    slug: 'net',
    title: 'Net',
    layers: [],
    lab: lab === null ? null : { dockerfile: 'lab/Dockerfile', ...lab },
    dir: path.join(dir, 'courses', name),
    stateDir: path.join(dir, 'data', name, 'state'),
  };
  mkdirSync(c.dir, { recursive: true });
  if (c.lab) {
    const file = path.join(c.dir, c.lab.dockerfile);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'FROM scratch\n');
  }
  return c;
}

async function resetDocker(state = { images: {}, containers: {} }) {
  await writeFile(path.join(dir, 'docker-state.json'), JSON.stringify(state));
  await rm(path.join(dir, 'docker-calls.jsonl'), { force: true });
}

async function dockerCalls() {
  try {
    const text = await readFile(path.join(dir, 'docker-calls.jsonl'), 'utf8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// Short names for the calls the runner makes, so the sequence reads at a glance.
const verb = (a) => {
  if (a[0] === 'exec') return a[2] === 'sh' ? 'remount' : 'lab';
  if (a[0] === 'image') return 'image';
  return a[0];
};

test('labStatus: a course without a lab is unavailable and docker is not consulted', async () => {
  const s = await labStatus(course(null, 'no-lab'));
  assert.equal(s.available, false);
  assert.match(s.reason, /no lab/);
});

test('labStatus: available when docker info succeeds', async () => {
  assert.deepEqual(await labStatus(course(NET_LAB, 'avail')), { available: true });
});

test('labStatus: a missing docker binary is unavailable with a reason that names docker', async () => {
  process.env.DOCKER_BIN = '/nonexistent/docker';
  try {
    const s = await labStatus(course(NET_LAB, 'missing'));
    assert.equal(s.available, false);
    assert.match(s.reason, /docker/);
  } finally {
    process.env.DOCKER_BIN = fakeBin;
  }
});

test('labRequest: sorted caps and the network flag; no lab requests nothing', () => {
  assert.deepEqual(labRequest(course(NET_LAB, 'req')), { caps: ['NET_ADMIN', 'SYS_ADMIN'], network: true });
  assert.deepEqual(labRequest(course({ caps: ['SYS_ADMIN', 'NET_ADMIN'], network: false }, 'req2')), { caps: ['NET_ADMIN', 'SYS_ADMIN'], network: false });
  assert.deepEqual(labRequest(course(null, 'req3')), { caps: [], network: false });
});

test('labRequest: a malformed lab config is refused with a clear error', () => {
  assert.throws(() => labRequest(course({ caps: 'NET_ADMIN', network: true }, 'bad-caps')), /lab\.caps/);
  assert.throws(() => labRequest(course({ caps: ['net_admin'], network: true }, 'bad-cap-name')), /lab\.caps/);
  assert.throws(() => labRequest(course({ caps: [], network: 'yes' }, 'bad-network')), /lab\.network/);
});

test('isApproved: an empty request with no network needs no approval file', async () => {
  assert.equal(await isApproved(course({ caps: [], network: false }, 'nothing')), true);
});

test('approve: must equal the request exactly, and the exact request makes isApproved true', async () => {
  const c = course(NET_LAB, 'approve');
  assert.equal(await isApproved(c), false);
  await assert.rejects(approve(c, { caps: ['NET_ADMIN'], network: true }), /does not match/);
  await assert.rejects(approve(c, { caps: ['NET_ADMIN', 'SYS_ADMIN'], network: false }), /does not match/);
  await assert.rejects(approve(c, { caps: 'NET_ADMIN', network: true }), /does not match/);
  assert.equal(await isApproved(c), false);

  await approve(c, { caps: ['SYS_ADMIN', 'NET_ADMIN'], network: true });
  assert.equal(await isApproved(c), true);
  const saved = JSON.parse(await readFile(path.join(c.stateDir, 'lab-approval.json'), 'utf8'));
  assert.deepEqual(saved.caps, ['NET_ADMIN', 'SYS_ADMIN']);
  assert.equal(saved.network, true);
  assert.ok(saved.at);
});

test('isApproved: an approval stops matching when the course asks for something else', async () => {
  const c = course(NET_LAB, 'approve');
  await approve(c, { caps: ['NET_ADMIN', 'SYS_ADMIN'], network: true });
  const changed = course({ caps: ['NET_ADMIN', 'SYS_ADMIN'], network: false }, 'approve');
  assert.equal(await isApproved(changed), false);
});

test('runLab on a missing container: image, build, run, remount, then the command', async () => {
  await resetDocker();
  const c = course(NET_LAB, 'cold');
  const r = await runLab(c, 'echo hi');
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'EXEC:mindgap-net bash -lc echo hi');

  const calls = await dockerCalls();
  assert.deepEqual(calls.map(verb), ['inspect', 'image', 'build', 'run', 'remount', 'lab']);
  assert.ok(calls[2].includes('-t') && calls[2].includes('mindgap-net'));
  assert.ok(calls[2].includes(await realpath(path.join(c.dir, 'lab/Dockerfile'))));
  assert.deepEqual(calls[3], [
    'run', '-d', '--name', 'mindgap-net', '--hostname', 'netlab', '--network', 'bridge',
    '--cap-add', 'NET_ADMIN', '--cap-add', 'SYS_ADMIN', '--label', `mindgap.request=${NET_REQUEST}`, 'mindgap-net',
  ]);
  assert.deepEqual(calls[4].slice(0, 4), ['exec', 'mindgap-net', 'sh', '-c']);
  assert.ok(calls[4][4].includes(REMOUNT));
  assert.deepEqual(calls[5], ['exec', 'mindgap-net', 'bash', '-lc', 'echo hi']);
});

test('runLab on a running container with the same request issues only inspect and exec', async () => {
  await resetDocker({ images: { 'mindgap-net': true }, containers: { 'mindgap-net': { running: true, label: NET_REQUEST } } });
  const r = await runLab(course(NET_LAB, 'warm'), 'echo again');
  assert.equal(r.stdout, 'EXEC:mindgap-net bash -lc echo again');
  assert.deepEqual((await dockerCalls()).map(verb), ['inspect', 'lab']);
});

test('runLab on a stopped container with the same request starts it and remounts again', async () => {
  await resetDocker({ images: { 'mindgap-net': true }, containers: { 'mindgap-net': { running: false, label: NET_REQUEST } } });
  await runLab(course(NET_LAB, 'stopped'), 'echo back');
  const calls = await dockerCalls();
  assert.deepEqual(calls.map(verb), ['inspect', 'start', 'remount', 'lab']);
});

test('runLab replaces a container made for a different request: rm -f, then run -d', async () => {
  const stale = JSON.stringify({ caps: ['NET_ADMIN'], network: false });
  await resetDocker({ images: { 'mindgap-net': true }, containers: { 'mindgap-net': { running: true, label: stale } } });
  await runLab(course(NET_LAB, 'stale'), 'echo new');
  const calls = await dockerCalls();
  assert.deepEqual(calls.map(verb), ['inspect', 'rm', 'image', 'run', 'remount', 'lab']);
  assert.deepEqual(calls[1], ['rm', '-f', 'mindgap-net']);
  assert.ok(calls[3].includes(`mindgap.request=${NET_REQUEST}`));
});

test('runLab without SYS_ADMIN does not remount', async () => {
  await resetDocker();
  await runLab(course({ caps: ['NET_ADMIN'], network: false, hostname: 'netlab' }, 'no-sys'), 'true');
  const calls = await dockerCalls();
  assert.deepEqual(calls.map(verb), ['inspect', 'image', 'build', 'run', 'lab']);
  assert.ok(calls[3].includes('none') && calls[3].includes('NET_ADMIN'));
  assert.ok(!calls.flat().includes('--privileged'));
});

test('runLab refuses a Dockerfile that resolves outside the course directory, before any build', async () => {
  await resetDocker();
  const c = course({ dockerfile: '../../outside/Dockerfile', caps: [], network: false, hostname: 'netlab' }, 'escape');
  await assert.rejects(runLab(c, 'true'), /inside the course directory/);
  const calls = await dockerCalls();
  assert.ok(!calls.some((a) => a[0] === 'build'), `docker was given: ${JSON.stringify(calls)}`);
});

test('runLab truncates output at 64 KB with a marker', async () => {
  await resetDocker({ images: { 'mindgap-net': true }, containers: { 'mindgap-net': { running: true, label: NET_REQUEST } } });
  const r = await runLab(course(NET_LAB, 'big'), 'big');
  assert.ok(r.stdout.length <= 64 * 1024 + 60, `stdout is ${r.stdout.length} chars`);
  assert.match(r.stdout, /truncated at 64 KB/);
});

// Plain shell stand-ins for a docker binary that hangs on `info`, or whose `info` fails.
async function fakeDockerScript(name, body) {
  const bin = path.join(dir, name);
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  return bin;
}

test('labStatus: a docker info that never answers is unavailable after 5 s, naming the timeout', async () => {
  process.env.DOCKER_BIN = await fakeDockerScript('hung-docker', 'exec sleep 30');
  try {
    const started = Date.now();
    const s = await labStatus(course(NET_LAB, 'hung'));
    assert.equal(s.available, false);
    assert.match(s.reason, /timed out after 5 s/);
    assert.ok(Date.now() - started < 6500, `took ${Date.now() - started} ms`);
  } finally {
    process.env.DOCKER_BIN = fakeBin;
  }
});

test('labStatus: a docker info that exits non-zero is unavailable with its stderr in the reason', async () => {
  process.env.DOCKER_BIN = await fakeDockerScript('down-docker', 'echo "Cannot connect to the Docker daemon" >&2\nexit 1');
  try {
    const s = await labStatus(course(NET_LAB, 'down'));
    assert.equal(s.available, false);
    assert.match(s.reason, /Cannot connect to the Docker daemon/);
  } finally {
    process.env.DOCKER_BIN = fakeBin;
  }
});

test('labStatus: a malformed lab block is unavailable with the validation reason and docker is not consulted', async () => {
  await resetDocker();
  const s = await labStatus(course({ ...NET_LAB, caps: 'NET_ADMIN' }, 'malformed'));
  assert.equal(s.available, false);
  assert.match(s.reason, /lab\.caps/);
  assert.equal((await dockerCalls()).length, 0);
});

test('runLab: docker inspect is always told to look at containers, so a same-named image is never matched', async () => {
  await resetDocker({ images: { 'mindgap-net': true }, containers: {} });
  await runLab(course(NET_LAB, 'img-named'), 'true');
  const inspects = (await dockerCalls()).filter((a) => a[0] === 'inspect');
  assert.ok(inspects.length > 0);
  for (const a of inspects) assert.deepEqual(a.slice(1, 3), ['--type', 'container'], JSON.stringify(a));
});
