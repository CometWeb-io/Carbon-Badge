import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { readEmbedGraph } from './embed-graph.mjs';

const embed = await readEmbedGraph(process.cwd());
const checks = [
    ['SDK ESM', ['dist/cometweb-carbon-badge.esm.js'], 14_000],
    ['SDK UMD', ['dist/cometweb-carbon-badge.umd.js'], 14_000],
    ['API ESM', ['dist/carbon-badge-api.esm.js'], 3_500],
    ['API CJS', ['dist/carbon-badge-api.cjs'], 3_500],
    ['Embed initial (all static imports)', embed.initial, 10_500],
    ['Embed with network (all chunks)', [...embed.initial, ...embed.optional], 15_000],
];
for (const [label, paths, limit] of checks) {
    let bytes = 0;
    for (const path of paths) bytes += gzipSync(await readFile(path), { level: 9 }).length;
    console.log(`${label}: ${bytes} B gzip (budget ${limit} B)`);
    if (bytes > limit) { console.error(`${label} exceeds its gzip budget`); process.exitCode = 1; }
}
