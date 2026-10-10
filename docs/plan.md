# Maison on TanStack: the plan

Written 9 October 2026 from `docs/spec.md`, the two inventories, and the installed package types. Each task names its files, its tests and its checks. A task is done when its tests were seen to fail first, then pass, every check is green, and it is committed. Decisions go in `docs/progress.md` as rulings.

## 0. Versions and what the packages can do

### Versions pinned on 9 October 2026 (`npm view`)

| Package | Version | Pin |
| --- | --- | --- |
| `@tanstack/react-start` | 1.168.60 | exact |
| `@tanstack/react-router` | 1.170.41 | exact (the version Start depends on) |
| `@tanstack/react-query` | 5.104.1 | caret |
| `@tanstack/react-form` | 1.33.5 | caret |
| `@tanstack/ai` | 0.68.0 | exact |
| `@tanstack/ai-client` | 0.39.2 | exact |
| `@tanstack/ai-react` | 0.30.3 | exact |
| `@tanstack/ai-anthropic` | 0.21.1 | exact |
| `@tanstack/ai-ollama` | 0.11.16 | exact |
| `@modelcontextprotocol/sdk` | 1.32.1 | caret |
| `@strapi/strapi` and core packages | 5.57.0 | exact, with `overrides` |
| `strapi-oauth-mcp-manager` | 1.1.0 | caret |
| `@strapi/sdk-plugin` | 6.1.1 | caret |
| `@line/liff`, `@line/liff-mock` | 2.31.2, 1.0.4 | caret |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.3 | caret |
| `vite` | 8.3.4 | caret (Start needs `>=7`) |
| `vitest` | 5.0.3 | caret |
| `@playwright/test` | 1.64.0 | caret |
| `zod` | 4.6.5 | caret |
| Node | 24.14.1 on this laptop; engines `>=22.12` | |

All five TanStack AI packages resolve to one copy of `@tanstack/ai` 0.68.0 (checked with `npm ls` in a scratch install). A unit test in each half holds the exact pins.

### TanStack AI 0.68.0: facts read from the installed types

- **Server.** `chat({ adapter, messages, systemPrompts, tools, agentLoopStrategy: maxIterations(n), abortController, modelOptions, middleware, outputSchema, stream })`. `toServerSentEventsResponse`, `chatParamsFromRequestBody`, `toolDefinition().server()` and `.client()` are all exported from `@tanstack/ai`.
- **Structured output.** `chat({ outputSchema })` returns a promise of the parsed object. The Anthropic adapter forces a `structured_output` tool for it. This replaces `generateObject` for labelling.
- **Adapters.** `createAnthropicChat(model, apiKey)` from `@tanstack/ai-anthropic`. `createOllamaChat(model, host)` from `@tanstack/ai-ollama`; `modelOptions.think: false` turns thinking off.
- **Model IDs.** The adapter's list has `claude-sonnet-5-5` but only `claude-haiku-4-5`, not `claude-haiku-4-5-20251001`. Labelling passes the dated ID with one typed cast in one file.
- **Forcing a tool and limiting tools.** There is no `activeTools` or `toolChoice` option on `chat()`. Two pieces do the same job:
  - A chat middleware's `onConfig` runs at the start of every agent iteration and may return new `tools` and `modelOptions` for that call only.
  - The Anthropic adapter accepts `modelOptions.tool_choice` (`{type:'any'}` or `{type:'tool', name}`).
  - So the extra pass passes only `resolve_date` and `choose_visit`, sets `tool_choice: any` on step 0, and `{type:'tool', name:'choose_visit'}` from step 1 if it has not been called. This matches the original's `prepareStep`.
- **Gap on Ollama.** The Ollama adapter has no `tool_choice`. On Ollama the extra pass can limit the tools to the two, but cannot force a call. The original forced it through the OpenAI-compatible API. See open question 2.
- **Client tools.** A `.client()` tool has no server execute, so the model's call ends the server loop and the browser answers it. `useChat({ connection, tools: clientTools(...) })`, then `addToolResult({ tool, toolCallId, output })`.
- **Auto-resume.** After `addToolResult`, `ChatClient` sends once when every tool call in the last assistant message has a result (`shouldAutoSend`). It is triggered only by a tool result, not after every stream. That is the "once per answer, never in a loop" rule. A unit test holds it, since the original needed its own predicate.
- **Per-send options.** `fetchServerSentEvents(url, async () => ({ headers, body }))` takes an async options function, called on every send. `body` lands in the AG-UI `forwardedProps`. The `useChat` `body` option is deprecated in favour of `forwardedProps`; we use the connection's options function so the token and locale are fresh per send.
- **The `choose_visit` slug pre-check.** The original rejected the call inside a zod `superRefine`. Here a chat middleware's `onBeforeToolCall` answers `{type:'skip', result}` with Strapi's `not_found` message and hint, so the model sees the error and fixes the slug. Phase 4, task 4.4 proves the middleware fires for a client tool before it is handed to the browser. If it does not, the fallback is a server execute wrapper that returns the error, which the plan notes there.

