#!/usr/bin/env node
/**
 * Emit Subresource Integrity hashes + a release manifest for the built ESM/UMD
 * artefacts. Same bytes should ship to npm, GitHub release, and CDN.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

function digest(bytes) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const sri =
        'sha384-' + createHash('sha384').update(bytes).digest('base64');
    return { sha256, sri, bytes: bytes.byteLength };
}

async function artefact(relPath) {
    const bytes = await readFile(join(root, relPath));
    return { path: relPath, ...digest(bytes) };
}

let gitSha = process.env.GITHUB_SHA || '';
if (!gitSha) {
    try {
        gitSha = execSync('git rev-parse HEAD', {
            cwd: root,
            encoding: 'utf8',
        }).trim();
    } catch {
        gitSha = 'unknown';
    }
}

const esm = await artefact('dist/cometweb-carbon-badge.esm.js');
const umd = await artefact('dist/cometweb-carbon-badge.umd.js');

const manifest = {
    name: pkg.name,
    version: pkg.version,
    gitSha,
    generatedAt: new Date().toISOString(),
    esm,
    umd,
};

const outDir = join(root, 'dist');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, 'release-manifest.json');
await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`release-manifest → ${outPath}`);
console.log(`ESM SRI: ${esm.sri}`);
console.log(`UMD SRI: ${umd.sri}`);
