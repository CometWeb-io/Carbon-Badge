import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Validate the build graph before claiming an embed's complete download/integrity footprint. */
export async function readEmbedGraph(root) {
    const modules = JSON.parse(await readFile(join(root, 'dist/embed/module-graph.json'), 'utf8'));
    const entry = 'embed/carbon-badge.js';
    if (!modules || typeof modules !== 'object' || Array.isArray(modules) || !Object.hasOwn(modules, entry)) throw Error('Missing embed entry');
    for (const [path, module] of Object.entries(modules)) {
        if (!/^embed\/(?:[\w-]+\/)*[\w.-]+\.js$/.test(path) || path.split('/').includes('..')) throw Error('Invalid embed module path');
        for (const field of ['imports', 'dynamicImports']) {
            if (!Array.isArray(module?.[field]) || module[field].some(dep => typeof dep !== 'string' || !Object.hasOwn(modules, dep))) throw Error('Unresolved embed dependency');
        }
    }
    const initial = new Set();
    const pending = [entry];
    while (pending.length) {
        const path = pending.pop();
        if (initial.has(path)) continue;
        initial.add(path);
        pending.push(...modules[path].imports);
    }
    return {
        entry: 'dist/' + entry,
        initial: [...initial].sort().map(path => 'dist/' + path),
        optional: Object.keys(modules).filter(path => !initial.has(path)).sort().map(path => 'dist/' + path),
        modules,
    };
}
