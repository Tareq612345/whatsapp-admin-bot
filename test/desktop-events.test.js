const test = require('node:test');
const assert = require('node:assert/strict');
const { createLineDecoder } = require('../lib/desktop-events');

test('desktop event decoder waits for a complete line', () => {
  const lines = [];
  const decoder = createLineDecoder(line => lines.push(line));

  decoder.push('[desktop-event] {"type":"q');
  assert.deepEqual(lines, []);

  decoder.push('r","value":"abc"}\nnext');
  assert.deepEqual(lines, ['[desktop-event] {"type":"qr","value":"abc"}']);

  decoder.flush();
  assert.deepEqual(lines, ['[desktop-event] {"type":"qr","value":"abc"}', 'next']);
});

test('desktop event decoder handles multiple Windows lines', () => {
  const lines = [];
  const decoder = createLineDecoder(line => lines.push(line));

  decoder.push('one\r\ntwo\r\n');

  assert.deepEqual(lines, ['one', 'two']);
});