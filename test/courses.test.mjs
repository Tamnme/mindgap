// Self-check for lib/courses.mjs. Uses a temp coursesDir and dataDir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listCourses, loadCourse, ensureState, CourseNotFound } from '../lib/courses.mjs';

const ALPHA = { slug: 'alpha', title: 'Alpha', layers: [{ id: 'L1', name: 'One' }], lab: null };
const SEED = { nodes: [] };

let root;
let opts;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mindgap-courses-'));
  const coursesDir = path.join(root, 'courses');
  const dataDir = path.join(root, 'data');
  await mkdir(path.join(coursesDir, 'alpha'), { recursive: true });
  await writeFile(path.join(coursesDir, 'alpha', 'course.json'), JSON.stringify(ALPHA));
  await writeFile(path.join(coursesDir, 'alpha', 'map.seed.json'), JSON.stringify(SEED));
  opts = { coursesDir, dataDir };
});

after(async () => {
  await rm(root, { recursive: true, force: true });
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
