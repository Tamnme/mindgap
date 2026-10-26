// Course loader: finds courses in the shipped courses dir and the learner's data dir.
import { readdir, readFile, stat, mkdir, copyFile, constants } from 'node:fs/promises';
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
  const file = path.join(dir, 'course.json');
  const text = await readFile(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`malformed ${file}: ${err.message}`);
  }
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

// A slug is owned by the first dir that has a directory of that name, even if its course.json is broken.
async function ownerDir(opts, slug) {
  for (const base of courseDirs(opts)) {
    const dir = path.join(base, slug);
    if (await isDir(dir)) return dir;
  }
  return null;
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
      seen.add(slug);
      let course;
      try {
        course = await readCourseJson(path.join(base, slug));
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`mindgap: skipping course ${slug}: ${err.message}`);
        continue;
      }
      out.push({ slug, title: course.title });
    }
  }
  return out;
}

export async function loadCourse(opts, slug) {
  if (!validSlug(slug)) throw new CourseNotFound(slug);
  const dir = await ownerDir(opts, slug);
  if (!dir) throw new CourseNotFound(slug);
  let course;
  try {
    course = await readCourseJson(dir);
  } catch (err) {
    if (err.code === 'ENOENT') throw new CourseNotFound(slug);
    throw err;
  }
  return {
    slug,
    title: course.title,
    layers: course.layers ?? [],
    lab: course.lab ?? null,
    dir,
    stateDir: path.join(opts.dataDir, 'courses', slug, 'state'),
  };
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
