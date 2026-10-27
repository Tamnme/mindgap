// Source helpers: the caps, the id check, the split into sections, and import/list/read/remove.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

export const MB = 1024 * 1024;
export const FETCH_MAX = 10 * MB;
export const FETCH_TIMEOUT_MS = 30_000;
export const UPLOAD_MAX = 20 * MB;
export const CONVERT_TIMEOUT_MS = 60_000;
export const TEXT_MAX = 1 * MB;
export const SECTION_MAX = 6000;
export const EXCERPT_MAX = 20000;
export const READ_MAX = 5;

// Same rule as server.mjs: ids are safe as file names and URL segments.
export function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

// Markdown → [{id, heading, text}]. A section is the text under one #–### heading (fences respected).
// Text before the first heading takes the title. Sections over SECTION_MAX are cut into chunks.
// ponytail: whole-text string slicing per chunk; fine at TEXT_MAX, revisit only if sources get huge.
export function splitSections(markdown, sourceId, title) {
  const raw = [];
  let cur = { heading: title, lines: [] };
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    const m = !fenced && /^#{1,3} +(.+)$/.exec(line);
    if (m) {
      raw.push(cur);
      cur = { heading: m[1].trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  raw.push(cur);

  const out = [];
  for (const { heading, lines } of raw) {
    let rest = lines.join('\n').trim();
    for (let part = 1; rest; part++) {
      const chunk = takeChunk(rest);
      rest = chunk.rest;
      out.push({ heading: part === 1 ? heading : `${heading} (${part})`, text: chunk.text });
    }
  }
  return out.map((s, i) => ({ id: `${sourceId}-${i + 1}`, heading: s.heading, text: s.text }));
}

// The first chunk of a trimmed, non-empty text: the longest prefix ending at a blank line
// whose trimmed length is within SECTION_MAX; with no such line, a hard cut at SECTION_MAX.
function takeChunk(text) {
  if (text.length <= SECTION_MAX) return { text, rest: '' };
  const blank = /\n[ \t]*\n/g;
  let cut = null;
  for (let m; (m = blank.exec(text)); ) {
    if (text.slice(0, m.index).trimEnd().length > SECTION_MAX) break;
    cut = m;
  }
  if (!cut) return { text: text.slice(0, SECTION_MAX).trim(), rest: text.slice(SECTION_MAX).trim() };
  return { text: text.slice(0, cut.index).trim(), rest: text.slice(cut.index + cut[0].length).trim() };
}

export class SourceError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    if (body) this.body = body;
  }
}

async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

// Reads the response body, giving up (413) once it passes FETCH_MAX.
async function fetchBytes(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    throw new SourceError(502, `could not fetch ${url}: ${e.cause?.message ?? e.message}`);
  }
  if (!res.ok) throw new SourceError(502, `could not fetch ${url}: HTTP ${res.status}`);
  const chunks = [];
  let n = 0;
  try {
    for await (const c of res.body) {
      n += c.length;
      if (n > FETCH_MAX) {
        await res.body.cancel().catch(() => {});
        throw new SourceError(413, `${url} is larger than ${FETCH_MAX / MB} MB`);
      }
      chunks.push(c);
    }
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(502, `could not fetch ${url}: ${e.message}`);
  }
  return { bytes: Buffer.concat(chunks), type: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() };
}

