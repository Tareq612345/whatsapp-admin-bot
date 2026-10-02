const fs = require('fs');
const path = require('path');

function sanitizeLogText(value) {
  return String(value || '')
    .replace(/(!claim\s+)\d{6}\b/gi, '$1[REDACTED]')
    .replace(/("code"\s*:\s*")\d{6}(")/gi, '$1[REDACTED]$2')
    .replace(/body="(?:[^"\\]|\\.)*"/g, 'body="[REDACTED]"');
}

class FileLogger {
  constructor(file, { maxBytes = 5 * 1024 * 1024 } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  rotateIfNeeded() {
    try {
      if (fs.statSync(this.file).size < this.maxBytes) return;
      const previous = `${this.file}.1`;
      fs.rmSync(previous, { force: true });
      fs.renameSync(this.file, previous);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  write(source, text, at = new Date().toISOString()) {
    const sanitized = sanitizeLogText(text);
    const lines = sanitized.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return;
    this.rotateIfNeeded();
    const output = lines
      .map(line => `${at} [${String(source || 'app').toUpperCase()}] ${line}`)
      .join('\n');
    fs.appendFileSync(this.file, `${output}\n`, 'utf8');
  }
}

module.exports = { FileLogger, sanitizeLogText };