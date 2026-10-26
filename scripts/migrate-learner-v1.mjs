// One-time migration: old flat learner layout -> courses/networking/state/. Resumable: a re-run finishes a partial move.
// Usage: node scripts/migrate-learner-v1.mjs   (MINDGAP_DATA_DIR, default <repo>/learner)
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COURSE = 'networking';
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Task 3's conversion: a node's twins become links, in the place twins had. Nodes without twins are returned as they are.
const TWIN_LABELS = [['aws', 'AWS'], ['k8s', 'Kubernetes'], ['proxmox', 'Proxmox']];
function toLinks(node) {
  if (!node || typeof node !== 'object' || !('twins' in node)) return node;
  const links = TWIN_LABELS.filter(([key]) => node.twins?.[key]).map(([key, label]) => ({ label, text: node.twins[key] }));
  return Object.fromEntries(Object.entries(node).map(([k, v]) => (k === 'twins' ? ['links', links] : [k, v])));
}

// Renames the claude-only session field and tags the lesson's tutor. Metas already migrated are left as they are.
function toTutorMeta(meta) {
  const { claude_session_id, ...rest } = meta;
  if (claude_session_id !== undefined) rest.tutor_session_id = claude_session_id;
  rest.tutor ??= 'claude';
  rest.course = COURSE;
  return rest;
}

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

  // Parse the map too: it is rewritten (twins -> links), not just moved.
  let map = null;
  if (moves.includes('map.json')) {
    try {
      map = JSON.parse(await readFile(old('map.json'), 'utf8'));
    } catch (err) {
      throw new Error(`cannot migrate: ${old('map.json')} is not valid JSON (${err.message})`);
    }
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`cannot migrate: ${old('map.json')} is not a JSON object`);
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
      metas.push([f, toTutorMeta(meta)]);
    }
  }

  await mkdir(state, { recursive: true });
  for (const name of moves) if (name !== 'map.json') await rename(old(name), target(name));

  // The map goes last. Write the converted copy beside it, rename it into place, then remove the old file.
  if (map) {
    const converted = Array.isArray(map.nodes) ? { ...map, nodes: map.nodes.map(toLinks) } : map;
    await writeFile(`${target('map.json')}.tmp`, JSON.stringify(converted, null, 2) + '\n');
    await rename(`${target('map.json')}.tmp`, target('map.json'));
    await rm(old('map.json'));
  }

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
