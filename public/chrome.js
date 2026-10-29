// Shared page chrome: the theme control, the course top bar on lesson and chapter pages, and the status mark.
// Each page's <head> applies the stored theme before paint; this module wires the control.

const THEME_KEY = 'mindgap-theme';
const STATUSES = ['untested', 'gap', 'shaky', 'solid'];

export const statusOf = (s) => (STATUSES.includes(s) ? s : 'untested');

// The one status mark (DESIGN.md "The One Mark Rule"), drawn by CSS.
export function statusMark(status, size = '') {
  const m = document.createElement('span');
  m.className = `mark ${statusOf(status)} ${size}`.trim();
  m.setAttribute('aria-hidden', 'true');
  return m;
}

function applyTheme(value) {
  if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}

const select = document.getElementById('theme');
if (select) {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch { /* storage blocked: follow the system */ }
  select.value = stored === 'light' || stored === 'dark' ? stored : 'system';
  select.addEventListener('change', () => {
    applyTheme(select.value);
    try {
      if (select.value === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, select.value);
    } catch { /* not remembered; still applied for this page */ }
  });
}

// Lesson and chapter pages: point the course title and tabs at this course.
export function fillCourseBar(slug, title) {
  const q = `course.html?course=${encodeURIComponent(slug || '')}`;
  const name = document.getElementById('course-title');
  if (name) {
    name.href = `${q}#home`;
    if (title) name.textContent = title;
  }
  for (const a of document.querySelectorAll('.tabs a[data-view]')) a.href = `${q}#${a.dataset.view}`;
}
