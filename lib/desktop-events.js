function createLineDecoder(onLine) {
  let buffer = '';

  return {
    push(chunk) {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) onLine(line);
    },
    flush() {
      if (!buffer) return;
      onLine(buffer);
      buffer = '';
    }
  };
}

module.exports = { createLineDecoder };