### Where the spec and the packages disagree

1. **`@tanstack/ai-mcp` exists** (0.8.3, June 2026, on MCP SDK v2). The spec says TanStack AI has no MCP client. Ruling in the ledger: keep the spec's own wrapper on `@modelcontextprotocol/sdk` 1.32 for the concierge. Reason: `ai-mcp` turns an `isError` result into a thrown `Error` with flat text, so the `{error:{code,message,hint}}` shape is lost. The chat's `✕ <code>` lines, rule 6 (follow the hint) and the auto hand-off read that shape. The browser also needs SDK 1.x for the Agent view. One MCP library in the project is simpler. See open question 1.
2. **Haiku's dated ID** is not in the adapter's model list (above).
3. **`body` on `useChat` is deprecated** (above).
4. **Ollama cannot force a tool** (above).

## Phase 1. Scaffold

| Task | Files | Tests and checks |
| --- | --- | --- |
| 1.1 Root workspace | `package.json` (scripts `postinstall`, `dev`, `dev:strapi`, `dev:app`, `setup`, `test`), `.nvmrc` | `npm install` at the root installs `strapi/` and `app/` |
| 1.2 `scripts/init-env.mjs` | `scripts/init-env.mjs`, `scripts/init-env.test.mjs`, `strapi/.env.example`, `app/.env.example` | `node --test`: copies the example when `.env` is missing; **merges into an existing `.env`**: adds missing keys, fills empty or `tobemodified` values, never changes or drops a set value; keeps comments and line endings; `chmod 600`; generates Strapi secrets and `DEMO_ADMIN_PASSWORD`; prints names only |
| 1.3 Strapi 5.57 | `strapi/` from `create-strapi-app` 5.57.0 (TypeScript, SQLite, no example data), `config/{server,admin,api,database,middlewares,plugins}.ts`, `config/env/production/*` | Port 1339, host 127.0.0.1, MCP on, CORS `http://localhost:3004` plus `MAISON_APP_ORIGIN`, the original's CORS headers. Check: `npm run develop` answers `/_health` on 1339 |
| 1.4 TanStack Start app | `app/` (Start, Vite, Tailwind v4 via `@tailwindcss/vite`), `app/vite.config.ts`, `app/src/routes/__root.tsx`, `app/src/routes/index.tsx` | Dev on 127.0.0.1:3004. No `StrictMode`. Vitest set up with one passing test. Check: `npm run build` and `tsc --noEmit` pass |
| 1.5 `npm run dev` | root `dev` with `concurrently` | Both servers start; Strapi admin at :1339/admin, app at :3004 |
| 1.6 Ledger | `docs/progress.md` | Phase 1 entry |

## Phase 2. Maison plugin, back end

The plugin lives at `strapi/src/plugins/maison`, built with `@strapi/sdk-plugin`. Port the original's server code file by file, with its unit tests, adapting only what Strapi 5.57 or the new AI library needs.

