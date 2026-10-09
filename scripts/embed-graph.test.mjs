import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readEmbedGraph } from './embed-graph.mjs';

it('counts every static dependency once, preserves lazy modules, and rejects unresolved/escaping paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'badge-graph-'));
    try {
        await mkdir(join(root, 'dist/embed'), { recursive: true });
        const file = join(root, 'dist/embed/module-graph.json');
        const graph = {
            'embed/carbon-badge.js': { imports: ['embed/chunks/shared.js'], dynamicImports: ['embed/chunks/remote.js'] },
            'embed/chunks/shared.js': { imports: ['embed/carbon-badge.js'], dynamicImports: [] },
            'embed/chunks/remote.js': { imports: ['embed/chunks/shared.js'], dynamicImports: [] },
        };
        await writeFile(file, JSON.stringify(graph));
        expect(await readEmbedGraph(root)).toMatchObject({
            initial: ['dist/embed/carbon-badge.js', 'dist/embed/chunks/shared.js'], optional: ['dist/embed/chunks/remote.js'],
        });
        graph['embed/carbon-badge.js'].imports.push('embed/chunks/missing.js');
        await writeFile(file, JSON.stringify(graph));
        await expect(readEmbedGraph(root)).rejects.toThrow('Unresolved');
        graph['embed/carbon-badge.js'].imports.pop();
        graph['embed/../secret.js'] = { imports: [], dynamicImports: [] };
        await writeFile(file, JSON.stringify(graph));
        await expect(readEmbedGraph(root)).rejects.toThrow('Invalid embed module path');
    } finally { await rm(root, { recursive: true, force: true }); }
});
