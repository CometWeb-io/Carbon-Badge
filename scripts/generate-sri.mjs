#!/usr/bin/env node
/**
 * Emit hashes and a release manifest for every JavaScript artefact.
 * Same bytes should ship to npm, GitHub release, and CDN.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readEmbedGraph } from './embed-graph.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const model = JSON.parse(await readFile(join(root, 'docs/model-factors.json'), 'utf8'));

function digest(bytes) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const sri =
        'sha384-' + createHash('sha384').update(bytes).digest('base64');
    return { sha256, sri, bytes: bytes.byteLength };
}

async function artefact(relPath) {
    const bytes = await readFile(join(root, relPath));
    return { path: relPath, ...digest(bytes), gzipBytes: gzipSync(bytes, { level: 9 }).length };
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const gitSha = git('rev-parse', 'HEAD').trim();
const sourceDirty = Boolean(git('status', '--porcelain').trim());
if (process.env.GITHUB_ACTIONS === 'true' && (sourceDirty || process.env.GITHUB_SHA !== gitSha)) {
    throw Error('Release provenance requires a clean checkout at GITHUB_SHA');
}
const files = [...new Set(git('ls-files', '-c', '-o', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort();
const sourceFiles = await Promise.all(files.map(async path => {
    try { return { path, sha256: digest(await readFile(join(root, path))).sha256 }; }
    catch (error) { if (error.code === 'ENOENT') return { path, sha256: null }; throw error; }
}));

const esm = await artefact('dist/cometweb-carbon-badge.esm.js');
const umd = await artefact('dist/cometweb-carbon-badge.umd.js');

async function collectJavaScript(dir) {
    const result = [];
    for (const file of await readdir(join(root, dir), { withFileTypes: true })) {
        const path = `${dir}/${file.name}`;
        if (file.isDirectory()) result.push(...await collectJavaScript(path));
        else if (file.isFile() && /\.(?:js|cjs)$/.test(file.name)) result.push(path);
    }
    return result;
}
const embed = await readEmbedGraph(root);
const artifacts = await Promise.all((await collectJavaScript('dist')).sort().map(artefact));
for (const path of [...embed.initial, ...embed.optional]) {
    if (!artifacts.some(file => file.path === path)) throw Error(`Missing embed artifact: ${path}`);
}
const api = { esm: await artefact('dist/carbon-badge-api.esm.js'), cjs: await artefact('dist/carbon-badge-api.cjs') };

const manifest = {
    name: pkg.name,
    version: pkg.version,
    gitSha,
    formulaId: model.formulaId,
    factorSetId: model.id,
    scoreModelId: model.scoreModelId,
    sourceDirty,
    sourceSha256: digest(Buffer.from(JSON.stringify(sourceFiles))).sha256,
    lockSha256: digest(await readFile(join(root, 'package-lock.json'))).sha256,
    nodeVersion: process.version,
    buildMode: process.env.NODE_ENV || 'development',
    generatedAt: new Date().toISOString(),
    esm,
    umd,
    api,
    embed,
    artifacts,
};

const outDir = join(root, 'dist');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, 'release-manifest.json');
await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`release-manifest → ${outPath}`);
console.log(`ESM SRI: ${esm.sri}`);
console.log(`UMD SRI: ${umd.sri}`);
