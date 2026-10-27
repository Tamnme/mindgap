// Self-check for lib/courses.mjs. Uses temp coursesDir and dataDir roots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listCourses, loadCourse, ensureState, CourseNotFound } from '../lib/courses.mjs';

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
