import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

const isProd = process.env.NODE_ENV === 'production';

export default {
    input: 'src/index.ts',
    output: [
        {
            file: 'dist/cometweb-carbon-badge.esm.js',
            format: 'es',
            sourcemap: !isProd,
        },
        {
            file: 'dist/cometweb-carbon-badge.umd.js',
            format: 'umd',
            name: 'CometWebCarbonBadge',
            sourcemap: !isProd,
        },
    ],
    plugins: [
        typescript({
            tsconfig: './tsconfig.json',
            declaration: true,
            declarationDir: 'dist',
            sourceMap: !isProd,
        }),
        terser({
            compress: {
                // Strip console.log in production but keep console.warn/error for diagnostics
                drop_console: isProd ? ['log'] : [],
                passes: 3,
                toplevel: true,
            },
            mangle: {
                toplevel: true,
            },
            module: true,
        }),
    ],
};
