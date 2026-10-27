// Course loader: finds courses in the shipped courses dir and the learner's data dir.
import { readdir, readFile, stat, mkdir, copyFile, writeFile, rename, constants } from 'node:fs/promises';
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
    generated: path.dirname(dir) === path.join(opts.dataDir, 'courses'),
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

export class InvalidCourse extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidCourse';
  }
}

export const slugFromTitle = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 48).replace(/-+$/, '') || 'course';

// Creates an empty generated course under <data>/courses/<slug>. The slug is reserved with a non-recursive mkdir,
// so a concurrent create of the same title takes the next suffix instead of overwriting.
export async function createCourse(opts, { title, background } = {}) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 80) throw new InvalidCourse('title must be 1-80 characters');
  title = title.trim();
  if (background != null && (typeof background !== 'string' || background.length > 2000)) throw new InvalidCourse('background must be text of at most 2000 characters');
  background = background?.trim() || null;
  const root = path.join(opts.dataDir, 'courses');
  await mkdir(root, { recursive: true });
  const base = slugFromTitle(title);
  let slug;
  for (let n = 1; ; n++) {
    slug = n === 1 ? base : `${base}-${n}`;
    if (await isDir(path.join(opts.coursesDir, slug))) continue;
    try {
      await mkdir(path.join(root, slug));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  const dir = path.join(root, slug);
  const put = (rel, value) => writeFile(path.join(dir, rel), JSON.stringify(value, null, 2) + '\n');
  await mkdir(path.join(dir, 'chapters'));
  await put('map.seed.json', { nodes: [] });
  await put('chapters/index.json', []);
  if (background) {
    await mkdir(path.join(dir, 'state'));
    await put('state/goal.json', { goal: null, background });
  }
  // course.json last, via rename: a half-made course is invisible to listCourses until it is complete.
  await put('course.json.tmp', { slug, title, layers: [], lab: null });
  await rename(path.join(dir, 'course.json.tmp'), path.join(dir, 'course.json'));
  return { slug };
}
