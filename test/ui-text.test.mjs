import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedText, withCode, turnErrorText } from '../public/ui-text.js';

test('elapsedText hides the first seconds, then counts', () => {
  assert.equal(elapsedText(0), '');
  assert.equal(elapsedText(2999), '');
  assert.equal(elapsedText(3000), '3s');
  assert.equal(elapsedText(59999), '59s');
  assert.equal(elapsedText(65000), '1m 05s');
  assert.equal(elapsedText(600000), '10m 00s');
});

test('withCode leads with words and trails the code', () => {
  assert.equal(withCode('Could not load chapter:', 500), 'Could not load chapter (HTTP 500)');
  assert.equal(withCode('Nope', 0), 'Nope');
});

test('turnErrorText', () => {
  assert.equal(turnErrorText({ status: 499, message: 'cancelled' }), 'Cancelled. Your message is kept — Retry when ready.');
  assert.equal(turnErrorText({ status: 409, message: 'x' }), 'The lesson is busy with another turn. Retry (HTTP 409)');
  assert.equal(turnErrorText({ status: 502, message: 'x' }), 'The tutor did not answer. Retry (HTTP 502)');
  assert.equal(turnErrorText({ status: 500, message: 'boom' }), 'The request failed: boom. Retry (HTTP 500)');
  assert.equal(turnErrorText({ status: 500, message: 'HTTP 500' }), 'The request failed. Retry (HTTP 500)');
  assert.equal(turnErrorText({ message: 'fetch failed' }), 'Could not reach the server: fetch failed. Retry');
});