| Task | Files | Tests and checks |
| --- | --- | --- |
| 2.1 Plugin skeleton and `@strapi/utils` check | `plugins/maison/{package.json,server/src/index.ts,admin/src/index.ts}`, `strapi/scripts/share-strapi-utils.mjs` | First find out whether 5.57 still needs the sharing fix: a document-middleware `ValidationError` through the Content Manager must answer 400, not 500. Keep the fix and its `--check` only if needed. Ruling in the ledger |
| 2.2 Domain rules | `server/src/domain/*` (hours, time, subject and masking, references, fence, validation, knowledge, demo activity, queue, inquiry criteria and replies, question messages, flex message, line push and outcome, tool and http result) | The original's unit tests for each, ported first |
| 2.3 Config | `server/src/config/index.ts` | Validator tests. `aiProvider` becomes `anthropic` or `ollama`; `AI_BASE_URL` is the Ollama host |
| 2.4 Content types and Home page | 10 plugin types, `src/api/home-page`, `starting-text.mjs` | Schema contract tests (enums, no string over 255); starting text test |
| 2.5 Document middleware | `document-middleware.ts` | Validation and after-publish confirmation tests |
| 2.6 Services | catalog, appointments, identity, confirmations, line-confirmations, questions, inquiries, conversations, seed, demo-activity, background | Ported service unit tests with `fake-strapi` |
| 2.7 MCP tools and prompt | `server/src/mcp/*` (13 tools, `send_pending_confirmations`), `register.ts` | `register-mcp` test (order equals `TOOL_NAMES`), tool handler tests. Check `strapi.ai.mcp` API names against 5.57's installed source first |
| 2.8 REST and admin routes, policy, RBAC | `routes/`, `controllers/`, `policies/customer-session.ts`, `rest/`, `bootstrap.ts` (13 actions, cron, error middleware) | Route and controller tests; permissions test lists all 13 |
| 2.9 oauth-mcp-manager | `config/plugins.ts` | `LINE_VERIFY_URL` dropped when `NODE_ENV=production` (unit test on the config function) |
| 2.10 Seed data | `server/seed/` copied from the original (content, knowledge, activity, 18 images, `SOURCES.md`) | Seed and image name match test |
| 2.11 LINE verify mock | `scripts/mock-line-verify.mjs` on 4546 | Ported `node --test` suite |
| 2.12 `npm run setup` | `strapi/scripts/maison-setup.mjs` writing `app/.env` keys `VITE_STRAPI_URL` and `VITE_MAISON_CLIENT_ID` | Ported `node --test` suite. Check: a fresh database ends with an admin, the catalog, the Public grants, two tokens and one OAuth client |
| 2.13 Integration tests | `test/integration/harness.mjs` and the 17 suites (labelling and assistant suites come in phases 5 and 6) | Boot in process on their own SQLite file and `listen(0)`; LINE stand-in on a free port |

Inquiry labelling and the assistant service are stubbed out in phase 2 (labelling marks rows `skipped`) and arrive in phases 5 and 6.

## Phase 3. Customer app, screens

Env names change from `NEXT_PUBLIC_*` to `VITE_*` (Vite inlines only `VITE_*`). Server-only names stay plain: `STRAPI_URL`, `ANTHROPIC_API_KEY`, `OLLAMA_*`.

| Task | Files | Tests and checks |
| --- | --- | --- |
| 3.1 Pure libraries | `app/src/lib/{format,copy,locale,booking,status,line-chat,line-app-url,piece-slug}.ts` | Ported unit tests first |
| 3.2 Sign-in | `lib/{config,liff,session}.ts`, `?demoUser=` | `session.test.ts`, `liff.test.ts` ported |
| 3.3 Browser MCP client | `lib/{mcp,maison}.ts` | `mcp.test.ts`, `mcp.race.test.ts` (401 retry, shared refresh), `maison.test.ts` |
| 3.4 Provider and Query | `components/maison-provider.tsx`, `lib/use-tool.ts` as a TanStack Query hook (`queryKey: [screen, name, args, locale]`, `enabled` once signed in, retry off, records each call once) | Hook unit test with a fake client |
| 3.5 Shell and design | `styles.css` (Tailwind v4 `@theme` tokens, safe areas, component classes), `phone-frame`, `header`, `screen`, `spinner`, notes, fonts via `@fontsource` | Visual check in the browser pane |
| 3.6 Home | `routes/index.tsx`, server function `readHomePage` (both languages, 1000 ms, fallback per language, never cached) | `home-page.test.ts` ported |
| 3.7 Collection, Product, My visits, Visit detail, not-found | `routes/collections.$slug.tsx`, `products.$slug.tsx`, `visits.index.tsx` (`?ref=` via `validateSearch`), `visits.$reference.tsx`, `__root` `notFoundComponent` | Unit tests for any new pure rule |
| 3.8 Booking sheet and form | `components/{booking-sheet,booking-form}.tsx` with TanStack Form | Form rules covered by `booking.test.ts`; e2e below |
| 3.9 Agent view | `agent-view-switch.tsx`, `agent-drawer.tsx` | e2e |
| 3.10 Open in LINE page, LINE chat button | `open-in-line.tsx`, `line-chat.tsx`, `lib/qr-image.ts` | Ported tests |
| 3.11 Playwright | `app/e2e/{maison,api}.spec.ts`, `playwright.config.ts` (baseURL `http://localhost:3004`, 390x844) | All of the original's e2e cases |

## Phase 4. Concierge

