// Self-check for scripts/migrate-learner-v1.mjs and the server's old-layout guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../scripts/migrate-learner-v1.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');

const MAP = JSON.stringify({ nodes: [{ id: 'frames-mac', status: 'gap' }] }, null, 2) + '\n';
const PROPS = JSON.stringify({ claim: 'Frames carry MAC', node: 'frames-mac' }) + '\n';
const META = { id: 'x-1', node_id: 'x', status: 'done' };
const TRANSCRIPT = JSON.stringify({ ts: 't', role: 'tutor', say: 'hi' }) + '\n';

async function oldLayout(dataDir) {
  await mkdir(path.join(dataDir, 'sessions'), { recursive: true });
  await writeFile(path.join(dataDir, 'map.json'), MAP);
  await writeFile(path.join(dataDir, 'propositions.jsonl'), PROPS);
  await writeFile(path.join(dataDir, 'sessions', 'x-1.meta.json'), JSON.stringify(META, null, 2));
  await writeFile(path.join(dataDir, 'sessions', 'x-1.jsonl'), TRANSCRIPT);
}

test('migrate moves old files into courses/networking/state and adds course to meta', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mindgap-migrate-'));
  try {
    await oldLayout(dataDir);
    const { moved } = await migrate(dataDir);
    assert.ok(moved.length > 0);

    const state = path.join(dataDir, 'courses', 'networking', 'state');
    assert.equal(await readFile(path.join(state, 'map.json'), 'utf8'), MAP);
    assert.equal(await readFile(path.join(state, 'propositions.jsonl'), 'utf8'), PROPS);
    assert.equal(await readFile(path.join(state, 'sessions', 'x-1.jsonl'), 'utf8'), TRANSCRIPT);
    const meta = JSON.parse(await readFile(path.join(state, 'sessions', 'x-1.meta.json'), 'utf8'));
    assert.deepEqual(meta, { ...META, course: 'networking' });

    assert.equal(existsSync(path.join(dataDir, 'map.json')), false);
    assert.equal(existsSync(path.join(dataDir, 'propositions.jsonl')), false);
    assert.equal(existsSync(path.join(dataDir, 'sessions')), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('migrate refuses when target state/map.json already exists, moving nothing', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mindgap-migrate-'));
  try {
    await oldLayout(dataDir);
    await migrate(dataDir);
    await oldLayout(dataDir);
    await assert.rejects(migrate(dataDir), /already/);
    assert.equal(existsSync(path.join(dataDir, 'map.json')), true);
    assert.equal(existsSync(path.join(dataDir, 'sessions', 'x-1.meta.json')), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('server refuses to start on an old-layout data dir and points at the migration script', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mindgap-migrate-'));
  try {
    await oldLayout(dataDir);
    const srv = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PORT: '0', MINDGAP_DATA_DIR: dataDir, MINDGAP_COURSES_DIR: path.join(dataDir, 'none') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    srv.stderr.on('data', (c) => (stderr += c));
    const code = await new Promise((resolve) => srv.on('exit', resolve));
    assert.notEqual(code, 0);
    assert.match(stderr, /node scripts\/migrate-learner-v1\.mjs/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
