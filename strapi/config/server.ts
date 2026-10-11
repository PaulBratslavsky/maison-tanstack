import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => {
  // 1339, so this project runs next to maison-demo (1338) and any other Strapi app (1337).
  const port = env.int('PORT', 1339);
  return {
    host: env('HOST', '127.0.0.1'),
    port,
    // The public address. The Maison plugin builds absolute media URLs from it, because the app runs on
    // another origin. strapi-oauth-mcp-manager uses it in its OAuth metadata.
    url: env('PUBLIC_URL', '') || `http://localhost:${port}`,
    // Where Strapi keeps its static files, uploads included. The integration tests set MAISON_PUBLIC_DIR so their seed images stay out of public/uploads.
    dirs: { public: env('MAISON_PUBLIC_DIR', './public') },
    app: {
      keys: env.array('APP_KEYS')!,
    },
    webhooks: {
      populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
    },
    // Strapi's built-in MCP server at /mcp. The Maison plugin registers its tools there.
    mcp: { enabled: env.bool('MCP_ENABLED', true) },
  };
};

export default config;