| Task | Files | Tests and checks |
| --- | --- | --- |
| 4.1 Prompt, dates, `asksToVisit` | `lib/concierge/{instructions,resolve-date,asks-to-visit}.ts` | Ported tests unchanged in substance |
| 4.2 Model choice | `lib/concierge/model.ts`: `createAnthropicChat('claude-sonnet-5-5', key)` or `createOllamaChat(OLLAMA_MODEL, OLLAMA_BASE_URL)` with `think: false`; `describeModelError` | `model.test.ts` |
| 4.3 MCP tools as server tools | `lib/concierge/mcp-tools.ts`: SDK `Client` with the customer's header and `x-maison-surface: concierge`, `listTools`, each tool as `toolDefinition({ name, description, inputSchema: <JSON Schema> }).server(callTool)` returning the full result shape; drops `request_appointment` and `log_inquiry`; `withConversationLocale`, `withAutoHandOff` | Unit tests against an in-memory MCP server |
| 4.4 Local tools | `resolve_date` (`.server()`, strict zod) and `choose_visit` (`.client()`); the slug pre-check as `onBeforeToolCall` middleware | Test that the middleware fires for a client tool and that a `not_found` reaches the model. Fallback noted in section 0 |
| 4.5 The route | `routes/api/concierge.ts` (server route `POST`): auth, 1 MB, last 20, 1000 characters, `chat()` with `maxIterations(8)`, abort signal, `toServerSentEventsResponse`, the 55 s turn budget, the extra pass through middleware, the merge of its events into one reply, `log_inquiry` once per customer message with 5 s timeout | `concierge.test.ts` with a scripted fake adapter |
| 4.6 Chat UI | `routes/concierge.tsx`, `components/{chat-parts,visit-picker}.tsx`, `lib/{tool-view,message-layout,chat-text,chat-retry,visit-picker}.ts` | Ported unit tests; auto-resume once per answer test |
| 4.7 Live tests | `app/live/concierge.live.test.ts` | Run by hand with Paul: Ginza Saturday 14:00 picker, care answer from knowledge, bitcoin hand-off |

## Phase 5. Staff admin

| Task | Files | Tests and checks |
| --- | --- | --- |
| 5.1 Maison page | `admin/src/pages/MaisonPage.tsx`, tabs, Requests board, Questions with Answer dialog, Inquiries with Reply, Close, Change label, Label again, Demo data block | Ported jsdom tests |
| 5.2 Homepage widgets | requests and inquiries widgets | Ported tests |
| 5.3 Inquiry labelling on TanStack AI | `server/src/ai/{sdk,provider}.ts` (the one cached dynamic `import()`), `services/labelling.ts` with `chat({ outputSchema })`, Haiku 4.5 or Ollama | Ported labelling tests with a fake adapter; `stopFor` rewritten for the new error shapes; integration suite with a fake adapter; live test by hand |
| 5.4 LINE stand-in | `scripts/line-stand-in.mjs` on 4011 | Ported `node --test`; by-hand confirm with a demo customer |

## Phase 6. Staff assistant drawer

| Task | Files | Tests and checks |
| --- | --- | --- |
| 6.1 Check Strapi 5.57's menu | Read 5.57's `MainNavLinks` and `LeftMenu` | Ruling: does it still re-create the icon on each location change |
| 6.2 Server | `server/src/assistant/*`, `services/assistant.ts`, `controllers/assistant.ts`, conversations | Ported tests: tools by permission, views, fencing, instructions, error texts, stream wrapper, 90 s deadline, SSE byte compatibility |
| 6.3 Admin | `admin/src/components/assistant/*`, host, menu icon owner | Ported jsdom tests |
| 6.4 ESM guard | `scripts/check-esm-import.mjs` after build; `assistant-sdk-imports` test | Build check |

## Phase 7. LINE mode

Proxy server routes (`/mcp`, the token endpoint, `/uploads/$`), closed unless the build has `VITE_LIFF_MOCK=false`; `X-Maison-Liff` header from a Start request middleware; `scripts/{line-mode,line-tunnel}.mjs`, `app/scripts/line-qr.mjs`, `check-strapi-proxy.mjs`; `docs/line-setup.md`. All with ported tests.

## Phase 8. Docs and final review

README, `docs/{architecture,testing,production}.md` with deployment notes (deploy nothing), one whole-project review on the most capable model, one fix round.

## Decisions Paul made

1. 10 October: the concierge uses our own MCP wrapper on `@modelcontextprotocol/sdk` (option A). Strapi always uses its native MCP server.
2. 10 October: the extra pass runs on Ollama too, with only the two tools offered.
3. 10 October: the section 11 defaults stay. Each phase is merged into `main` when it ends.
