import type { Core } from '@strapi/strapi';

import { registerDocumentMiddleware } from './document-middleware';
import { registerMcp } from './mcp';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  registerDocumentMiddleware(strapi);
  registerMcp(strapi);
};

export default register;
