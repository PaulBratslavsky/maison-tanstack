# Maison on TanStack: the spec

Written 9 October 2026 for Paul Bratslavsky. This is a new, separate project. It rebuilds the Maison demo (`~/work/maison-demo`) with TanStack Start for the customer app and TanStack AI for every model call, in the app and in Strapi.

## 1. What Maison is

Maison is a demo for a fictional luxury house of trunks, bags and small gifts. It shows one idea: from UX to AX. The screens a customer taps (UX) and an agent that acts for the signed-in customer (AX) use the same tools.

- **Customers** use a LINE app (a LIFF app). They browse the catalog, ask a concierge for a gift, and request a boutique visit.
- **The concierge** is a model that finds pieces with the same MCP tools the screens use. When a customer wants to visit, it fills in the Book a visit form in the chat. The customer books with one tap.
- **Staff** work in the Strapi admin. They confirm visit requests, answer questions the concierge handed over, and read every concierge turn, labelled by Claude Haiku. A staff assistant drawer answers questions about all of this.
- **Strapi sends the confirmation on LINE** when staff confirm a visit.
- **Everything goes through one Strapi plugin, Maison.** Its MCP tools, REST API and admin routes call the same services.

The demo runs on one laptop in local mode: LINE sign-in is simulated with LINE's LIFF mock and a local stand-in for LINE's ID token verify endpoint.

## 2. The goal of this rebuild

1. **Same product, feature for feature.** A customer, a staff member or an audience at a talk should see the same Maison. Section 6 lists what must match.
2. **TanStack on the front end.** The customer app is TanStack Start (React, Vite) with TanStack Router, TanStack Query and TanStack Form. No Next.js.
3. **TanStack AI everywhere a model is called.** The concierge (app server and browser), the staff assistant drawer (Strapi server and admin), and inquiry labelling (Strapi server). No Vercel AI SDK (`ai`, `@ai-sdk/*`) anywhere in the project.
4. **Strapi stays the back end.** Strapi 5, a fresh project, with a fresh Maison plugin. Its MCP server and its customer sign-in (strapi-oauth-mcp-manager) work as in the original.
5. **A clean example.** This repository should read well as a reference for "Strapi + TanStack Start + TanStack AI + MCP". Code is plain and commented in plain words.

## 3. Sources

| Source | Use it for |
| --- | --- |
| `~/work/maison-demo` (branch `feat/maison-staff-chat`) | The original, read only. Read its code for any behaviour this spec does not spell out. You may port code from it and adapt it. Never change that repository, and never import from it at run time. |
| `docs/reference/maison-demo-app-inventory.md` | Every screen, the LINE flow, the MCP client, every tool's arguments and result, the concierge's rules and picker flow, the design, the tests. |
| `docs/reference/maison-demo-strapi-inventory.md` | Every content type, service rule, MCP tool, route, admin screen, the labelling, LINE messaging, the staff chat, the seed data and the setup script. |
| `~/work/maison-demo/docs/superpowers/specs/2026-10-06-maison-staff-chat-design.md` | The staff chat's design. Its last two sections ("The Ask tab rebuild" and "The chat drawer and a compact page header", amended 9 October) are what shipped. |
| `~/work/maison-demo/strapi/src/plugins/maison/README.md` | The plugin's full reference. |

Where the inventories say the docs and the code disagree, the code wins.

## 4. Stack and versions

Check the latest versions with `npm view` when you start, and pin exact versions for every TanStack AI package (the original once got two copies of `@tanstack/ai` from a loose range). Versions seen on 9 October 2026:

| Package | Version |
| --- | --- |
| `@tanstack/react-start`, `@tanstack/react-router` | 1.168.x, 1.170.x |
| `@tanstack/react-query` | 5.104.x |
| `@tanstack/react-form` | latest 1.x |
| `@tanstack/ai` | 0.68.0 |
| `@tanstack/ai-react`, `@tanstack/ai-client` | 0.30.3, 0.39.2 |
| `@tanstack/ai-anthropic` | 0.21.1 |
| `@tanstack/ai-ollama` | latest |
| `@modelcontextprotocol/sdk` | 1.32.x |
| `@strapi/strapi` | 5.57.0 |
| `strapi-oauth-mcp-manager` | latest 1.x |
| `@line/liff`, `@line/liff-mock` | latest |
| Tailwind CSS | v4 |
| Node | 22.12 or later (the original runs Node 24) |

