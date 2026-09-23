import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const MAX_GZIP_BYTES = 10_500;
const files = [
  'dist/cometweb-carbon-badge.esm.js',
  'dist/cometweb-carbon-badge.umd.js',
];

let failed = false;
for (const file of files) {
  const source = await readFile(file);
  const gzipBytes = gzipSync(source, { level: 9 }).byteLength;
  console.log(`${file}: ${gzipBytes} B gzip`);
  if (gzipBytes > MAX_GZIP_BYTES) {
    console.error(`${file} exceeds the ${MAX_GZIP_BYTES} B gzip budget`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
