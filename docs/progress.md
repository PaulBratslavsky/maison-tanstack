# Progress ledger

The next session starts here. Newest entries at the bottom of each section.

## State

- Phase 0 (plan): done. `docs/plan.md`.
- Phase 1 (scaffold): done, reviewed by Sonnet, one fix round (init-env: duplicate keys, the placeholder match, line endings, `KEY: value`).
- Phase 2 (Maison plugin, back end): done. Tasks 2A to 2E, two Sonnet reviews (no correctness bugs in the plugin), one fix round (two restored tests, the `@strapi/utils` check before every start and before the integration suites, init-env line endings and multi-line quoted values, trimmed LINE values), a short re-review. Checks: 2020 plugin unit tests, 163 integration tests, 58 script tests, both typechecks. Merged into `main`.
- Phase 3 (customer app, screens): done. Tasks 3A to 3C, a Sonnet review (no rule broken), one fix round (double submit, `visits` cleared by the form, locale in the query key, server-only marker, the not-found comment, five new e2e checks and separate demo customers per spec), a short re-review. Checks: 249 app tests, 2020 plugin tests, 58 script tests, 23 Playwright tests passed and 1 skipped (needs `VITE_LINE_OA_ID`), both typechecks, the app build. Merged into `main`.
- Phase 4 (concierge): in progress. 4A running (pure rules on TanStack AI message parts).

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
- Ruling: the app's server code reads `.env` values that are not `VITE_*` (`STRAPI_URL`, `ANTHROPIC_API_KEY`, `OLLAMA_*`) from `process.env`, which TanStack Start's Vite plugin fills with `loadEnv` in `vite dev` and `vite preview` (`@tanstack/start-plugin-core/dist/esm/vite/load-env-plugin/plugin.js`) - no extra wiring - a server started with plain `node dist/server/server.js` does not read `.env`; the host sets real variables (deployment notes).
- Ruling: the app's tsconfig drops `noUncheckedIndexedAccess` - the original does not use it and the ported code gave 40 errors - array reads are not checked for undefined by the compiler.
- Ruling: the mock-mode technical line joins its parts with ": " in place of an em dash - writing rules - none.
- Ruling: screen data uses TanStack Query through `useTool` (key `['tool', screen, name, args]`, no retries, no refetch on focus, `gcTime` 5 s so one screen load makes one MCP call); a booking removes the `visits` queries - spec section 6.2 - a cached list could show for up to 5 s after leaving a screen.
- Ruling: the QueryClient is made per router in `getRouter` and passed through router context - the TanStack Start pattern, one client per server request - none.
- Ruling: links to `/concierge` are plain `<a>` until phase 4 adds the route - a typed `Link` to a missing route fails the typecheck - none.
- Ruling: Playwright runs on the installed Google Chrome (`channel: 'chrome'`, a fresh temporary profile) - no 270 MB Chromium download - the tests follow whatever Chrome version this Mac has.
- Ruling: server-only app modules start with `import '@tanstack/react-start/server-only'`, so a client import that is used fails the build (Start's import protection; `start-client-core/skills/start-core/execution-model/SKILL.md`, "Import Protection: File Markers") - the original used Next's `server-only` - an import that is never used is tree-shaken and does not fail.
- Ruling: the booking form guards Send request with a ref set on the first tap, released after a refusal or failure and kept after a booking; the form itself clears the `visits` queries after a booking - TanStack Form's `onSubmit` runs only after its async checks, so two quick taps could both send - none.
- Ruling: the concierge's chat rules read TanStack AI `tool-call` parts only (`id`, `name`, `input`, `state`, `output`). The stream processor copies each tool result onto its call as parsed `output` and sets `state` to `complete` or `error` (`@tanstack/ai` 0.68 `activities/chat/stream/processor.js`, `handleToolCallResultEvent`). AI SDK states map as `input-streaming` to `input-streaming`, `input-available` to `input-complete`, `output-available` to `complete`, `output-error` to `error`; there are no `step-start` parts - the original's rules read AI SDK parts - a TanStack AI upgrade that changes part shapes breaks the rules' tests first.
- Ruling: `init-env` does not read multi-line quoted values - no `.env` here has one - a key inside such a value would count as present and not be added.

## Open with Paul

- Nothing open.

## Log

- 10 October 2026: phase 3 done and merged into `main`. The e2e global setup resets demo activity in the dev database on each run.
- 10 October 2026: phase 2 done and merged into `main`. The dev database now holds the demo admin, the catalog, the Public grants, the two tokens and the "Maison app" client; `app/.env` has `VITE_MAISON_CLIENT_ID`.
- 10 October 2026: merged phase 1 into `main` (fast-forward to 19be520). Set the Anthropic key in the worktree. Phase 2 started.
- 10 October 2026: phase 1. `init-env` with 16 tests (merges, never changes a set value, prints names only). Strapi 5.57 scaffold on SQLite, 1339, MCP on (`/mcp` answers 401 without a token), CORS for `http://localhost:3004`. TanStack Start app on 3004 with Tailwind v4, Vitest and a pin test. `npm install` at the root installs both and writes both `.env` files (mode 600). `npm run dev` starts both; checked `/_health` 204, `/admin` 200, the app 200, the CORS preflight.
- 9 October 2026: read the handoff, spec and inventories; checked versions with `npm view`; read the installed TanStack AI 0.68.0 types in a scratch install; wrote `docs/plan.md`. Merged `main` (619c3e6, the handoff note about the Anthropic key) into this branch.
