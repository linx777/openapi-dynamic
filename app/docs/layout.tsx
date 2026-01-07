import { getSource } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';

export default async function Layout({ children }: LayoutProps<'/docs'>) {
  const source = await getSource();
  const tree: any = source.getPageTree();

  const openapiPrefix = '/docs/openapi/';

  // Strip existing OpenAPI nodes from the tree
  function isOpenApiFolder(node: any) {
    return typeof node.name === 'string' && node.name.toLowerCase() === 'openapi';
  }

  function stripOpenAPI(nodes: any[]): any[] {
    const out: any[] = [];
    for (const node of nodes ?? []) {
      if (isOpenApiFolder(node)) continue;
      if (node.type === 'page' && typeof node.url === 'string' && node.url.startsWith(openapiPrefix)) {
        continue;
      }
      if (node.type === 'folder' && Array.isArray(node.children)) {
        const children = stripOpenAPI(node.children);
        if (children.length === 0) continue;
        out.push({ ...node, children });
        continue;
      }
      out.push(node);
    }
    return out;
  }

  // Build OpenAPI groups by tag from source pages
  const openapiPages = await Promise.all(
    source
      .getPages()
      .filter((page) => page.data?.type === 'openapi' && typeof (page as any).url === 'string')
      .map(async (page) => {
        let tag = 'OpenAPI';
        try {
          const apiData = page.data as any;
          if (typeof apiData.getAPIPageProps === 'function') {
            const props = await apiData.getAPIPageProps();
            tag = props?.operations?.[0]?.tags?.[0] ?? tag;
          }
        } catch {
          // ignore and fall back to default tag
        }

        return {
          page,
          url: (page as any).url as string,
          title: page.data.title,
          tag,
        };
      }),
  );

  const groupedByTag = new Map<string, any[]>();
  for (const entry of openapiPages) {
    const list = groupedByTag.get(entry.tag) ?? [];
    list.push({
      type: 'page',
      name: entry.title,
      url: entry.url,
    });
    groupedByTag.set(entry.tag, list);
  }

  const openapiGrouped = Array.from(groupedByTag.entries()).map(([tag, children]) => ({
    type: 'folder',
    name: tag,
    children,
  }));

  openapiGrouped.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const unifiedFolder =
    openapiGrouped.length > 0
      ? {
          type: 'folder',
          name: 'Unified REST API',
          children: openapiGrouped,
        }
      : null;

  const groupedTree =
    unifiedFolder != null
      ? {
          ...tree,
          children: [...stripOpenAPI(tree.children), unifiedFolder],
        }
      : tree;

  return (
    <DocsLayout tree={groupedTree} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}
