#!/usr/bin/env node
// Runs every networking lab command in a fresh Docker container and, with --vm, in the OrbStack netlab VM,
// then compares exit codes. Exit 0 iff the environments agree (or, without --vm, every exit code is 0).
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLab } from '../lib/labs.mjs';
import { loadCourse } from '../lib/courses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COURSES_DIR = process.env.MINDGAP_COURSES_DIR || path.join(ROOT, 'courses');
const DATA_DIR = process.env.MINDGAP_DATA_DIR || path.join(ROOT, 'learner');
const COURSE = 'networking';
const CONTAINER = `mindgap-${COURSE}`;
const TIMEOUT_MS = 30_000;
const CAP = 64 * 1024;
const TAIL = 300;

// Every lab.cmd in document order: JSON key order is document order.
function labCmds(node, out = []) {
  if (Array.isArray(node)) {
    for (const x of node) labCmds(x, out);
  } else if (node && typeof node === 'object') {
    if (node.lab && typeof node.lab.cmd === 'string') out.push(node.lab.cmd);
    for (const v of Object.values(node)) labCmds(v, out);
  }
  return out;
}

async function collect() {
  const dir = path.join(COURSES_DIR, COURSE, 'chapters');
  const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
  const rows = [];
  for (const id of index) {
    const chapter = JSON.parse(await readFile(path.join(dir, `${id}.json`), 'utf8'));
    labCmds(chapter).forEach((cmd, i) => rows.push({ chapter: id, n: i + 1, cmd }));
  }
  return rows;
}

// Same 64 KB cap as lib/labs.mjs capture().
function capped() {
  const chunks = [];
  let size = 0;
  let cut = false;
  return {
    push(c) {
      const room = CAP - size;
      if (c.length > room) cut = true;
      if (room > 0) {
        const part = c.subarray(0, Math.min(room, c.length));
        chunks.push(part);
        size += part.length;
      }
    },
    text: () => Buffer.concat(chunks).toString('utf8') + (cut ? '\n[output truncated at 64 KB]' : ''),
  };
}

// Runs one command in the netlab VM with the same 30 s timeout and 64 KB cap as runLab. stdin is closed.
function runVm(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn('orb', ['-m', 'netlab', '-u', 'root', 'bash', '-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = capped();
    const err = capped();
    let timedOut = false;
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        stdout: out.text(),
        stderr: err.text() + (timedOut ? `\n[killed after ${TIMEOUT_MS / 1000} s]` : ''),
        code: timedOut ? null : code,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      finish(null);
    }, TIMEOUT_MS);
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', finish);
  });
}

// Fresh start: remove the old container, keep the image. Failure (no such container) is fine.
function removeContainer() {
  return new Promise((resolve) => {
    const child = spawn(process.env.DOCKER_BIN || 'docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    child.on('error', resolve);
    child.on('close', resolve);
  });
}

const pad = (s, w) => String(s).padEnd(w);
const show = (code) => (code === null ? 'killed' : String(code));
const tail = (s) => s.slice(-TAIL).trimEnd();

const useVm = process.argv.includes('--vm');
const course = await loadCourse({ coursesDir: COURSES_DIR, dataDir: DATA_DIR }, COURSE);
const rows = await collect();

await removeContainer();
const docker = [];
for (const r of rows) docker.push(await runLab(course, r.cmd));

const vm = [];
if (useVm) for (const r of rows) vm.push(await runVm(r.cmd));

const results = rows.map((r, i) => {
  const d = docker[i];
  const v = useVm ? vm[i] : null;
  const differ = useVm ? d.code !== v.code : d.code !== 0;
  return { ...r, d, v, differ };
});

console.log(`${pad('chapter', 32)}${pad('#', 4)}${pad('docker', 9)}${pad(useVm ? 'vm' : '', 9)}`);
for (const r of results) {
  console.log(`${pad(r.chapter, 32)}${pad(r.n, 4)}${pad(show(r.d.code), 9)}${pad(useVm ? show(r.v.code) : '', 9)}${r.differ ? '<-- DIFF' : ''}`);
}

const diffs = results.filter((r) => r.differ);
console.log(`\nrows: ${results.length}  differences: ${diffs.length}${useVm ? '' : ' (no --vm: counting non-zero docker exits)'}`);
for (const r of diffs) {
  console.log(`\n--- ${r.chapter} #${r.n}: ${r.cmd.slice(0, 200)}`);
  console.log(`docker exit ${show(r.d.code)} stderr tail:\n${tail(r.d.stderr) || '(empty)'}`);
  if (useVm) console.log(`vm exit ${show(r.v.code)} stderr tail:\n${tail(r.v.stderr) || '(empty)'}`);
}

process.exitCode = diffs.length ? 1 : 0;
