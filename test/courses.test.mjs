// Self-check for lib/courses.mjs. Uses temp coursesDir and dataDir roots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { listCourses, loadCourse, ensureState, createCourse, CourseNotFound, InvalidCourse } from '../lib/courses.mjs';

const ALPHA = { slug: 'alpha', title: 'Alpha', layers: [{ id: 'L1', name: 'One' }], lab: null };
const SEED = { nodes: [] };

const roots = [];

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'mindgap-courses-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  return { coursesDir: path.join(root, 'courses'), dataDir: path.join(root, 'data') };
}

function course(slug, title) {
  return JSON.stringify({ slug, title, layers: [], lab: null });
}

let opts;

before(async () => {
  opts = await fixture({
    'courses/alpha/course.json': JSON.stringify(ALPHA),
    'courses/alpha/map.seed.json': JSON.stringify(SEED),
  });
});

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test('listCourses returns shipped courses with slug and title', async () => {
  assert.deepEqual(await listCourses(opts), [{ slug: 'alpha', title: 'Alpha' }]);
});

test('loadCourse sets stateDir under dataDir/courses/<slug>/state', async () => {
  const course = await loadCourse(opts, 'alpha');
  assert.ok(course.stateDir.endsWith(path.join('courses', 'alpha', 'state')));
  assert.equal(course.slug, 'alpha');
  assert.equal(course.title, 'Alpha');
});

test('loadCourse rejects invalid or unknown slugs with CourseNotFound', async () => {
  await assert.rejects(loadCourse(opts, '../alpha'), CourseNotFound);
  await assert.rejects(loadCourse(opts, 'Alpha'), CourseNotFound);
  await assert.rejects(loadCourse(opts, 'nope'), CourseNotFound);
  await assert.rejects(loadCourse(opts, undefined), CourseNotFound);
});

test('ensureState seeds map.json once and never overwrites it', async () => {
  const course = await loadCourse(opts, 'alpha');
  const mapPath = path.join(course.stateDir, 'map.json');

  await ensureState(course);
  assert.deepEqual(JSON.parse(await readFile(mapPath, 'utf8')), SEED);

  await writeFile(mapPath, JSON.stringify({ nodes: [1] }));
  await ensureState(course);
  assert.deepEqual(JSON.parse(await readFile(mapPath, 'utf8')), { nodes: [1] });
});

test('a shipped course wins over a same-slug course in dataDir', async () => {
  const local = await fixture({
    'courses/alpha/course.json': course('alpha', 'Alpha'),
    'data/courses/alpha/course.json': course('alpha', 'Alpha Local'),
  });
  assert.deepEqual(await listCourses(local), [{ slug: 'alpha', title: 'Alpha' }]);
  assert.equal((await loadCourse(local, 'alpha')).title, 'Alpha');
});

test('a dataDir-only course is listed after shipped ones and loads from dataDir', async () => {
  const local = await fixture({
    'courses/alpha/course.json': course('alpha', 'Alpha'),
    'data/courses/beta/course.json': course('beta', 'Beta'),
  });
  assert.deepEqual(await listCourses(local), [
    { slug: 'alpha', title: 'Alpha' },
    { slug: 'beta', title: 'Beta' },
  ]);
  const beta = await loadCourse(local, 'beta');
  assert.equal(beta.title, 'Beta');
  assert.equal(beta.dir, path.join(local.dataDir, 'courses', 'beta'));
});

test('a malformed shipped course still owns its slug over a dataDir course', async () => {
  const local = await fixture({
    'courses/alpha/course.json': course('alpha', 'Alpha'),
    'courses/gamma/course.json': '{"slug":',
    'data/courses/gamma/course.json': course('gamma', 'Gamma Local'),
  });
  await assert.rejects(loadCourse(local, 'gamma'), (err) => {
    assert.ok(!(err instanceof CourseNotFound));
    assert.ok(err.message.includes('course.json'));
    return true;
  });
  assert.deepEqual(await listCourses(local), [{ slug: 'alpha', title: 'Alpha' }]);
});

test('loadCourse.generated is true only for courses under <data>/courses', async () => {
  const o = await fixture({
    'courses/shipped/course.json': course('shipped', 'S'),
    'data/courses/made/course.json': course('made', 'M'),
  });
  assert.equal((await loadCourse(o, 'shipped')).generated, false);
  assert.equal((await loadCourse(o, 'made')).generated, true);
});

test('createCourse: slug rules, suffix on shipped and data collisions, files written', async () => {
  const opts = await fixture({ 'courses/networking/course.json': JSON.stringify({ title: 'N' }), 'data/courses/networking/sources/s.md': 'x', 'data/courses/taken/course.json': '{}' });
  const root = path.dirname(opts.coursesDir);
  assert.deepEqual(await createCourse(opts, { title: 'Networking' }), { slug: 'networking-2' });
  assert.deepEqual(await createCourse(opts, { title: 'Networking' }), { slug: 'networking-3' });
  assert.ok(!existsSync(path.join(root, 'data/courses/networking/course.json')));
  assert.deepEqual(await createCourse(opts, { title: 'Taken' }), { slug: 'taken-2' });
  assert.deepEqual(await createCourse(opts, { title: '  C++ & Rust: 101!  ', background: '  hi  ' }), { slug: 'c-rust-101' });
  assert.deepEqual(await createCourse(opts, { title: '***' }), { slug: 'course' });
  const long = await createCourse(opts, { title: 'a'.repeat(60) });
  assert.equal(long.slug, 'a'.repeat(48));
  const dir = path.join(opts.dataDir, 'courses', 'c-rust-101');
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'course.json'), 'utf8')), { slug: 'c-rust-101', title: 'C++ & Rust: 101!', layers: [], lab: null });
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'state/goal.json'), 'utf8')), { goal: null, background: 'hi' });
  const bare = path.join(opts.dataDir, 'courses', 'course');
  assert.ok(!existsSync(path.join(bare, 'state')));
  assert.deepEqual(JSON.parse(await readFile(path.join(bare, 'map.seed.json'), 'utf8')), { nodes: [] });
  const loaded = await loadCourse(opts, 'c-rust-101');
  assert.equal(loaded.generated, true);
  await ensureState(loaded);
});

test('createCourse: concurrent creates of one title never share a folder', async () => {
  const opts = await fixture({});
  const root = path.dirname(opts.coursesDir);
  const slugs = (await Promise.all([1, 2, 3, 4].map(() => createCourse(opts, { title: 'Same' })))).map((r) => r.slug).sort();
  assert.deepEqual(slugs, ['same', 'same-2', 'same-3', 'same-4']);
});

test('createCourse: bad title or background throws InvalidCourse and writes nothing', async () => {
  const opts = await fixture({});
  const root = path.dirname(opts.coursesDir);
  for (const a of [{}, { title: '' }, { title: '  ' }, { title: 'x'.repeat(81) }, { title: 3 }, { title: 'ok', background: 'y'.repeat(2001) }, { title: 'ok', background: {} }]) {
    await assert.rejects(createCourse(opts, a), InvalidCourse);
  }
  assert.ok(!existsSync(path.join(root, 'data')));
  const r = await createCourse(opts, { title: 'ok', background: '   ' });
  assert.ok(!existsSync(path.join(opts.dataDir, 'courses', r.slug, 'state')));
});
