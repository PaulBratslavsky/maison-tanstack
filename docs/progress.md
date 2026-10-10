# Progress ledger

The next session starts here. Newest entries at the bottom of each section.

## State

- Phase 0 (plan): done. `docs/plan.md`.
- Phase 1 (scaffold): done, reviewed by Sonnet, one fix round (init-env: duplicate keys, the placeholder match, line endings, `KEY: value`).
- Phase 2 (Maison plugin, back end): in progress. 2A done (skeleton, 19 domain files, seed data, config validator; 534 unit tests). 2B done (10 content types, Home page, document middleware, integration harness, the `@strapi/utils` fix; 593 unit and 6 integration tests). 2C done (12 services, labelling stub, bootstrap cron and warnings; 1334 unit and 122 integration tests). Note: 2C copied most service tests and code from the original together, so only the new tests were seen failing before their code; the ported tests failed on missing modules. 2D done (strapi-oauth-mcp-manager 1.1.0, 13 MCP tools and the prompt on Strapi's native MCP server, 22 admin and 7 REST routes, 13 RBAC actions; 1983 unit and 163 integration tests). The new MCP integration test was written after its code; I checked it by switching off `registerMcp`: 10 of 12 failed, then all 12 passed again. 2E done (LINE verify mock on 4546, `npm run setup`, root `dev`, `setup`, `test`, `test:integration`). By hand: setup on the dev database made the demo admin (first admin), the catalog (3 collections, 12 products, 3 boutiques), the Public grants, two tokens and the "Maison app" client; a LINE token exchange for a demo customer answered 200, and that session listed only customer tools. Phase 2 review done (two Sonnet reviewers): no correctness bugs in the plugin; low findings in tests, scripts and config. Fix round running.

## Rulings

Format: `Ruling: <what> - <why> - <cost if wrong>`.

- Ruling: work happens in the git worktree `.claude/worktrees/mystifying-fermi-232239` on branch `claude/mystifying-fermi-232239`, merged into `main` at the end of each phase - the desktop app made the worktree for this session - a merge step per phase.
- Ruling: the concierge wraps Strapi's MCP tools with its own code on `@modelcontextprotocol/sdk` 1.32, not `@tanstack/ai-mcp` 0.8.3 - `ai-mcp` throws a flat `Error` on `isError` and loses `{error:{code,message,hint}}`, which the chat's tool lines, prompt rule 6 and the auto hand-off read - about 50 lines of wrapper code that `ai-mcp` would have saved.
- Ruling: the extra pass limits tools and forces `choose_visit` through a chat middleware `onConfig` (per-iteration `tools` and Anthropic `modelOptions.tool_choice`) - `chat()` 0.68 has no `activeTools` or `toolChoice` option - none known on Anthropic; on Ollama the call cannot be forced (open question 2).
- Ruling: the `choose_visit` slug pre-check runs as an `onBeforeToolCall` middleware answering `skip` with Strapi's error - a `.client()` tool has no server execute to hold the check - if the hook does not fire for client tools, task 4.4 moves the check into a server wrapper.
- Ruling: labelling passes `claude-haiku-4-5-20251001` to `createAnthropicChat` with one typed cast - the adapter's model list only has `claude-haiku-4-5` - a type error after an adapter upgrade.
- Ruling: browser env names are `VITE_*` in place of `NEXT_PUBLIC_*` - Vite inlines only `VITE_*` into the client bundle - none; docs list the mapping.
- Ruling: per-send token and locale go through `fetchServerSentEvents`'s async options function - `useChat`'s `body` is deprecated in ai-client 0.39 - none.
- Ruling: Paul confirmed on 10 October that the concierge uses our own wrapper on `@modelcontextprotocol/sdk` (option A), and that Strapi always uses its native MCP server - his decision - none.
- Ruling: the app uses TypeScript 7.0.2, the current major, and Strapi keeps the TypeScript 5 its generator chose - `tsc --noEmit` passes on both - pin TypeScript 5.9 in the app if a later tool needs it.
- Ruling: `app/src/routeTree.gen.ts` is committed - a fresh clone then typechecks before the first build - a noisy diff when routes change.
- Ruling: `npm start` in the app is `vite preview` for now - Start without Nitro builds a fetch handler in `dist/server`, not `.output` - phase 7 (`start:line`) and the deployment notes pick the production server.

- Ruling: Strapi's CORS allows `http://localhost:3004` only, as the spec says, though Vite prints `http://127.0.0.1:3004` - the original did the same and its mock-mode error line tells you to open `localhost` - a CORS error for anyone who clicks Vite's link; phase 3 ports that error line and the README says to open `localhost`.
- Ruling: Paul decided on 10 October that the extra pass runs on Ollama too, offering only `resolve_date` and `choose_visit`; Ollama cannot force the call, so the server logs when no picker came back - his decision - none.
- Ruling: Paul decided on 10 October to merge each phase into `main` when it ends (fast-forward from this branch) - his decision - none.
- Ruling: the Anthropic key was set in this worktree's `strapi/.env` (`AI_API_KEY`) and `app/.env` (`ANTHROPIC_API_KEY`) from the main checkout's files, at Paul's yes on 10 October, by a script that only fills an empty value and prints names only - his decision - none.
- Ruling: the LINE flex message writes a hyphen, not an em dash, in an empty field - the project bans em dashes in strings, and LINE only needs a non-empty text node - a small visual difference from the original confirmation.
- Ruling: `aiBaseUrl` is the Ollama host and `aiProvider` is `anthropic` or `ollama` (task 2A) - spec section 8 replaces OpenAI with Ollama - none.
- Ruling: Strapi 5.57 still needs the `@strapi/utils` sharing fix (`strapi/scripts/share-strapi-utils.mjs` at postinstall, `--check` before develop) - without it the plugin had its own copy, a document-middleware `ValidationError` was not core's, and the Content Manager answered 500; with it, 400 (`test/integration/validation-errors.test.mjs`) - a reinstall of the plugin alone, without the postinstall, brings the 500 back.
- Ruling: the closed-hours hint reads "from 11:00 to 20:00", not an en dash range - the writing rules ban en dashes - none.
- Ruling: the labelling service is a stub until phase 5: with AI off it marks pending inquiries `skipped`; with a key or an Ollama host it does nothing and logs once - labelling moves to TanStack AI in phase 5 - inquiries stay pending on a laptop with a key until then.
- Ruling: the admin page tests `questions-admin`, `inquiries-admin`, `conversations-admin` and the PERMISSIONS half of `admin-permissions` wait for phase 5 - they import `admin/src/*`, which phase 5 builds; the service tests cover the server side - a gap in admin coverage until phase 5.
- Ruling: `registerMcp` logs how many tools and prompts it registered - Strapi's start-up log showed none - one log line per start.
- Ruling: a customer session lists 9 Maison tools (5 catalog, `request_appointment`, `my_appointments`, `hand_off_to_staff`, `log_inquiry`) plus Strapi's own dev-only `log` tool - checked by hand on 10 October; the app's "8 MCP tools" label leaves out `log_inquiry`, which only the app's server calls - none.
- Ruling: `MAISON_SETUP_LIFF_ENV` is renamed `MAISON_SETUP_APP_ENV` and setup writes `VITE_STRAPI_URL` and `VITE_MAISON_CLIENT_ID` to `app/.env` with init-env's merge rules - the app folder and Vite names changed - anyone used to the original's name.
- Ruling: more admin-side unit tests wait for phase 5 because they import `admin/src/*`: `seed-result`, `line-note`, `your-line-badge`, `poll`, `single-flight`, `time-ago`, `board` and `admin-widgets` - phase 5 builds the admin page - no admin coverage until then.
- Ruling: `readme-ask` (README claims about the assistant) waits for phase 6 and the README in phase 8 - it imports `server/src/assistant/tools` - none until then.
- Ruling: P's live labelling test, `vitest.live.config.ts` and `test:live` come back in phase 5 on TanStack AI - they called the AI SDK - none until phase 5.
- Ruling: P's `test/mcp/tools.test.mjs` and `scripts/mcp-dev-tokens.mjs` are replaced by `test/integration/mcp.test.mjs`, which boots Strapi in process and mints its own tokens - the old suite needed a running dev server and left tokens behind - none.
- Ruling: P's `scripts/check-esm-import.mjs` comes back in phase 6 with the assistant (plan task 6.4) - nothing loads TanStack AI in Strapi until then - none.
- Ruling: P's `scripts/generate-seed-images.mjs`, the `link` script (yalc), and the plugin README and CHANGELOG are not ported - the seed images are committed JPEGs, nothing publishes the plugin, and the docs come in phase 8 - a missing plugin README until phase 8.
- Ruling: `init-env` does not read multi-line quoted values - no `.env` here has one - a key inside such a value would count as present and not be added.

## Open with Paul

- Nothing open.

## Log

- 10 October 2026: merged phase 1 into `main` (fast-forward to 19be520). Set the Anthropic key in the worktree. Phase 2 started.
- 10 October 2026: phase 1. `init-env` with 16 tests (merges, never changes a set value, prints names only). Strapi 5.57 scaffold on SQLite, 1339, MCP on (`/mcp` answers 401 without a token), CORS for `http://localhost:3004`. TanStack Start app on 3004 with Tailwind v4, Vitest and a pin test. `npm install` at the root installs both and writes both `.env` files (mode 600). `npm run dev` starts both; checked `/_health` 204, `/admin` 200, the app 200, the CORS preflight.
- 9 October 2026: read the handoff, spec and inventories; checked versions with `npm view`; read the installed TanStack AI 0.68.0 types in a scratch install; wrote `docs/plan.md`. Merged `main` (619c3e6, the handoff note about the Anthropic key) into this branch.
