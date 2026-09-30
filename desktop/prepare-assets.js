const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const encoded = path.join(__dirname, 'assets', 'app-icon.ico.b64');
const outputDir = path.join(root, 'build');
const output = path.join(outputDir, 'icon.ico');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(output, Buffer.from(fs.readFileSync(encoded, 'utf8').replace(/\s+/g, ''), 'base64'));
console.log(`Prepared ${output}`);