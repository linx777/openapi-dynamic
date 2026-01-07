import { createOpenAPI } from 'fumadocs-openapi/server';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const openapiSpecUrl = 'https://raw.githubusercontent.com/linx777/openapi-sample/main/sample.yaml';
// Use /tmp on Vercel (read-only project dir) and a repo-local cache elsewhere.
const cacheBaseDir =
  process.env.OPENAPI_CACHE_DIR ??
  (process.env.VERCEL ? join(tmpdir(), 'docs-hypereth-openapi') : join(process.cwd(), '.cache'));
const cachePath = join(cacheBaseDir, 'openapi-sample.yaml');
const fallbackSpecPath = join(process.cwd(), 'content', 'docs', 'sample.yaml');
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

async function ensureCachedSpec(): Promise<string> {
  let isFresh = false;

  try {
    const file = await stat(cachePath);
    isFresh = Date.now() - file.mtimeMs < CACHE_TTL_MS;
  } catch {
    isFresh = false;
  }

  if (!isFresh) {
    try {
      const res = await fetch(openapiSpecUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`);

      const yaml = await res.text();
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, yaml, 'utf8');
      isFresh = true;
    } catch (error) {
      // If network fails, fall back to last cached copy (if it exists)
      try {
        await readFile(cachePath, 'utf8');
      } catch {
        // As a final fallback, use the bundled local spec and seed the cache with it
        try {
          const fallback = await readFile(fallbackSpecPath, 'utf8');
          await mkdir(dirname(cachePath), { recursive: true });
          await writeFile(cachePath, fallback, 'utf8');
        } catch {
          throw new Error('Failed to download OpenAPI spec and no cached copy is available', {
            cause: error,
          });
        }
      }
    }
  }

  // Always return the cached file path; it contains the latest successful download
  return cachePath;
}

export const openapi = createOpenAPI({
  // Download the latest spec into .cache/, reusing the cached copy when offline
  input: async () => ({
    [openapiSpecUrl]: await ensureCachedSpec(),
  }),
});