async function convert(bytes, hint) {
  const cwd = await mkdtemp(join(tmpdir(), 'mindgap-md-'));
  try {
    const bin = process.env.MARKITDOWN_BIN || 'markitdown';
    return await new Promise((resolve, reject) => {
      const child = execFile(bin, ['-x', hint], { cwd, timeout: CONVERT_TIMEOUT_MS, maxBuffer: 64 * MB, encoding: 'utf8' },
        (err, stdout, stderr) => {
          if (!err) return resolve(stdout);
          if (err.code === 'ENOENT') return reject(new SourceError(503, 'markitdown is not installed', { error: 'markitdown is not installed', install: "pip install 'markitdown[all]'" }));
          const why = (stderr || err.message).slice(0, 500);
          reject(new SourceError(422, `conversion failed: ${why}`, { error: 'conversion failed', stderr: why }));
        });
      child.stdin.on('error', () => {});
      child.stdin.end(bytes);
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

// ponytail: id is the millisecond clock, bumped until unused; two servers importing in one ms is not a case.
async function freeId(dir) {
  let t = Date.now();
  const have = new Set(await readdir(dir));
  while (have.has(`s${t.toString(36)}.json`)) t++;
  return `s${t.toString(36)}`;
}

export async function importSource(dir, input) {
  let bytes, hint, origin, fallbackTitle;
  if (input.url !== undefined) {
    let u;
    try { u = new URL(input.url); } catch { throw new SourceError(400, 'not a valid URL'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SourceError(400, 'only http and https URLs can be imported');
    const got = await fetchBytes(u.href);
    bytes = got.bytes;
    hint = got.type === 'text/html' ? 'html' : got.type === 'application/pdf' ? 'pdf' : extname(u.pathname).slice(1).toLowerCase() || 'html';
    origin = { kind: 'url', value: input.url };
    fallbackTitle = u.hostname + u.pathname;
  } else {
    const { filename, data } = input;
    if (typeof filename !== 'string' || !filename || !Buffer.isBuffer(data)) throw new SourceError(400, 'filename and data are required');
    if (data.length > UPLOAD_MAX) throw new SourceError(413, `file is larger than ${UPLOAD_MAX / MB} MB`);
    hint = extname(filename).slice(1).toLowerCase();
    if (!hint) throw new SourceError(400, 'filename needs an extension');
    bytes = data;
    origin = { kind: 'file', value: filename };
    fallbackTitle = filename;
  }

  let text = (await convert(bytes, hint)).replace(/\r\n/g, '\n');
  const truncated = text.length > TEXT_MAX;
  if (truncated) text = text.slice(0, TEXT_MAX);
  const title = pickTitle(text) || fallbackTitle;

  await mkdir(dir, { recursive: true });
  const id = await freeId(dir);
  const source = { id, title, origin, added: new Date().toISOString(), truncated, sections: splitSections(text, id, title) };
  await writeAtomic(join(dir, `${id}.json`), JSON.stringify(source) + '\n');
  return summarise(source);
}

// First level-1 heading outside code fences, else the first #-###; trailing #s stripped.
function pickTitle(text) {
  let fenced = false, any = null;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    const m = !fenced && /^(#{1,3}) +(.+)$/.exec(line);
    if (!m) continue;
    const h = m[2].replace(/[\s#]+$/, '');
    if (!h) continue;
    if (m[1] === '#') return h;
    any ??= h;
  }
  return any;
}

const summarise = (s) => ({
  id: s.id, title: s.title, origin: s.origin, added: s.added, truncated: s.truncated,
  sections: s.sections.map((x) => ({ id: x.id, heading: x.heading, chars: x.text.length })),
});

async function loadAll(dir) {
  let names;
  try { names = await readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const n of names.filter((n) => n.endsWith('.json') && validId(n.slice(0, -5))).sort()) {
    try {
      const x = JSON.parse(await readFile(join(dir, n), 'utf8'));
      if (x && typeof x.id === 'string' && typeof x.added === 'string' && Array.isArray(x.sections)) out.push(x);
    } catch { /* unreadable file: skip */ }
  }
  return out.sort((a, b) => a.added.localeCompare(b.added) || a.id.localeCompare(b.id));
}

export async function listSources(dir) {
  return (await loadAll(dir)).map(summarise);
}

export async function sectionIds(dir) {
  return new Set((await loadAll(dir)).flatMap((s) => s.sections.map((x) => x.id)));
}

export async function readSections(dir, ids, cap = EXCERPT_MAX) {
  const byId = new Map();
  for (const s of await loadAll(dir)) for (const x of s.sections) byId.set(x.id, { id: x.id, source: s.id, heading: x.heading, text: x.text });
  const out = [];
  let total = 0;
  for (const id of ids) {
    const x = byId.get(id);
    if (!x) continue;
    if (total + x.text.length > cap) break;
    total += x.text.length;
    out.push(x);
  }
  return out;
}

export async function removeSource(dir, id) {
  if (!validId(id)) return false;
  try { await unlink(join(dir, `${id}.json`)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
