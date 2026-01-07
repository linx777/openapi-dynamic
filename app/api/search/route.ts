import { unstable_cache } from 'next/cache';
import { SOURCE_REVALIDATE_SECONDS, getSource } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

const getSearchHandler = unstable_cache(
  async () =>
    createFromSource(await getSource(), {
      // https://docs.orama.com/docs/orama-js/supported-languages
      language: 'english',
    }),
  ['docs-search-handler'],
  { revalidate: SOURCE_REVALIDATE_SECONDS },
);

export const GET = async (req: Request) => {
  const { GET } = await getSearchHandler();
  return GET(req);
};
