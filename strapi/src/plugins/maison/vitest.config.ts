import path from 'node:path';

import { defineConfig } from 'vitest/config';

/** The ES module entry of a package whose `main` is a CommonJS file under "type": "module", which Node can't load. */
const esEntry = (name: string) => path.resolve(__dirname, 'node_modules', name, 'dist', 'index.mjs');

export default defineConfig({
  // The admin's components use the automatic JSX runtime, as the plugin's own build does. Vitest needs telling separately.
  esbuild: { jsx: 'automatic' },
  resolve: {
    // These three packages have "type": "module" and a `main` that is a CommonJS file, so Node can't load them. Their ES module
    // entries are what the Strapi admin's own build uses.
    alias: [
      { find: /^@strapi\/design-system$/, replacement: esEntry('@strapi/design-system') },
      { find: /^@strapi\/icons$/, replacement: esEntry('@strapi/icons') },
      { find: /^@strapi\/ui-primitives$/, replacement: esEntry('@strapi/ui-primitives') },
    ],
  },
  test: {
    include: ['test/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Vite processes them, so their imports of CommonJS packages such as lodash work as they do in the admin's build. The component
    // tests choose jsdom for themselves, with `// @vitest-environment jsdom` on their first line.
    server: { deps: { inline: [/@strapi\/(design-system|icons|ui-primitives)/] } },
  },
});
