// agy tutor adapter. agy has no system-prompt flag, so on the first turn the
// system prompt is prepended to the message. -p must stay last with its value after it.
export function buildCall({ systemPrompt, schemaText, message, sessionId, model }) {
  const args = ['--output-format', 'json', '--json-schema', schemaText];
  if (model) args.push('--model', model);
  if (sessionId) args.push('--conversation', sessionId);
  const msg = sessionId ? message : 'SYSTEM INSTRUCTIONS:\n' + systemPrompt + '\n\n' + message;
  args.push('-p', msg);
  return { bin: process.env.AGY_BIN || 'agy', args };
}

export function parseOutput(stdout) {
  let out;
  try {
    out = JSON.parse(stdout);
  } catch {
    return { turn: null, sessionId: null, error: 'agy returned no JSON' };
  }
  const sessionId = out.conversation_id || null;
  if (!out.structured_output) {
    return {
      turn: null,
      sessionId,
      error: 'agy returned no structured_output (a tool call was probably refused)',
    };
  }
  return { turn: out.structured_output, sessionId, error: null };
}
