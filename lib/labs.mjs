// Lab runner: one Docker container per course. Extra privileges run only after the learner approves them.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const LAB_TIMEOUT_MS = 30_000;
const LAB_CAP = 64 * 1024;
// Makes only net.* sysctls writable. Safe to run again: the bind is skipped when /proc/sys/net is already a mount point.
const REMOUNT = 'mountpoint -q /proc/sys/net || mount --bind /proc/sys/net /proc/sys/net && mount -o remount,bind,rw /proc/sys/net';

export class ApprovalMismatch extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApprovalMismatch';
  }
}

const dockerBin = () => process.env.DOCKER_BIN || 'docker';
const containerName = (course) => `mindgap-${course.slug}`;
const approvalPath = (course) => path.join(course.stateDir, 'lab-approval.json');

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
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

// Resolves with what docker printed. Rejects only when the binary cannot be started.
// timeoutMs, when given, SIGKILLs the docker client; the process inside the container is not killed.
function runDocker(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
        stderr: err.text() + (timedOut ? `\n[killed after ${timeoutMs / 1000} s]` : ''),
        code: timedOut ? null : code,
      });
    };
    const timer = timeoutMs === undefined ? null : setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      finish(null);
    }, timeoutMs);
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', finish);
  });
}

async function must(args, what) {
  const r = await runDocker(args);
  if (r.code !== 0) throw new Error(`${what} failed: ${r.stderr.trim().slice(-500)}`);
  return r;
}

// What the learner must approve: the course's extra capabilities and network access. Empty caps and no network need nothing.
export function labRequest(course) {
  return { caps: [...(course.lab?.caps ?? [])].sort(), network: course.lab?.network === true };
}

function sameRequest(got, want) {
  return Array.isArray(got?.caps) && got.caps.every((c) => typeof c === 'string') && got.network === want.network
    && JSON.stringify([...got.caps].sort()) === JSON.stringify(want.caps);
}

export async function labStatus(course) {
  if (!course.lab) return { available: false, reason: 'this course has no lab' };
  let r;
  try {
    r = await runDocker(['info']);
  } catch {
    return { available: false, reason: `docker binary not found: ${dockerBin()}` };
  }
  if (r.code === 0) return { available: true };
  return { available: false, reason: `docker info failed, is the Docker daemon running? ${r.stderr.trim().slice(-200)}` };
}

export async function isApproved(course) {
  const want = labRequest(course);
  if (want.caps.length === 0 && !want.network) return true;
  const text = await readOptional(approvalPath(course));
  if (text === null) return false;
  try {
    return sameRequest(JSON.parse(text), want);
  } catch {
    return false;
  }
}

export async function approve(course, body) {
  const want = labRequest(course);
  const got = { caps: Array.isArray(body?.caps) ? [...body.caps].sort() : null, network: body?.network };
  if (!sameRequest(got, want)) throw new ApprovalMismatch('approval does not match the lab request');
  await mkdir(course.stateDir, { recursive: true });
  await writeFile(approvalPath(course), JSON.stringify({ caps: want.caps, network: want.network, at: new Date().toISOString() }, null, 2) + '\n');
}

async function ensureImage(course, name) {
  if ((await runDocker(['image', 'inspect', name])).code === 0) return;
  const dockerfile = path.join(course.dir, course.lab.dockerfile);
  await must(['build', '-t', name, '-f', dockerfile, path.dirname(dockerfile)], 'docker build');
}

export async function runLab(course, cmd) {
  const name = containerName(course);
  const { caps, network } = labRequest(course);
  const insp = await runDocker(['inspect', '-f', '{{.State.Running}}', name]);
  if (insp.code !== 0) {
    await ensureImage(course, name);
    const netArgs = ['--network', network ? 'bridge' : 'none'];
    const capArgs = caps.flatMap((c) => ['--cap-add', c]);
    await must(['run', '-d', '--name', name, '--hostname', course.lab.hostname, ...netArgs, ...capArgs, name], 'docker run');
    if (caps.includes('SYS_ADMIN')) await must(['exec', name, 'sh', '-c', REMOUNT], 'remount /proc/sys/net');
  } else if (insp.stdout.trim() !== 'true') {
    await must(['start', name], 'docker start');
    if (caps.includes('SYS_ADMIN')) await must(['exec', name, 'sh', '-c', REMOUNT], 'remount /proc/sys/net');
  }
  const r = await runDocker(['exec', name, 'bash', '-lc', cmd], LAB_TIMEOUT_MS);
  return { stdout: r.stdout, stderr: r.stderr, code: r.code };
}
