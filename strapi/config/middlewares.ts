import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    // The Maison app calls /mcp and the OAuth token endpoint from the browser, on http://localhost:3004.
    // CORS allows that origin and the MCP headers. MAISON_APP_ORIGIN adds one more origin, for an app
    // that calls Strapi directly from somewhere else.
    name: 'strapi::cors',
    config: {
      origin: [
        'http://localhost:3004',
        ...(env('MAISON_APP_ORIGIN', '') ? [env('MAISON_APP_ORIGIN')] : []),
      ],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: [
        'Content-Type',
        'Authorization',
        'Origin',
        'Accept',
        'mcp-session-id',
        'mcp-protocol-version',
        'Last-Event-ID',
      ],
      // Retry-After tells the app how long to wait when sign-in answers temporarily_unavailable.
      expose: ['WWW-Authenticate', 'mcp-session-id', 'mcp-protocol-version', 'Retry-After'],
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
