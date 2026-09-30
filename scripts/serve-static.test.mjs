/**
 * Node tests for the Playwright static file server path hardening.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer, isPathInsideRoot } from './serve-static.mjs';

const tempDirs = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'carbon-badge-static-'));
  tempDirs.push(root);
  return root;
}

beforeEach(() => {
  // Global happy-dom setup stubs fetch; this suite needs the real Node fetch.
  vi.unstubAllGlobals();
});

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    await rm(dir, { recursive: true, force: true });
  }
});

async function withServer(root, run) {
  const server = createStaticServer(root);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    return await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('isPathInsideRoot', () => {
  it('rejects prefix lookalikes like /root vs /root-evil', () => {
    expect(isPathInsideRoot('/root/file', '/root')).toBe(true);
    expect(isPathInsideRoot('/root', '/root')).toBe(true);
    expect(isPathInsideRoot('/root-evil/secret', '/root')).toBe(false);
    expect(isPathInsideRoot('/root2/file', '/root')).toBe(false);
  });
});

describe('serve-static symlink escape', () => {
  it('serves a normal in-tree file', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'ok.txt'), 'hello-ok', 'utf8');

    await withServer(root, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/ok.txt`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('hello-ok');
    });
  });

  it('returns 404 for an in-tree symlink to a file outside the root', async () => {
    const root = await makeRoot();
    const outsideDir = await makeRoot();
    const secretPath = join(outsideDir, 'secret.txt');
    const secretBody = 'TOP-SECRET-OUTSIDE-ROOT';
    await writeFile(secretPath, secretBody, 'utf8');
    await symlink(secretPath, join(root, 'escape.txt'));

    await withServer(root, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/escape.txt`);
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).toBe('Not found');
      expect(body).not.toContain(secretBody);
    });
  });

  it('returns 404 when a directory symlink would escape the root', async () => {
    const root = await makeRoot();
    const outsideDir = await makeRoot();
    const secretBody = 'DIR-SYMLINK-SECRET';
    await writeFile(join(outsideDir, 'secret.txt'), secretBody, 'utf8');
    await mkdir(join(root, 'safe'), { recursive: true });
    await symlink(outsideDir, join(root, 'linked'));

    await withServer(root, async (port) => {
      const response = await fetch(
        `http://127.0.0.1:${port}/linked/secret.txt`,
      );
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).not.toContain(secretBody);
    });
  });
});
