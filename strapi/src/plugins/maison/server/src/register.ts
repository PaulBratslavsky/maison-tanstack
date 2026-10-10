import type { Core } from '@strapi/strapi';

import { registerDocumentMiddleware } from './document-middleware';

// The MCP tools are registered here too, once a later task adds them.
const register = ({ strapi }: { strapi: Core.Strapi }) => {
  registerDocumentMiddleware(strapi);
};

export default register;
