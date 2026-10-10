import type { StrapiApp } from '@strapi/strapi/admin';

import { PLUGIN_ID } from './pluginId';

export default {
  // The plugin has no menu link yet. The admin page comes in phase 5.
  register(app: StrapiApp) {
    app.registerPlugin({ id: PLUGIN_ID, name: 'Maison' });
  },
};
