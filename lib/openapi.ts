import { createOpenAPI } from 'fumadocs-openapi/server';

const openapiSpecUrl = 'https://raw.githubusercontent.com/linx777/openapi-sample/main/sample.yaml';

export const openapi = createOpenAPI({
  // Fetch OpenAPI schema from GitHub via Loader API
  input: [openapiSpecUrl],
});
