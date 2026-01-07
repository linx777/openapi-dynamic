import { createOpenAPI } from 'fumadocs-openapi/server';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createSign } from 'node:crypto';
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
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY;

function base64UrlEncode(data: string | Buffer) {
  return Buffer.from(data).toString('base64url');
}

function normalizePrivateKey(key: string) {
  return key.includes('BEGIN PRIVATE KEY') ? key : key.replace(/\\n/g, '\n');
}

async function createGitHubAppToken() {
  if (!GITHUB_APP_ID || !GITHUB_APP_INSTALLATION_ID || !GITHUB_APP_PRIVATE_KEY) {
    return null;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: GITHUB_APP_ID,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(normalizePrivateKey(GITHUB_APP_PRIVATE_KEY), 'base64url');
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch(
    `https://api.github.com/app/installations/${GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch GitHub App installation token: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { token?: string };
  return json.token ?? null;
}

async function ensureCachedSpec(): Promise<string> {
  let isFresh = false;

  try {
    const file = await stat(cachePath);
    isFresh = Date.now() - file.mtimeMs < CACHE_TTL_MS;
  } catch {
    isFresh = false;
  }

  if (!isFresh) {
    const token = await createGitHubAppToken();
    const hasAuth = Boolean(token);
    console.info(`[openapi] Fetching spec from ${openapiSpecUrl} (auth: ${hasAuth ? 'github-app' : 'none'})`);
    try {
      const res = await fetch(openapiSpecUrl, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      console.info(`[openapi] Fetch status: ${res.status} ${res.statusText}`);
      if (!res.ok) throw new Error(`Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`);

      const yaml = await res.text();
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, yaml, 'utf8');
      isFresh = true;
      console.info('[openapi] Spec cached successfully');
    } catch (error) {
      console.warn('[openapi] Fetch failed, trying cache/local fallback', error instanceof Error ? error.message : error);
      // If network fails, fall back to last cached copy (if it exists)
      try {
        await readFile(cachePath, 'utf8');
        console.info('[openapi] Using previously cached spec');
      } catch {
        // As a final fallback, use the bundled local spec and seed the cache with it
        try {
          const fallback = await readFile(fallbackSpecPath, 'utf8');
          await mkdir(dirname(cachePath), { recursive: true });
          await writeFile(cachePath, fallback, 'utf8');
          console.info('[openapi] Seeded cache from local fallback spec');
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
  disableCache: true,
  input: async () => ({
    [openapiSpecUrl]: await ensureCachedSpec(),
  }),
});
