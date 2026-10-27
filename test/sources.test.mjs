// Self-check for lib/sources.mjs: how converted Markdown is split into sections, and their ids and headings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, chmod, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  splitSections, SECTION_MAX, MB, TEXT_MAX,
  importSource, listSources, readSections, sectionIds, removeSource, SourceError,
} from '../lib/sources.mjs';

test('headings split sections, text is trimmed, ids run in document order', () => {
  assert.deepEqual(splitSections('# A\nx\n## B\ny', 's1', 'T'), [
    { id: 's1-1', heading: 'A', text: 'x' },
    { id: 's1-2', heading: 'B', text: 'y' },
  ]);
});

test('text with no headings is chunked at blank lines under the title', () => {
  const paras = Array.from({ length: 140 }, () => 'a'.repeat(100));
  const out = splitSections(paras.join('\n\n'), 's1', 'T');
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((s) => s.heading), ['T', 'T (2)', 'T (3)']);
  assert.deepEqual(out.map((s) => s.id), ['s1-1', 's1-2', 's1-3']);
  for (const s of out) {
    assert.ok(s.text.length <= SECTION_MAX);
    assert.ok(s.text.split('\n\n').every((p) => p.length === 100), 'cut at a blank line');
  }
});

test('a single paragraph longer than the cap is hard-cut at the cap', () => {
  const out = splitSections('x'.repeat(7000), 's1', 'T');
  assert.deepEqual(out, [
    { id: 's1-1', heading: 'T', text: 'x'.repeat(6000) },
    { id: 's1-2', heading: 'T (2)', text: 'x'.repeat(1000) },
  ]);
});

test('a heading inside a code fence stays text', () => {
  const out = splitSections('# real\n```\n# not a heading\n```', 's1', 'T');
  assert.deepEqual(out, [{ id: 's1-1', heading: 'real', text: '```\n# not a heading\n```' }]);
});

test('four-hash lines are text, not headings', () => {
  const out = splitSections('# A\n#### deep', 's1', 'T');
  assert.deepEqual(out, [{ id: 's1-1', heading: 'A', text: '#### deep' }]);
});

test('whitespace-only sections are dropped before numbering', () => {
  const out = splitSections('# A\n\n## B\nbody', 's1', 'T');
  assert.deepEqual(out, [{ id: 's1-1', heading: 'B', text: 'body' }]);
});

// ---- import / list / read / remove ----

async function fake(tmp, name, body) {
  const f = join(tmp, name);
  await writeFile(f, `#!/usr/bin/env node\n${body}`);
  await chmod(f, 0o755);
  return f;
}
const ECHO = `const fs=require('fs');const i=process.argv.indexOf('-x');
fs.writeFileSync(process.env.HINT_FILE, process.argv[i+1]);
process.stdout.write(fs.readFileSync(0));`;

async function setup(t) {
  const tmp = await mkdtemp(join(tmpdir(), 'mg-src-'));
  const old = { b: process.env.MARKITDOWN_BIN, h: process.env.HINT_FILE };
  t.after(async () => {
    process.env.MARKITDOWN_BIN = old.b; process.env.HINT_FILE = old.h;
    if (old.b === undefined) delete process.env.MARKITDOWN_BIN;
    if (old.h === undefined) delete process.env.HINT_FILE;
    await rm(tmp, { recursive: true, force: true });
  });
  process.env.MARKITDOWN_BIN = await fake(tmp, 'md', ECHO);
  process.env.HINT_FILE = join(tmp, 'hint');
  return { tmp, dir: join(tmp, 'sources'), hint: () => readFile(join(tmp, 'hint'), 'utf8') };
}

async function serve(t, handler) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections?.(); return new Promise((r) => srv.close(r)); });
  return `http://127.0.0.1:${srv.address().port}`;
}

const fails = (p, status) => assert.rejects(p, (e) => e instanceof SourceError && e.status === status);

