import { getPageImage, source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { generate as DefaultImage } from 'fumadocs-ui/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const revalidate = false;
export const runtime = 'nodejs';

const interRegular = readFile(join(process.cwd(), 'app/fonts/inter/Inter-Regular.ttf'));
const interItalic = readFile(join(process.cwd(), 'app/fonts/inter/Inter-Italic.ttf'));

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  const regularFont = await interRegular;
  const italicFont = await interItalic;

  return new ImageResponse(
    <DefaultImage title={page.data.title} description={page.data.description} site="My App" />,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Inter',
          data: regularFont,
          weight: 400,
          style: 'normal',
        },
        {
          name: 'Inter',
          data: italicFont,
          weight: 400,
          style: 'italic',
        },
      ],
    },
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }));
}
