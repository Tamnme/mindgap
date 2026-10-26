// Self-check for lib/tutors/*. Pure argv/parse tests; no real CLI is spawned.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as claude from '../lib/tutors/claude.mjs';
import * as agy from '../lib/tutors/agy.mjs';
import { getTutor, TUTORS } from '../lib/tutors/index.mjs';

const SCHEMA = '{"type":"object"}';
const SYS = 'You are a tutor.';
const MSG = 'hello';

const saved = {};
before(() => {
  for (const k of ['CLAUDE_BIN', 'AGY_BIN']) { saved[k] = process.env[k]; delete process.env[k]; }
});
after(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

test('claude first turn: exact argv order', () => {
  const { bin, args } = claude.buildCall({
    systemPrompt: SYS, schemaText: SCHEMA, message: MSG, sessionId: null, model: 'opus',
  });
  assert.equal(bin, 'claude');
  assert.deepEqual(args, [
    '-p', '--safe-mode', '--tools', '', '--model', 'opus',
    '--output-format', 'json', '--json-schema', SCHEMA,
    '--system-prompt', SYS, MSG,
  ]);
});

test('claude resume: --resume goes before the message', () => {
  const { args } = claude.buildCall({
    systemPrompt: SYS, schemaText: SCHEMA, message: MSG, sessionId: 's1', model: 'opus',
  });
  assert.deepEqual(args, [
    '-p', '--safe-mode', '--tools', '', '--model', 'opus',
    '--output-format', 'json', '--json-schema', SCHEMA,
    '--system-prompt', SYS, '--resume', 's1', MSG,
  ]);
});

test('claude bin comes from CLAUDE_BIN at call time', () => {
  process.env.CLAUDE_BIN = '/fake/claude';
  try {
    assert.equal(claude.buildCall({ systemPrompt: SYS, schemaText: SCHEMA, message: MSG, model: 'opus' }).bin, '/fake/claude');
  } finally { delete process.env.CLAUDE_BIN; }
});

test('claude parseOutput: success', () => {
  const stdout = JSON.stringify({ structured_output: { say: 'hi' }, session_id: 'abc', is_error: false });
  assert.deepEqual(claude.parseOutput(stdout), { turn: { say: 'hi' }, sessionId: 'abc', error: null });
});

test('claude parseOutput: is_error uses .result as the error', () => {
  const stdout = JSON.stringify({ is_error: true, result: 'boom', session_id: 'abc' });
  const r = claude.parseOutput(stdout);
  assert.equal(r.turn, null);
  assert.equal(r.error, 'boom');
});

test('claude parseOutput: missing structured_output gets the default error', () => {
  const r = claude.parseOutput(JSON.stringify({ session_id: 'abc' }));
  assert.equal(r.turn, null);
  assert.equal(r.error, 'tutor returned no structured_output');
});

test('claude parseOutput: non-JSON stdout', () => {
  const r = claude.parseOutput('not json at all');
  assert.equal(r.turn, null);
  assert.equal(r.sessionId, null);
  assert.equal(typeof r.error, 'string');
  assert.ok(r.error.length > 0);
});

test('agy first turn: system prompt folded into -p, which is last', () => {
  const { bin, args } = agy.buildCall({
    systemPrompt: SYS, schemaText: SCHEMA, message: MSG, sessionId: null, model: 'pro',
  });
  assert.equal(bin, 'agy');
  assert.deepEqual(args.slice(0, -2), [
    '--output-format', 'json', '--json-schema', SCHEMA, '--model', 'pro',
  ]);
  assert.equal(args.at(-2), '-p');
  assert.equal(args.at(-1), 'SYSTEM INSTRUCTIONS:\n' + SYS + '\n\n' + MSG);
});

test('agy resume: --conversation present, no system prompt in message', () => {
  const { args } = agy.buildCall({
    systemPrompt: SYS, schemaText: SCHEMA, message: MSG, sessionId: 'c1', model: 'pro',
  });
  assert.deepEqual(args, [
    '--output-format', 'json', '--json-schema', SCHEMA, '--model', 'pro',
    '--conversation', 'c1', '-p', MSG,
  ]);
  assert.ok(!args.at(-1).includes('SYSTEM INSTRUCTIONS'));
});

test('agy omits --model when model is falsy', () => {
  const { args } = agy.buildCall({ systemPrompt: SYS, schemaText: SCHEMA, message: MSG, sessionId: null, model: undefined });
  assert.ok(!args.includes('--model'));
  assert.equal(args.at(-2), '-p');
});

test('agy bin comes from AGY_BIN at call time', () => {
  process.env.AGY_BIN = '/fake/agy';
  try {
    assert.equal(agy.buildCall({ systemPrompt: SYS, schemaText: SCHEMA, message: MSG, model: 'pro' }).bin, '/fake/agy');
  } finally { delete process.env.AGY_BIN; }
});

test('agy parseOutput: success sample', () => {
  const stdout = '{"conversation_id":"c1","status":"SUCCESS","structured_output":{"say":"hi"}}';
  assert.deepEqual(agy.parseOutput(stdout), { turn: { say: 'hi' }, sessionId: 'c1', error: null });
});

test('agy parseOutput: no structured_output (refused tool call)', () => {
  const r = agy.parseOutput('{"conversation_id":"c1","status":"SUCCESS"}');
  assert.equal(r.turn, null);
  assert.equal(r.sessionId, 'c1');
  assert.equal(r.error, 'agy returned no structured_output (a tool call was probably refused)');
});

test('agy parseOutput: non-JSON stdout', () => {
  const r = agy.parseOutput('garbage');
  assert.equal(r.turn, null);
  assert.equal(r.sessionId, null);
  assert.equal(typeof r.error, 'string');
});

test('getTutor returns adapters and throws on unknown names', () => {
  assert.deepEqual(TUTORS, ['claude', 'agy']);
  assert.equal(getTutor('claude').buildCall, claude.buildCall);
  assert.equal(getTutor('agy').parseOutput, agy.parseOutput);
  assert.throws(() => getTutor('nope'), { message: 'unknown tutor: nope' });
  assert.throws(() => getTutor('constructor'), { message: 'unknown tutor: constructor' });
});