test('URL import: html hint, title from heading, round trip list/read/remove', async (t) => {
  const { dir, hint } = await setup(t);
  const base = await serve(t, (q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('# Doc\nbody\n## Two\nmore'); });
  const s = await importSource(dir, { url: `${base}/page` });
  assert.equal(await hint(), 'html');
  assert.equal(s.title, 'Doc');
  assert.equal(s.origin.kind, 'url');
  assert.equal(s.origin.value, `${base}/page`);
  assert.equal(s.truncated, false);
  const list = await listSources(dir);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].sections.map((x) => x.heading), ['Doc', 'Two']);
  assert.ok(list[0].sections.every((x) => typeof x.chars === 'number' && !('text' in x)));
  const ids = [...(await sectionIds(dir))];
  assert.equal(ids.length, 2);
  const got = await readSections(dir, [ids[1], 'nope', ids[0]]);
  assert.deepEqual(got.map((x) => x.heading), ['Two', 'Doc']);
  assert.equal(got[0].source, s.id);
  assert.equal(got[0].text, 'more');
  assert.equal(await removeSource(dir, s.id), true);
  assert.equal(await removeSource(dir, s.id), false);
  assert.deepEqual(await listSources(dir), []);
});

test('file import: extension is the hint, filename the title, CRLF normalised', async (t) => {
  const { dir, hint } = await setup(t);
  const s = await importSource(dir, { filename: 'notes.PDF', data: Buffer.from('a\r\nb') });
  assert.equal(await hint(), 'pdf');
  assert.equal(s.title, 'notes.PDF');
  assert.equal(s.origin.value, 'notes.PDF');
  await fails(importSource(dir, { filename: 'noext', data: Buffer.from('x') }), 400);
});

test('bad input: non-http URL 400, oversize upload 413, oversize fetch 413, fetch failure 502', async (t) => {
  const { dir } = await setup(t);
  await fails(importSource(dir, { url: 'ftp://x' }), 400);
  await fails(importSource(dir, { filename: 'a.pdf', data: Buffer.alloc(20 * MB + 1) }), 413);
  const base = await serve(t, (q, r) => {
    if (q.url === '/big') { r.setHeader('content-type', 'text/html'); r.end(Buffer.alloc(10 * MB + 1)); }
    else { r.statusCode = 404; r.end('no'); }
  });
  await fails(importSource(dir, { url: `${base}/big` }), 413);
  await fails(importSource(dir, { url: `${base}/missing` }), 502);
});

test('markitdown missing is 503 with the install line; failure is 422 with stderr', async (t) => {
  const { tmp, dir } = await setup(t);
  process.env.MARKITDOWN_BIN = join(tmp, 'nowhere');
  await assert.rejects(importSource(dir, { filename: 'a.pdf', data: Buffer.from('x') }), (e) =>
    e.status === 503 && e.body.install === "pip install 'markitdown[all]'");
  process.env.MARKITDOWN_BIN = await fake(tmp, 'bad', `process.stderr.write('boom');process.exit(1);`);
  await assert.rejects(importSource(dir, { filename: 'a.pdf', data: Buffer.from('x') }), (e) =>
    e.status === 422 && /boom/.test(e.message + JSON.stringify(e.body ?? '')));
});

test('converted text past TEXT_MAX is truncated, not an error', async (t) => {
  const { tmp, dir } = await setup(t);
  process.env.MARKITDOWN_BIN = await fake(tmp, 'big', `process.stdout.write('a'.repeat(${TEXT_MAX + 1}));`);
  const s = await importSource(dir, { filename: 'a.pdf', data: Buffer.from('x') });
  assert.equal(s.truncated, true);
  const total = (await listSources(dir))[0].sections.reduce((n, x) => n + x.chars, 0);
  assert.ok(total <= TEXT_MAX);
});

test('readSections stops before the section that would pass cap; removeSource rejects bad ids; list ignores stray files', async (t) => {
  const { dir } = await setup(t);
  const s = await importSource(dir, { filename: 'a.md', data: Buffer.from('# A\n' + 'x'.repeat(10) + '\n# B\n' + 'y'.repeat(10) + '\n# C\n' + 'z'.repeat(3)) });
  const ids = s.sections.map((x) => x.id);
  assert.deepEqual((await readSections(dir, ids, 20)).map((x) => x.heading), ['A', 'B']);
  assert.deepEqual((await readSections(dir, ids, 5)).map((x) => x.heading), []);
  assert.equal(await removeSource(dir, '../x'), false);
  await writeFile(join(dir, 'x.json.1.abcd.tmp'), '{');
  await writeFile(join(dir, 'README'), 'hi');
  assert.equal((await listSources(dir)).length, 1);
  assert.equal((await readdir(dir)).length, 3);
});

test('listSources and sectionIds on a missing dir', async (t) => {
  const { dir } = await setup(t);
  assert.deepEqual(await listSources(join(dir, 'none')), []);
  assert.equal((await sectionIds(join(dir, 'none'))).size, 0);
});