TanStack AI's API changes between minor versions. Read the installed package's types and docs (tanstack.com/ai) before writing code against it. Names confirmed in 0.68.0: server `chat()`, `toolDefinition()` with `.server()` and `.client()`, `toServerSentEventsResponse`, `chatParamsFromRequestBody`, `maxIterations`, structured output through `outputSchema`; client `useChat`, `fetchServerSentEvents`, `clientTools`, `addToolResult`; adapters `createAnthropicChat` and `ollamaText`/`createOllamaChat`.

TanStack AI has no MCP client package. Use `@modelcontextprotocol/sdk` (`Client` and `StreamableHTTPClientTransport`) and turn each Strapi tool into a TanStack AI server tool.

## 5. Repository layout and ports

```
maison-tanstack/
  app/        TanStack Start customer app
  strapi/     Strapi 5 project, with src/plugins/maison
  scripts/    init-env, setup, line-mode, tunnel, QR, LINE stand-in, verify mock
  docs/       this spec, the reference inventories, the plan, how-to pages
  package.json  root scripts: install both halves, dev, setup, test
```

Ports are new, so this project runs beside `maison-demo` (which uses 1338, 3003, 4545 and 4010) and beside any Strapi on 1337:

| Process | Port |
| --- | --- |
| Strapi | 1339 |
| The app | 3004 |
| LINE verify mock | 4546 |
| LINE Messaging API stand-in | 4011 |

Strapi's CORS allows `http://localhost:3004` plus `MAISON_APP_ORIGIN`. Everything listens on 127.0.0.1 only.

## 6. What must match the original

Build each item to the behaviour described in the inventories. This list is the checklist, not the detail.

### 6.1 Strapi and the Maison plugin

- **Content types** (strapi inventory section 2): collection, product, boutique, stock-level, appointment (a draft is a request, a published version is confirmed), notification, knowledge, question, inquiry, conversation (saved staff chats), and the app's localized `home-page` single type with its starting text.
- **i18n:** `ja` and `en`, plugin default `ja`.
- **Document middleware:** validation on create and update; the LINE confirmation after an appointment is published.
- **Services and rules** (section 3): catalog, opening hours, booking rules (30 minutes ahead at least, 3 open requests per customer, 5 open questions), who may book, LINE user ID masking, appointment states, confirmations, questions, inquiries with their queues, demo customers and "Your LINE" rows, seed and demo reset.
- **The 13 MCP tools and the prompt** (section 4), registered in `register()` through `strapi.ai.mcp`, each gated by a plugin permission. Customer, staff and ops tools. Result and error shapes exactly as in the original (`structuredContent`, and `{error:{code,message,hint}}` with `isError`).
- **REST routes** `/api/maison/...` and **admin routes** `/maison/...` (section 5).
- **The 13 RBAC actions** (section 6), including "Use the Maison assistant".
- **The Maison admin page** with the compact header and three tabs: Requests board, Questions, Inquiries. Reply on LINE, Answer, Confirm, Label again, Close. Homepage widgets. Reset demo activity.
- **strapi-oauth-mcp-manager** configured for LINE sign-in, with the local verify URL in local mode only, never in production.
- **The `@strapi/utils` sharing fix** if the plugin still needs it on Strapi 5.57 (check: does Content Manager validation answer 400 or 500 without it?).

### 6.2 The customer app

