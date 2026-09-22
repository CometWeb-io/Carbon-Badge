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
  execFileSync(process.execPath, ['--input-type=module', '-e',
    "const pkg = await import('@cometweb/carbon-badge'); if (pkg.co2ToScore(0.23) !== 'B' || typeof pkg.registerCarbonBadge !== 'function') process.exit(1);"],
  { cwd: tempDir, stdio: 'inherit' });
  execFileSync(process.execPath, ['-e',
    "const pkg = require('@cometweb/carbon-badge'); if (pkg.co2ToScore(0.23) !== 'B' || typeof pkg.registerCarbonBadge !== 'function') process.exit(1);"],
  { cwd: tempDir, stdio: 'inherit' });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
