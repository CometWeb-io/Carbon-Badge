import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tempDir = await mkdtemp(join(tmpdir(), 'carbon-badge-consumer-'));
const npmEnv = {
  ...process.env,
  NPM_CONFIG_CACHE: join(tempDir, 'npm-cache'),
};

try {
  execFileSync('npm', ['pack', '--pack-destination', tempDir], {
    cwd: packageRoot,
    env: npmEnv,
    stdio: 'inherit',
  });
  const tarball = join(tempDir, (await readdir(tempDir)).find((name) => name.endsWith('.tgz')));
  await writeFile(join(tempDir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], {
    cwd: tempDir,
    env: npmEnv,
    stdio: 'inherit',
  });
  const typeConsumer = join(tempDir, 'consumer.ts');
  await writeFile(typeConsumer, "import '@cometweb/carbon-badge/embed';\nimport {parseApiResponse, type NormalizeApiOptions, type BadgeData} from '@cometweb/carbon-badge/api';\nimport {CometWebCarbonBadge} from '@cometweb/carbon-badge';\nconst options: NormalizeApiOptions = {requestedUrl: 'https://example.com/'};\nconst result: BadgeData | null = parseApiResponse(null, options);\nconst badge = new CometWebCarbonBadge();\nconst grams: number | null = badge.co2Grams;\n");
  execFileSync(process.execPath, [join(packageRoot, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--module', 'ESNext', '--moduleResolution', 'bundler', '--target', 'ES2020', typeConsumer],
  { cwd: tempDir, stdio: 'inherit' });
  execFileSync(process.execPath, ['--input-type=module', '-e',
    "const pkg = await import('@cometweb/carbon-badge'); if (pkg.co2ToScore(0.23) !== 'B' || typeof pkg.registerCarbonBadge !== 'function') process.exit(1);"],
  { cwd: tempDir, stdio: 'inherit' });
  execFileSync(process.execPath, ['--input-type=module', '-e',
    "import {readFileSync} from 'node:fs'; import {createHash} from 'node:crypto'; import assert from 'node:assert/strict'; const base='node_modules/@cometweb/carbon-badge/'; const m=JSON.parse(readFileSync(base+'dist/release-manifest.json')); for (const f of m.artifacts) assert.equal(createHash('sha256').update(readFileSync(base+f.path)).digest('hex'), f.sha256); assert.match(m.sourceSha256,/^[a-f0-9]{64}$/); assert.equal(typeof m.sourceDirty,'boolean'); for(const path of [...m.embed.initial,...m.embed.optional]) assert.ok(m.artifacts.some(file=>file.path===path)); assert.ok(m.embed.optional.length>0); const pkg=await import('@cometweb/carbon-badge'); assert.equal(m.version,pkg.BADGE_VERSION); assert.equal(m.factorSetId,pkg.FACTOR_SET_ID_SWDM_V4); assert.equal(m.scoreModelId,pkg.SCORE_MODEL_ID_COMETWEB_BANDS_V1); const factors=JSON.parse(readFileSync(base+'docs/model-factors.json')); assert.equal(factors.id,pkg.FACTOR_SET_ID_SWDM_V4); for(const doc of ['docs/reference.md','docs/api-response.schema.json','docs/media/badge-light.png']) readFileSync(base+doc); const prototype=pkg.CometWebCarbonBadge.prototype; assert.equal(typeof prototype.reload,'function'); for(const name of ['badgeData','score','co2Grams','cleanerThan','pageWeightKb','pageWeightKB','pageWeightKiB','measurementStatus']) assert.equal(typeof Object.getOwnPropertyDescriptor(prototype,name)?.get,'function');"],
  { cwd: tempDir, stdio: 'inherit' });
  execFileSync(process.execPath, ['--input-type=module', '-e',
    "import assert from 'node:assert/strict'; Object.defineProperty(globalThis,'HTMLElement',{configurable:true,get(){throw Error('API unexpectedly loaded UI')}}); const api=await import('@cometweb/carbon-badge/api'); assert.equal(api.parseApiResponse({url:'https://example.com/',status:'ready',co2_grams:0.23},{requestedUrl:'https://example.com/'}).score,'B'); assert.equal(typeof api.fetchSingleFlight,'function'); delete globalThis.HTMLElement; await import('@cometweb/carbon-badge/embed');"],
  { cwd: tempDir, stdio: 'inherit' });
  execFileSync(process.execPath, ['-e',
    "const api=require('@cometweb/carbon-badge/api'); if(api.parseApiResponse({url:'https://example.com/',status:'ready',co2_grams:0.23},{requestedUrl:'https://example.com/'}).score!=='B') process.exit(1);"],
  { cwd: tempDir, stdio: 'inherit' });
  execFileSync(process.execPath, ['-e',
    "const pkg = require('@cometweb/carbon-badge'); if (pkg.co2ToScore(0.23) !== 'B' || typeof pkg.registerCarbonBadge !== 'function') process.exit(1);"],
  { cwd: tempDir, stdio: 'inherit' });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
