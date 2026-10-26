// One-time migration: old flat learner layout -> courses/networking/state/. Run once, then never again.
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
  // map.json moves last, so its presence under state/ means the migration is complete.
  const items = ['propositions.jsonl', 'sessions', 'map.json'].filter((n) => existsSync(path.join(dataDir, n)));
  if (existsSync(target('map.json'))) {
    throw new Error(`already migrated: ${target('map.json')} exists`);
  }
  // Pre-flight: refuse before any move. Never overwrite an existing destination.
  for (const name of items) {
    if (existsSync(target(name))) throw new Error(`cannot migrate: ${target(name)} already exists`);
  }
  // Parse every meta before moving anything, so a malformed file leaves the layout untouched.
  const oldSessions = path.join(dataDir, 'sessions');
  const metas = [];
  if (existsSync(oldSessions)) {
    for (const f of (await readdir(oldSessions)).filter((f) => f.endsWith('.meta.json'))) {
      const file = path.join(oldSessions, f);
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
  for (const name of items) await rename(path.join(dataDir, name), target(name));

  // Atomic rewrite: write a .tmp beside each meta, then rename over it.
  for (const [f, meta] of metas) {
    const file = path.join(target('sessions'), f);
    await writeFile(`${file}.tmp`, JSON.stringify(meta, null, 2));
    await rename(`${file}.tmp`, file);
  }
  return { moved: items };
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
