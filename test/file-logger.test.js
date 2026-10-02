const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileLogger, sanitizeLogText } = require('../lib/file-logger');

test('redacts owner claim codes and incoming message bodies', () => {
  const text = sanitizeLogText('send !claim 482917 body="private text" {"code":"482917"}');
  assert.equal(text.includes('482917'), false);
  assert.match(text, /!claim \[REDACTED\]/);
  assert.match(text, /body="\[REDACTED\]"/);
});

test('writes a persistent diagnostic log and rotates it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-log-'));
  const file = path.join(directory, 'admin-studio.log');
  const logger = new FileLogger(file, { maxBytes: 30 });

  logger.write('bot', 'first line', '2026-10-02T00:00:00.000Z');
  logger.write('bot', 'second line is long enough to rotate', '2026-10-02T00:00:01.000Z');

  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.existsSync(`${file}.1`), true);
  assert.match(fs.readFileSync(file, 'utf8'), /second line/);
});