- **Screens** (app inventory section 1): Home (server-loaded Home page text in both languages, with the built-in fallback), Collection, Product with the Book a visit sheet, My visits (with `?ref=`), Visit detail, Concierge (with `?product=`). Unknown paths get a plain not-found screen (the original had none).
- **The shell:** the phone frame on the stage laptop, the header with EN/JA, the quiet tools line, the Agent view switch and drawer, LINE safe areas, LINE's spinner.
- **LINE sign-in:** LIFF mock in local mode (with `?demoUser=`), real LIFF in LINE mode, the "Open in LINE" page outside LINE, the RFC 8693 token exchange, the session kept in memory and renewed on 401.
- **MCP from the browser:** the screens call Strapi's `/mcp` directly with the customer's session, and every call is recorded for the Agent view. This is the "UX" half of the talk, so keep it in the browser.
- **The concierge**, section 7.
- **LINE mode support:** the three proxy routes (`/mcp`, the token endpoint, `/uploads/*`), closed unless the build is a LINE build, with the same header and body allow lists; the `X-Maison-Liff` header; the tunnel, QR and stand-in scripts.
- **Copy** in English and Japanese, error copy by code, Tokyo-calendar dates everywhere.
- **Design:** black and white, no rounding, no shadows, Jost and Zen Kaku Gothic New self-hosted, the colour and type tokens in app inventory section 7.

### 6.3 The staff assistant drawer

As shipped in the original (strapi inventory section 9): the launcher on every admin page, the drawer at 600px or 960px, History adding 260px, capped at 90vw, the seven read-only tools, Markdown answers with safe links and no images, tool boxes, quick questions, saved chats per admin, the error texts, the setup notice. The chat lives in a host with its own React root, not inside the menu icon (the original's spec explains why). Check that Strapi 5.57 still draws menu icons the same way before you port the host.

## 7. The concierge on TanStack AI

The rules, limits and flows stay as in app inventory section 4. Only the library changes.

- **Server:** a TanStack Start server route, `POST /api/concierge`.
  - It needs the customer's `Authorization: Bearer mcp_at_...`, else 401. Same body limits: 1 MB body, the last 20 messages, 1000 characters per user message.
  - It opens an MCP client to Strapi with the customer's own header and `x-maison-surface: concierge`, lists the tools, and wraps each one as a TanStack AI server tool (`toolDefinition` with the tool's JSON Schema, `.server()` calling `client.callTool`). It leaves out `request_appointment` and `log_inquiry`.
  - Keep the original's wrappers: fill in the conversation's `locale` when the model leaves it out, and the automatic hand-off to staff when a knowledge search comes back empty.
  - `resolve_date` is a local server tool with a strict schema.
  - `choose_visit` is a **client tool** (`toolDefinition(...).client()`): it has no server execute, so the model's call ends the step and the browser answers it. The server pre-checks its product slugs with `find_boutiques`, as the original does.
  - `chat()` with the system prompt built per request (the calendar, the ten rules, the piece paragraph), `maxIterations(8)`, the request's abort signal, and `toServerSentEventsResponse`. Give the route 60 seconds.
  - After the turn, the server calls `log_inquiry` once per customer message, never per resume, with a 5 second timeout.
  - The "extra pass" safety net (a second call forced to `choose_visit` when the customer asked to visit and the model did not show the picker) stays. Port `asksToVisit` and its tests as they are. Find the TanStack AI way to force a tool choice and to limit active tools; if it has none, say so in the plan and ask Paul.
- **Models:**
  - `ANTHROPIC_API_KEY` set: Claude Sonnet 5.5 (`claude-sonnet-5-5`) through `@tanstack/ai-anthropic`.
  - No key: Ollama through `@tanstack/ai-ollama`, `OLLAMA_MODEL` (default `qwen3-14b-32k`) at `OLLAMA_BASE_URL`, with thinking turned off.
  - The original also had Vercel AI Gateway. Leave it out (no TanStack adapter); note it in the README.
- **Browser:** `useChat` from `@tanstack/ai-react` with `fetchServerSentEvents('/api/concierge', ...)`. The options send a fresh session token and the `locale` and `product` at send time.
  - `choose_visit` runs through `clientTools`. Its answer comes from the Book a visit form, not from code: Send request calls `request_appointment` over MCP from the browser with the customer's session, then answers the tool with `{status:'requested', appointment}`. Not now answers `{status:'closed'}`. Then the chat continues once per answer, never in a loop.
  - Render text, tool lines (`MCP · name ✓ 5 results`, `Local · choose_visit ✓ requested`), product cards, the visit picker, booking cards, hand-off notes and the empty-reply Try again, in the order the original uses.
