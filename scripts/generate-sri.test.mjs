import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('binds a manifest to source bytes and rejects dirty CI releases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'badge-provenance-'));
    try {
        await mkdir(join(root, 'scripts'));
        await mkdir(join(root, 'dist'));
        await mkdir(join(root, 'docs'));
        await copyFile(resolve('docs/model-factors.json'), join(root, 'docs/model-factors.json'));
        await copyFile(resolve('scripts/generate-sri.mjs'), join(root, 'scripts/generate-sri.mjs'));
        await copyFile(resolve('scripts/embed-graph.mjs'), join(root, 'scripts/embed-graph.mjs'));
        await writeFile(join(root, '.gitignore'), 'dist/\n');
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0' }));
        await writeFile(join(root, 'package-lock.json'), '{}');
        for (const format of ['esm', 'umd']) await writeFile(join(root, `dist/cometweb-carbon-badge.${format}.js`), 'fixture');
        await mkdir(join(root, 'dist/embed/chunks'), { recursive: true });
        for (const path of ['carbon-badge-api.esm.js', 'carbon-badge-api.cjs', 'embed/carbon-badge.js', 'embed/chunks/remote-test.js']) await writeFile(join(root, 'dist', path), 'fixture');
        await writeFile(join(root, 'dist/embed/module-graph.json'), JSON.stringify({
            'embed/carbon-badge.js': { imports: [], dynamicImports: ['embed/chunks/remote-test.js'] },
            'embed/chunks/remote-test.js': { imports: ['embed/carbon-badge.js'], dynamicImports: [] },
        }));
        const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
        git('init'); git('add', '.');
        git('-c', 'user.name=MaciejZet', '-c', 'user.email=maciekzmitruk@protonmail.com', 'commit', '-m', 'Local provenance fixture');
        const run = (env = {}) => execFileSync(process.execPath, ['scripts/generate-sri.mjs'], {
            cwd: root, stdio: 'pipe', env: { ...process.env, GITHUB_ACTIONS: '', ...env },
        });
        run();
        const manifest = async () => JSON.parse(await readFile(join(root, 'dist/release-manifest.json')));
        const before = await manifest();
        expect(before.sourceDirty).toBe(false);
        expect(before.artifacts).toHaveLength(6);
        expect(before.embed.initial).toEqual(['dist/embed/carbon-badge.js']);
        expect(before.embed.optional).toEqual(['dist/embed/chunks/remote-test.js']);
        await rm(join(root, 'dist/embed/chunks/remote-test.js'));
        expect(() => run()).toThrow();
        await writeFile(join(root, 'dist/embed/chunks/remote-test.js'), 'fixture');
        expect(before.gitSha).toBe(git('rev-parse', 'HEAD'));
        run(); expect((await manifest()).sourceSha256).toBe(before.sourceSha256);
        await writeFile(join(root, 'source.ts'), 'changed source');
        run();
        expect((await manifest()).sourceDirty).toBe(true);
        expect((await manifest()).sourceSha256).not.toBe(before.sourceSha256);
        expect(() => run({ GITHUB_ACTIONS: 'true', GITHUB_SHA: before.gitSha })).toThrow();
        await rm(join(root, 'source.ts'));
        expect(() => run({ GITHUB_ACTIONS: 'true', GITHUB_SHA: 'wrong' })).toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);
