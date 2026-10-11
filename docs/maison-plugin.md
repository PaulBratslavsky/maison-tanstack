# The Maison plugin in this repo

`strapi/src/plugins/maison` is the Maison plugin, and this repository is its home: change Maison here. Strapi loads it as a local plugin from `strapi/config/plugins.ts` (`resolve: 'src/plugins/maison'`), and configures it there.

The plugin's own README, [`strapi/src/plugins/maison/README.md`](../strapi/src/plugins/maison/README.md), is the full reference. This page says where the plugin lives, how it shares Strapi's packages, how to work on it, and what the reference holds.

## What is in the plugin

| Part | Where | Count and notes |
| --- | --- | --- |
| Content types | `server/src/content-types` | 10: collection, product, boutique, stock-level, appointment, notification, knowledge, question, inquiry, conversation. The `home-page` single type is in `strapi/src/api/home-page` |
| Services | `server/src/services` | catalog, appointments, identity, confirmations, line-confirmations, questions, inquiries, labelling, assistant, conversations, seed, errors |
| Domain rules | `server/src/domain` | Pure functions with their own unit tests |
| MCP tools and the prompt | `server/src/mcp` | 13 tools and the prompt `send_pending_confirmations`, registered in `register()` through `strapi.ai.mcp` |
| REST routes | `server/src/routes` (`content-api`) | 7, under `/api/maison` |
| Admin routes | `server/src/routes` (`admin`) | 24, under `/maison` |
| RBAC actions | `server/src/bootstrap.ts` | 13 |
| Admin | `admin/src` | The Maison page (Requests, Questions, Inquiries), two Homepage widgets, and the staff assistant drawer |
| Labelling | `server/src/services/labelling.ts` | A per-minute cron sweep, on TanStack AI |
| Seed data | `server/seed` | `content.json`, `knowledge.json`, `activity.json`, 18 images |
| Tests | `test/unit`, `test/integration`, `test/live` | See [Testing](testing.md) |

A test (`test/unit/readme-ask.test.ts`) holds the README's lists of tools, routes, permissions, configuration keys, content types and seed counts, and its section on the assistant drawer, to the code. Change the code and the README together, or `npm test` fails.

## How the plugin shares Strapi's packages

Two settings keep one copy of Strapi's packages:

- **One Strapi version.** `strapi/package.json` holds eight `@strapi` packages at 5.57.0 in `overrides`. Without them, npm resolves Strapi's own `^5.0.0` peer ranges to a newer release, and a second copy of `@strapi/utils` turns Maison's 400s into 500s.
- **Maison shares Strapi's `@strapi/utils`.** Maison is a local plugin with its own dependencies, so its build would load its own copy. `strapi/scripts/share-strapi-utils.mjs` removes that copy after the build, on every `npm install` in `strapi/` (the `postinstall` script). `npm test` runs it with `--check`, and so do `develop`, `start` and the integration suites. A test boots Strapi and checks that a Content Manager save that Maison rejects answers 400, not 500 (`test/integration/validation-errors.test.mjs`).

The plugin's own dependencies include the TanStack AI packages, pinned to exact versions. Only `server/src/ai/sdk.ts` loads them, with a cached dynamic `import()`, because the plugin's server is CommonJS and they are ES modules. `npm run build` in the plugin then runs `scripts/check-esm-import.mjs`, which fails if a built bundle loads them statically ([How Maison works](architecture.md#the-one-cached-dynamic-import-in-strapi)).

## Work on the plugin in place

- Run `npm run watch` in the plugin's folder, and restart Strapi to load each rebuild. The plugin runs from `dist/`.
- If you run `npm install` in the plugin's folder, stop Strapi and run `npm install --prefix strapi` afterwards, or run `node scripts/share-strapi-utils.mjs` from `strapi/`. Until then, `npm run dev:strapi` refuses to start: the `predevelop` check finds Maison's own `@strapi/utils`.
- Write each test first and see it fail. Run `npm test` in the plugin's folder, then `npm run test:ts:back` and `npm run test:ts:front`, and `npm run test:integration` for anything that touches Strapi.
- Strapi's start-up log says how many tools and prompts Maison registered.
