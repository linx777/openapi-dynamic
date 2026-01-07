import { docs } from 'fumadocs-mdx:collections/server';
import { type InferPageType, loader, multiple } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { openapiPlugin, openapiSource } from 'fumadocs-openapi/server';
import { openapi } from '@/lib/openapi';

const SOURCE_REVALIDATE_MS = 2 * 60 * 1000; // keep in sync with OpenAPI cache TTL
export const SOURCE_REVALIDATE_SECONDS = SOURCE_REVALIDATE_MS / 1000;

async function createSource() {
  const openapiPages = await openapiSource(openapi, {
    baseDir: 'openapi',
  });

  // See https://fumadocs.dev/docs/headless/source-api for more info
  return loader(
    multiple({
      docs: docs.toFumadocsSource(),
      openapi: openapiPages,
    }),
    {
      baseUrl: '/docs',
      plugins: [lucideIconsPlugin(), openapiPlugin()],
    },
  );
}

type Source = Awaited<ReturnType<typeof createSource>>;
type Page = InferPageType<Source>;

let cachedSource: Source | null = null;
let cachedAt = 0;

export async function getSource() {
  if (cachedSource && Date.now() - cachedAt < SOURCE_REVALIDATE_MS) {
    return cachedSource;
  }

  cachedSource = await createSource();
  cachedAt = Date.now();
  return cachedSource;
}

export function getPageImage(page: Page) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: `/og/docs/${segments.join('/')}`,
  };
}

export async function getLLMText(page: Page) {
  if (page.data.type === 'openapi') {
    return JSON.stringify(page.data.getSchema().bundled, null, 2);
  }

  const processed = await page.data.getText('processed');

  return `# ${page.data.title}

${processed}`;
}
