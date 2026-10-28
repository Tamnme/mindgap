// Pure text helpers shared by the lesson and chapter pages.

// "" for the first few seconds (no flicker on fast turns), then "12s", "1m 05s".
export function elapsedText(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 3) return '';
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Plain words first; the HTTP code rides along in a trailing parenthesis only.
export function withCode(message, status) {
  const m = String(message || '').trim().replace(/[.:]+$/, '');
  return status ? `${m} (HTTP ${status})` : m;
}

// Message for a failed tutor turn: err = {status?, message}. Server text, when present, follows the plain words.
export function turnErrorText(err) {
  const detail = err.message && !/^HTTP \d+$/.test(err.message) ? `: ${err.message}` : '';
  if (err.status === 499) return 'Cancelled. Your message is kept — Retry when ready.';
  if (err.status === 409) return withCode('The lesson is busy with another turn. Retry', 409);
  if (err.status === 502) return withCode('The tutor did not answer. Retry', 502);
  if (err.status) return withCode(`The request failed${detail}. Retry`, err.status);
  return `Could not reach the server${detail}. Retry`;
}
