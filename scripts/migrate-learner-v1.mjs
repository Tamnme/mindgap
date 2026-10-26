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
  if (existsSync(path.join(state, 'map.json'))) {
    throw new Error(`already migrated: ${path.join(state, 'map.json')} exists`);
  }
  await mkdir(state, { recursive: true });

  const moved = [];
  for (const name of ['map.json', 'propositions.jsonl', 'sessions']) {
    const from = path.join(dataDir, name);
    if (!existsSync(from)) continue;
    await rename(from, path.join(state, name));
    moved.push(name);
  }

  const sessions = path.join(state, 'sessions');
  if (existsSync(sessions)) {
    for (const f of (await readdir(sessions)).filter((f) => f.endsWith('.meta.json'))) {
      const file = path.join(sessions, f);
      const meta = JSON.parse(await readFile(file, 'utf8'));
      await writeFile(file, JSON.stringify({ ...meta, course: COURSE }, null, 2));
    }
  }
  return { moved };
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
