// Tutor registry: MINDGAP_TUTOR selects one adapter by name.
import * as claude from './claude.mjs';
import * as agy from './agy.mjs';

const ADAPTERS = { claude, agy };

export const TUTORS = Object.keys(ADAPTERS);

export function getTutor(name) {
  if (!Object.hasOwn(ADAPTERS, name)) throw new Error(`unknown tutor: ${name}`);
  return ADAPTERS[name];
}
