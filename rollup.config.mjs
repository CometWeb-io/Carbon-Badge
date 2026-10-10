import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import ts from 'typescript';

const isProd = process.env.NODE_ENV === 'production';
const plugins = (watch) => [
    typescript({ tsconfig: './tsconfig.json', declaration: true, declarationDir: 'dist', sourceMap: !isProd,
        // Static compilation needs no filesystem watchers; leaked macOS handles prevent exit.
        typescript: watch ? ts : { ...ts, sys: { ...ts.sys,
            watchFile: () => ({ close() {} }), watchDirectory: () => ({ close() {} }),
        } },
    }),
    terser({
        compress: { drop_console: isProd ? ['log'] : [], passes: 3, toplevel: true },
        mangle: {
            toplevel: true,
            // Private component state/methods only; public cross-chunk fields stay intact.
            properties: { regex: /^_|^(?:scheduleLoad|abortInFlight|loadData|runEstimate|dispatchBadgeEvent|updateStyles|renderLoading|renderBadge|renderUnknown|bindRetry)$/ },
        },
        module: true,
    }),
];

export default (args) => [
    {
        input: 'src/index.ts',
        output: [
            { file: 'dist/cometweb-carbon-badge.esm.js', format: 'es', inlineDynamicImports: true, sourcemap: !isProd },
            { file: 'dist/cometweb-carbon-badge.umd.js', format: 'umd', name: 'CometWebCarbonBadge', inlineDynamicImports: true, sourcemap: !isProd },
        ],
        plugins: plugins(args.watch),
    },
    {
        input: 'src/api.ts',
        output: [
            { file: 'dist/carbon-badge-api.esm.js', format: 'es', sourcemap: !isProd },
            { file: 'dist/carbon-badge-api.cjs', format: 'cjs', sourcemap: !isProd },
        ],
        plugins: plugins(args.watch),
    },
    {
        input: 'src/embed.ts',
        preserveEntrySignatures: false,
        output: {
            dir: 'dist', format: 'es', entryFileNames: 'embed/carbon-badge.js',
            chunkFileNames: 'embed/chunks/[name]-[hash].js', sourcemap: !isProd,
            onlyExplicitManualChunks: true,
            manualChunks(id) {
                if (/\/(?:remote|api-client|api-response|cache)\.ts$/.test(id)) return 'remote';
            },
        },
        plugins: [...plugins(args.watch), {
            name: 'embed-module-graph',
            generateBundle(_options, bundle) {
                const graph = Object.fromEntries(Object.values(bundle).filter(file => file.type === 'chunk').map(file => [
                    file.fileName, { imports: file.imports, dynamicImports: file.dynamicImports },
                ]));
                this.emitFile({ type: 'asset', fileName: 'embed/module-graph.json', source: JSON.stringify(graph, null, 2) + '\n' });
            },
        }],
    },
];