- **Live tests** against a running Strapi, as in the original: the demo's first suggestion ends in a picker for Ginza, next Saturday, 14:00; a care question is answered from knowledge; "Can I pay in bitcoin?" is handed to staff.

## 8. TanStack AI in Strapi

- **Staff assistant:** port the original's server (`chat()`, the stream wrapper, the error texts, the 90 second deadline, the seven tools, the instructions) and admin side (`useChat`, `fetchServerSentEvents`, the drawer) to the current TanStack AI versions. The plugin server is CommonJS and TanStack AI is ESM only: keep one file that loads it with a cached dynamic `import()`, and the build check that no bundle loads it statically.
- **Inquiry labelling:** replace the AI SDK's `generateObject` with TanStack AI structured output (`chat()` with `outputSchema`, Claude Haiku 4.5, `claude-haiku-4-5-20251001`). Keep the prompt, the label schema, the fences, the per-minute sweep, the retry and failure rules, `PROMPT_VERSION` and `modelVersion`.
- **Providers:** Anthropic for both, with `AI_API_KEY`. The original also allowed OpenAI and any OpenAI-compatible server for labelling; replace those with Ollama through `@tanstack/ai-ollama`, for local use without a key.

## 9. Tests

Match the original's coverage, with the same tools:

- **Plugin:** Vitest unit tests (with jsdom and Testing Library for the admin), and integration tests that boot Strapi in process on their own SQLite database and `listen(0)`, so they never touch the dev server. No test calls Anthropic or LINE.
- **App:** Vitest unit tests for every rule in `lib/`, Playwright end-to-end tests against local mode (booking, language, Agent view, second customer, safe areas, the REST and MCP privacy checks), and the concierge live tests (run by hand).
- **Scripts:** `node --test` suites for setup, line-mode, tunnel, stand-in, verify mock and QR.
- Write each test first and see it fail before the code that makes it pass.

## 10. Phases

Each phase ends with every check green, a commit, and a short note to Paul.

1. **Scaffold.** Root workspace, `strapi/` (Strapi 5.57, SQLite, port 1339), `app/` (TanStack Start, Tailwind v4, port 3004), `scripts/init-env.mjs`, `.env.example` files, `npm install` that installs both, `npm run dev`.
2. **Maison plugin, back end.** Content types, middleware, services, seed data and images (copy them from the original's `server/seed/`), the 13 MCP tools and the prompt, REST and admin routes, RBAC actions, oauth-mcp-manager, `npm run setup`, the LINE verify mock. Integration tests.
3. **Customer app, screens.** LIFF mock and session, the browser MCP client with TanStack Query, every screen, the booking sheet with TanStack Form, Agent view, EN/JA, design tokens. Unit and Playwright tests.
4. **Concierge.** Section 7. Unit tests, then live tests with Paul.
5. **Staff admin.** The Maison page, confirmations over LINE with the stand-in, inquiry labelling on TanStack AI, Homepage widgets, Reset demo activity.
6. **Staff assistant drawer.** Section 6.3 and section 8.
7. **LINE mode.** Proxy routes, line-mode, tunnel, QR, stand-in, the "Open in LINE" page, and the docs for running with real LINE.
8. **Docs and a final review.** README, how-to pages, a final whole-project review on the most capable model, one fix round.

Deployment (Vercel for the app, Strapi Cloud for Strapi) is not part of this work. Write the deployment notes, but deploy nothing without Paul.

## 11. Decisions Paul can change

- New ports (section 5), so both projects run at once.
- Claude Sonnet 5.5 for the concierge, where the original used Sonnet 5.
- No Vercel AI Gateway; Ollama in place of OpenAI and OpenAI-compatible labelling.
- TanStack Form for the booking form, and TanStack Query for screen data.
- Tailwind v4, where the original used v3.
- A not-found screen for unknown paths.
