#!/usr/bin/env node
/**
 * Ensure a release tag matches package.json version (vX.Y.Z ↔ X.Y.Z).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const tag = process.env.GITHUB_REF_NAME || process.env.TAG || '';

if (!tag) {
    console.log('verify-release: no tag in env (local ok)');
    process.exit(0);
}

if (tag !== `v${pkg.version}`) {
    console.error(
        `Release tag ${tag} does not match package version ${pkg.version}`,
    );
    process.exit(1);
}

console.log(`verify-release: ${tag} matches package ${pkg.version}`);
