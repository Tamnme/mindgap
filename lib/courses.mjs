// Course loader: finds courses in the shipped courses dir and the learner's data dir.
import { readdir, readFile, mkdir, copyFile, constants } from 'node:fs/promises';
import path from 'node:path';

export class CourseNotFound extends Error {
  constructor(slug) {
    super(`course not found: ${slug}`);
    this.name = 'CourseNotFound';
  }
}

export function validSlug(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
}

export function courseDirs({ coursesDir, dataDir }) {
  return [coursesDir, path.join(dataDir, 'courses')];
}

async function readCourseJson(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, 'course.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function subdirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && validSlug(e.name)).map((e) => e.name).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function listCourses(opts) {
  const seen = new Set();
  const out = [];
  for (const base of courseDirs(opts)) {
    for (const slug of await subdirs(base)) {
      if (seen.has(slug)) continue;
      const course = await readCourseJson(path.join(base, slug));
      if (!course) continue;
      seen.add(slug);
      out.push({ slug, title: course.title });
    }
  }
  return out;
}

export async function loadCourse(opts, slug) {
  if (!validSlug(slug)) throw new CourseNotFound(slug);
  for (const base of courseDirs(opts)) {
    const dir = path.join(base, slug);
    const course = await readCourseJson(dir);
    if (!course) continue;
    return {
      slug,
      title: course.title,
      layers: course.layers ?? [],
      lab: course.lab ?? null,
      dir,
      stateDir: path.join(opts.dataDir, 'courses', slug, 'state'),
    };
  }
  throw new CourseNotFound(slug);
}

export async function ensureState(course) {
  await mkdir(path.join(course.stateDir, 'sessions'), { recursive: true });
  try {
    await copyFile(
      path.join(course.dir, 'map.seed.json'),
      path.join(course.stateDir, 'map.json'),
      constants.COPYFILE_EXCL,
    );
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}
