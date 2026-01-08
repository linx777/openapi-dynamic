import { createOpenAPI } from 'fumadocs-openapi/server';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repoOwner = process.env.OPENAPI_REPO_OWNER ?? 'linx777';
const repoName = process.env.OPENAPI_REPO_NAME ?? 'openapi-sample';
const repoPath = process.env.OPENAPI_REPO_PATH ?? 'sample.yaml';
const openapiSpecUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${repoPath}`;
// Use /tmp on Vercel (read-only project dir) and a repo-local cache elsewhere.
const cacheBaseDir =
  process.env.OPENAPI_CACHE_DIR ??
  (process.env.VERCEL ? join(tmpdir(), 'docs-hypereth-openapi') : join(process.cwd(), '.cache'));
const cachePath = join(cacheBaseDir, 'openapi-sample.yaml');
const fallbackSpecPath = join(process.cwd(), 'content', 'docs', 'sample.yaml');
const CACHE_TTL_MS = Number(process.env.OPENAPI_CACHE_TTL_MS ?? 2 * 60 * 1000); // 2 minutes by default
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

async function fetchAndCacheSpec(token: string | null) {
  const hasAuth = Boolean(token);
  console.info(`[openapi] Fetching spec from ${openapiSpecUrl} (auth: ${hasAuth ? 'github-app' : 'none'})`);
  const res = await fetch(openapiSpecUrl, {
    cache: 'no-store',
    headers: token
      ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
      : { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  console.info(`[openapi] Fetch status: ${res.status} ${res.statusText}`);
  if (!res.ok) throw new Error(`Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`);

  const json = (await res.json()) as { content?: string; encoding?: string };
  if (!json.content || json.encoding !== 'base64') {
    throw new Error('Failed to fetch OpenAPI spec: unexpected GitHub content response');
  }

  const yaml = Buffer.from(json.content, 'base64').toString('utf8');
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, yaml, 'utf8');
  console.info('[openapi] Spec cached successfully');
}

async function ensureCachedSpec(): Promise<string> {
  let isFresh = false;
  let hasCached = false;

  try {
    const file = await stat(cachePath);
    hasCached = true;
    isFresh = Date.now() - file.mtimeMs < CACHE_TTL_MS;
  } catch {
    isFresh = false;
  }

  if (isFresh) {
    return cachePath;
  }

  const token = await createGitHubAppToken();

  // If we have a stale cached copy, serve it immediately and refresh in background
  if (hasCached) {
    fetchAndCacheSpec(token).catch((error) => {
      console.warn(
        '[openapi] Background refresh failed, keeping stale cache',
        error instanceof Error ? error.message : error,
      );
    });
    console.info('[openapi] Serving stale cached spec while refreshing in background');
    return cachePath;
  }

  // No cache available: must fetch or fall back
  try {
    await fetchAndCacheSpec(token);
    return cachePath;
  } catch (error) {
    console.warn(
      '[openapi] Initial fetch failed, trying local fallback',
      error instanceof Error ? error.message : error,
    );
    try {
      const fallback = await readFile(fallbackSpecPath, 'utf8');
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, fallback, 'utf8');
      console.info('[openapi] Seeded cache from local fallback spec');
      return cachePath;
    } catch {
      throw new Error('Failed to download OpenAPI spec and no cached copy is available', {
        cause: error,
      });
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
