// agy tutor adapter. agy has no system-prompt flag, so on the first turn the
// system prompt is prepended to the message. -p must stay last with its value after it.
// agy 1.4.7's model sometimes runs `pwd && ls -la` first; print mode soft-denies it and the
// turn ends with no output. NO_TOOLS makes that rarer; RETRY recovers the turn when it happens.
const NO_TOOLS = 'You have no tools. Your working directory is an empty scratch folder with nothing to inspect: '
  + 'do not run commands, list files or search. Everything you need is in this message. '
  + 'Reply only with the JSON object the schema asks for.\n\n';
export const RETRY = 'SERVER: that command was refused. You have no tools in this conversation; '
  + 'everything you need is in the first message. Reply now with the JSON object only.';

export function buildCall({ systemPrompt, schemaText, message, sessionId, model, effort }) {
  const args = ['--output-format', 'json', '--json-schema', schemaText];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (sessionId) args.push('--conversation', sessionId);
  const msg = sessionId ? message : 'SYSTEM INSTRUCTIONS:\n' + NO_TOOLS + systemPrompt + '\n\n' + message;
  args.push('-p', msg);
  return { bin: process.env.AGY_BIN || 'agy', args };
}

// retry: a message to resume the same conversation with, when a refused tool call ate the turn.
export function parseOutput(stdout) {
  let out;
  try {
    out = JSON.parse(stdout);
  } catch {
    return { turn: null, sessionId: null, error: 'agy returned no JSON' };
  }
  const sessionId = out.conversation_id || null;
  if (!out.structured_output) {
    const denied = Array.isArray(out.denied_actions) && out.denied_actions.length > 0;
    return {
      turn: null,
      sessionId,
      error: 'agy returned no structured_output (a tool call was probably refused)',
      ...(denied && sessionId ? { retry: RETRY } : {}),
    };
  }
  return { turn: out.structured_output, sessionId, error: null };
}
