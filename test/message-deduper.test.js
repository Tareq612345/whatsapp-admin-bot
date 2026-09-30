const assert = require('node:assert/strict');
const test = require('node:test');
const { MessageDeduper } = require('../lib/message-deduper');

test('deduplicates every supported WhatsApp message ID shape', () => {
  for (const id of [{ _serialized: 'abc' }, { $1: 'abc' }, { id: 'abc' }]) {
    const deduper = new MessageDeduper();
    assert.equal(deduper.isDuplicate({ id, from: 'user@c.us', body: '!ping' }), false);
    assert.equal(deduper.isDuplicate({ id, from: 'user@c.us', body: '!ping' }), true);
  }
});

test('deduplicates repeated command events without a usable ID', () => {
  let now = 9_000;
  const deduper = new MessageDeduper({ now: () => now });
  const message = { from: 'user@c.us', author: '', body: '!ping', timestamp: 9 };
  assert.equal(deduper.isDuplicate(message), false);
  assert.equal(deduper.isDuplicate({ ...message }), true);
  now += 20_000;
  assert.equal(deduper.isDuplicate({ ...message, timestamp: 29 }), false);
});

test('does not merge different senders or different commands', () => {
  const deduper = new MessageDeduper();
  assert.equal(deduper.isDuplicate({ from: 'one@c.us', body: '!ping' }), false);
  assert.equal(deduper.isDuplicate({ from: 'two@c.us', body: '!ping' }), false);
  assert.equal(deduper.isDuplicate({ from: 'one@c.us', body: '!status' }), false);
});