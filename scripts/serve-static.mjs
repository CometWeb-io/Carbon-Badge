import { createServer } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * True when `candidate` is `rootPath` or a path strictly under it.
 * Uses `${root}${sep}` so `/root-evil` is not treated as inside `/root`.
 */
export function isPathInsideRoot(candidate, rootPath) {
  const root = rootPath.endsWith(sep) ? rootPath.slice(0, -1) : rootPath;
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

/**
 * Resolve a request path to a regular file under `rootDir`.
 * Refuses path traversal, symlinks, and realpath escapes outside the root.
 */
export async function resolveSafeStaticFile(rootDir, requestPath) {
  const root = resolve(rootDir);
  const relative = normalize(requestPath).replace(/^[/\\]+/, '');
  const file = resolve(root, relative);
  if (!isPathInsideRoot(file, root)) {
    throw Object.assign(new Error('path traversal'), { code: 'PATH_TRAVERSAL' });
  }

  const stats = await lstat(file);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw Object.assign(new Error('not a regular file'), {
      code: 'NOT_REGULAR_FILE',
    });
  }

  const realRoot = await realpath(root);
  const realFile = await realpath(file);
  if (!isPathInsideRoot(realFile, realRoot)) {
    throw Object.assign(new Error('path escapes root'), {
      code: 'PATH_ESCAPES_ROOT',
    });
  }

  return {
    file: realFile,
    contentType: contentTypes[extname(realFile)] || 'application/octet-stream',
  };
}

export function createStaticServer(rootDir = process.cwd()) {
  const root = resolve(rootDir);
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url || '/', 'http://localhost').pathname,
      );
      const { file, contentType } = await resolveSafeStaticFile(root, pathname);
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
}

const isMain =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const port = Number(process.argv[2] || 4177);
  createStaticServer(process.cwd()).listen(port, '127.0.0.1');
}
