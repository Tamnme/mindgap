// Claude Code tutor adapter. Tools are disabled with --tools "" (no tutor tool use).
export function buildCall({ systemPrompt, schemaText, message, sessionId, model }) {
  const args = [
    '-p', '--safe-mode', '--tools', '', '--model', model,
    '--output-format', 'json', '--json-schema', schemaText,
    '--system-prompt', systemPrompt,
  ];
  if (sessionId) args.push('--resume', sessionId);
  args.push(message);
  return { bin: process.env.CLAUDE_BIN || 'claude', args };
}

export function parseOutput(stdout) {
  let out;
  try {
    out = JSON.parse(stdout);
  } catch {
    return { turn: null, sessionId: null, error: 'tutor returned no JSON' };
  }
  const sessionId = out.session_id || null;
  if (out.is_error || !out.structured_output) {
    return { turn: null, sessionId, error: String(out.result ?? 'tutor returned no structured_output') };
  }
  return { turn: out.structured_output, sessionId, error: null };
}
