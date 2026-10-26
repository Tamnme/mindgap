// One-time migration: old flat learner layout -> courses/networking/state/. Resumable: a re-run finishes a partial move.
// Usage: node scripts/migrate-learner-v1.mjs   (MINDGAP_DATA_DIR, default <repo>/learner)
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COURSE = 'networking';
const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(dataDir) {
  const state = path.join(dataDir, 'courses', COURSE, 'state');
  const target = (name) => path.join(state, name);
  const old = (name) => path.join(dataDir, name);

  if (!existsSync(old('map.json'))) {
    if (existsSync(target('map.json'))) throw new Error(`already migrated: ${target('map.json')} exists`);
    throw new Error(`nothing to migrate: no map.json in ${dataDir}`);
  }

  // Decide per item from what exists. map.json is last, so its presence in state/ means complete.
  const moves = [];
  for (const name of ['propositions.jsonl', 'sessions', 'map.json']) {
    const o = existsSync(old(name));
    const d = existsSync(target(name));
    if (o && d) throw new Error(`cannot migrate: ${old(name)} and ${target(name)} both exist`);
    if (o) moves.push(name);
  }

  // Parse every meta before moving anything, so a malformed file leaves the layout untouched.
  // Read from old sessions/ if still there, else from state/sessions/ (already moved by an earlier run).
  const metaDir = existsSync(old('sessions')) ? old('sessions') : target('sessions');
  const metas = [];
  if (existsSync(metaDir)) {
    for (const f of (await readdir(metaDir)).filter((f) => f.endsWith('.meta.json'))) {
      const file = path.join(metaDir, f);
      let meta;
      try {
        meta = JSON.parse(await readFile(file, 'utf8'));
      } catch (err) {
        throw new Error(`cannot migrate: ${file} is not valid JSON (${err.message})`);
      }
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        throw new Error(`cannot migrate: ${file} is not a JSON object`);
      }
      metas.push([f, { ...meta, course: COURSE }]);
    }
  }

  await mkdir(state, { recursive: true });
  for (const name of moves) await rename(old(name), target(name));

  // Atomic rewrite: write a .tmp beside each meta, then rename over it. Idempotent: same course value.
  for (const [f, meta] of metas) {
    const file = path.join(target('sessions'), f);
    await writeFile(`${file}.tmp`, JSON.stringify(meta, null, 2));
    await rename(`${file}.tmp`, file);
  }
  return { moved: moves };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const dataDir = path.resolve(process.env.MINDGAP_DATA_DIR || path.join(HERE, '..', 'learner'));
  migrate(dataDir)
    .then(({ moved }) => console.log(`migrated ${dataDir}: ${moved.join(', ') || 'nothing to move'}`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
