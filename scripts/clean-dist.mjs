import { rm } from 'node:fs/promises';

const generatedFiles = [
  'dist/index.js',
  'dist/licenses.txt',
  'dist/index.js.map',
  'dist/index.js.map.txt',
  'dist/sourcemap-register.cjs',
  'dist/sourcemap-register.cjs.txt',
];

await Promise.all(generatedFiles.map((file) => rm(file, { force: true })));
