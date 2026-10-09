# Maison customer app (`liff/`): functional inventory for a TanStack Start rebuild

Repo `/Users/paul/work/maison-demo`, branch `feat/maison-staff-chat`. I read everything under `liff/` and the docs and scripts you listed. I also read the plugin files `strapi/src/plugins/maison/server/src/mcp/schemas.ts`, `strapi/src/plugins/maison/server/src/mcp/tools/*.ts`, `strapi/config/plugins.ts` and `strapi/config/middlewares.ts`, plus the Home page schema, to get the MCP argument and result shapes. No `.env` value was read or printed. For `liff/.env.example` I looked at names only, with values masked. For the root `.env.cloud` I listed names only.

Paths below are relative to `/Users/paul/work/maison-demo/liff/` unless they start with `/` or `docs/`, `scripts/` or `strapi/`. These are repo-root paths.

---

## 0. Big picture and stack

- **What it is.** The customer-facing app of "Maison", a fictional luxury house of trunks, bags and small gifts. It is a LIFF app: a web app that runs inside the LINE app.
- **Backend.** It has no database. All data comes from Strapi's MCP server at `POST {STRAPI}/mcp` (Strapi 5, local plugin "maison" in `strapi/src/plugins/maison`).
- **One REST read.** The Home page text is the only REST call (`/api/home-page`, server side).
- **Auth.** Sign-in is the LINE ID token exchanged for a short-lived Strapi session. The exchange is done by the `strapi-oauth-mcp-manager` plugin (RFC 8693 token exchange).
- **Concierge.** An AI chat is the one piece of real server logic in the app. It runs on the app's own server through the Vercel AI SDK, calls the same MCP tools as the customer, and has two app-local tools.
- **Current stack** (`package.json`):
  - `next ^16.3.1`, `react ^19.2.8`, `tailwindcss ^3.4.1` (v3, not v4), `typescript ^5.9.3`
  - `ai ^7.0.124`, `@ai-sdk/react ^4.0.127`, `@ai-sdk/mcp ^2.0.64`, `@ai-sdk/anthropic ^4.0.70`, `@ai-sdk/openai-compatible ^3.0.61`
  - `@modelcontextprotocol/sdk ^1.31.0`
  - `@line/liff ^2.31.1`, `@line/liff-mock ^1.0.4`
  - `zod ^4.1.8`, `qrcode ^1.5.4`
  - `@fontsource/jost`, `@fontsource/zen-kaku-gothic-new`, `@fontsource/cormorant-garamond` (the last is installed but unused)
  - Dev: `vitest ^3.2.4`, `@playwright/test ^1.63.0`
  - Node >= 22.12.
- **Next.js features actually used** (this is what TanStack Start has to replace):
  - App Router client pages, with `useParams`, `useSearchParams` and `next/link`.
  - One server component, Home, which uses `connection()` from `next/server` and `import 'server-only'`.
  - Route handlers (`app/api/concierge`, `app/mcp`, `app/uploads`, `app/api/strapi-oauth-mcp-manager/oauth/token`).
  - `export const maxDuration = 60`.
  - `next.config.mjs` `headers()` to add `X-Maison-Liff`.
  - Turbopack root pin.
  - There is no `next/image` (plain `<img>`), no middleware, no `not-found.tsx` or `error.tsx`, and no service worker.
  - `reactStrictMode: false`, deliberately, because strict mode would record every tool call twice in the agent view.
- **Monorepo scripts** (root `package.json`):
  - `postinstall`: installs `strapi/` and `liff/`, then runs `scripts/init-env.mjs`.
  - `dev`: `node scripts/line-mode.mjs require-local && concurrently strapi + liff`.
  - `dev:strapi`, `dev:app`, `setup`, `mode`, `mode:line`, `mode:local`, `start:line`, `tunnel`, `qr`, `line:stand-in`.
  - `test`: liff vitest, plugin tests, the `@strapi/utils` check, and `node --test` for the scripts.
  - `test:e2e`, `test:live`.
- **`liff/package.json` scripts:**
  - `dev`: `concurrently "next dev -H 127.0.0.1 -p 3003" "node --env-file-if-exists=.env scripts/mock-line-verify.mjs"`.
  - `start`: the same with `next start`.
  - `build`: `next build`.
  - `start:line`: `node ../scripts/line-mode.mjs require-line && next build && next start -H 127.0.0.1 -p 3003`.
  - `typecheck`, `typecheck:e2e`, `test` (`vitest run`).
  - `test:live`: `node --env-file=../strapi/.env --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.live.config.ts`.
  - `test:e2e`: `node --env-file=../strapi/.env --env-file=.env node_modules/@playwright/test/cli.js test`.
- **Ports.** App on `127.0.0.1:3003`, Strapi on `1338`, verify mock on `4545`, LINE stand-in on `4010`. Strapi's CORS allows only `http://localhost:3003` plus `MAISON_APP_ORIGIN`, so the app must be opened as `localhost`, not `127.0.0.1`.
- **`liff/AGENTS.md` and `liff/CLAUDE.md`** are only the Next.js agent-rules banner. They contain no product information.

---

## 1. Screens and routes

### 1.1 Shell shared by every screen

**Root layout** (`app/layout.tsx`)
- Sets `<html lang="ja">`. `MaisonProvider` then sets `document.documentElement.lang` to the active locale after first paint.
- Imports fontsource CSS: Jost 300/400/500 and Zen Kaku Gothic New 300/400/500.
- Title "Maison". Viewport is `width=device-width, initialScale=1`.
- Wraps children as `<PhoneFrame><MaisonProvider>{children}</MaisonProvider></PhoneFrame>`.

**PhoneFrame** (`components/phone-frame.tsx`)
- On phones the app is full screen.
- On the "stage" laptop (media query `(min-width:500px) and (hover:hover) and (pointer:fine)`) it sits in a 375 px wide frame:
  - a 6 px ink outline, no rounding, height `min(812px, 100dvh - 4rem)`;
  - on a neutral `wash` page background.
- The inner div has `data-testid="app-area"` and is padded by `--line-safe-x` and `--line-safe-bottom` (see section 7).

**MaisonProvider** (`components/maison-provider.tsx`) is a React context exposing:
- `status`: `'starting' | 'ready' | 'error' | 'open-in-line'`
- `maison`, `signInError`, `errorCode`
- `friendFlag`
- `openInLine`: `{url, os}`
- `locale`
- `calls`: tool-call records, last 50
- `agentView`, `setAgentView`, `setLocale`, `retrySignIn`

How it behaves:
- On mount it calls `getMaison()`, which does LIFF init, the token exchange and the MCP connection (section 2). It then asks `friendFlag()` once.
- An `OpenInLineError` sets `open-in-line`. Any other error is a sign-in failure with a Try again button.
- It subscribes to every MCP call record via `onToolCall` and keeps the last 50.
- The agent view toggle is read from `localStorage['maison.agentView']` (`'on'`/`'off'`) after first render, so SSR and the first client render match.
- The locale override is read from `localStorage['maison.locale']` the same way.

**Screen wrapper** (`components/screen.tsx`). Every page renders `<Screen name tools [title] [fill] [back] [bar]>`.
- It renders the Header.
- Under the header, a quiet line with the screen's MCP tool names on the left (`MCP · browse_collections · …`) and the Agent view switch on the right.
- The Concierge uses a `title` bar instead, with an "N MCP tools" button (see 1.8).
- It shows a Spinner "Signing in with LINE…" while starting.
- It shows an ErrorNote "Sign-in failed: …" with Try again on error.
- It shows the OpenInLine page in place of the content when status is `open-in-line`. In that case there is no tools line and no agent view.
- On `ready` it renders children, an optional pinned bottom `bar` (the product's Book a visit button), and the AgentDrawer.
- With the drawer open, page padding and the bar position are offset by the drawer's measured height (ResizeObserver).

**Header** (`components/header.tsx`): 56 px, sticky, with three columns.
- Left: "My visits" on Home. Elsewhere "‹ <parent>". The parent is Home by default, My visits for `/visits/*`, or the collection for a product (`back` prop).
- Centre: the wordmark "MAISON", a link to Home.
- Right: the EN/JA buttons. Each is a `button aria-pressed`; the active one is weight 500 and underlined, the other is mist grey.

### 1.2 Routes table

| Route | File | Kind | MCP tools called (`screen` name for the agent view) |
|---|---|---|---|
| `/` | `app/page.tsx` + `components/home-screen.tsx` | Server component wrapper + client screen | `browse_collections` (`home`). Server side: REST `GET {STRAPI_URL}/api/home-page?locale=en` and `?locale=ja` |
| `/collections/[slug]` | `app/collections/[slug]/page.tsx` | Client | `browse_collections`, `search_products` (`collection`) |
| `/products/[slug]` | `app/products/[slug]/page.tsx` | Client | `view_product` (`product`); sheet: `find_boutiques`, `request_appointment` (`product`) |
| `/visits` (`?ref=APT-1234`) | `app/visits/page.tsx` | Client in `<Suspense>` | `my_appointments` (`visits`) |
| `/visits/[reference]` | `app/visits/[reference]/page.tsx` | Client | `my_appointments` (`visits`), filtered client-side by reference |
| `/concierge` (`?product=<slug>`) | `app/concierge/page.tsx` | Client; `searchParams` read with React `use()` | Browser: none at mount. Per picker (`concierge`): `view_product`, `find_boutiques`, `request_appointment`. Server: see section 4 |
| `POST /api/concierge` | `app/api/concierge/route.ts` | Route handler, `maxDuration = 60` | AI SDK MCP client (section 4) |
| `/mcp` (GET, POST, DELETE) | `app/mcp/route.ts` | Proxy, LINE build only | Passes through to Strapi `/mcp` |
| `/api/strapi-oauth-mcp-manager/oauth/token` (POST) | `app/api/.../token/route.ts` | Proxy, LINE build only | Passes through |
| `/uploads/*` (GET, HEAD) | `app/uploads/[...path]/route.ts` | Proxy, LINE build only | Passes through catalog images |

Slug handling: `/collections/Voyage` and `/products/Weekender-50` are lower-cased before use.

### 1.3 Home (`/`)

- **Server.** `readHomePage()` (`lib/home-page.ts`) is called per request. `await connection()` stops Next from prerendering it at build time.
  - It fetches `{strapiOrigin()}/api/home-page?locale=<en|ja>` for both languages in parallel, with `cache:'no-store'` and a 1000 ms timeout each.
  - It uses the server-side `STRAPI_URL`, never `NEXT_PUBLIC_STRAPI_URL`.
  - The Strapi content type is a localized, draft-and-publish single type `api::home-page.home-page` with these fields:
    - `eyebrow` (string, required, max 80)
    - `headline` (string, required, max 140)
    - `intro` (text, optional, max 400)
    - `ctaLabel` (string, required, max 40)
  - Fallback is per language. If the response is not 200, the request fails or times out, or eyebrow/headline/ctaLabel is missing or blank, that language uses the built-in text from `COPY[locale].home` with `intro: null`, and a `console.warn` is logged. A blank intro just means there is none.
  - Both languages are passed to the client, so the EN/JA switch is instant.
  - The Public role needs `find` on the Home page for this call.
- **Client.** `HomeScreen`:
  - eyebrow (uppercase graphite), h1 headline (31 px, weight 300), optional intro (`whitespace-pre-line`), and a primary button linking to `/concierge` labelled `ctaLabel`.
  - Then a "Collections" label with a total piece count.
  - Then, for each collection from `browse_collections`, a full-width 240 px photo band. Below it: the collection name (13 px, medium, 0.24em tracking, uppercase) on the left and "N pieces" on the right.
  - The first photo has `loading=eager`, the rest `lazy`.
  - Each card links to `/collections/<slug>` (`data-testid="collection-card"`).
- **Built-in Home text** (`lib/copy.ts`):
  - EN: "Gifts, chosen with care" / "Find the right piece. See it in person." / "Ask the concierge".
  - JA: 心を込めて選ぶ、贈り物 / ふさわしい一品を。店頭で、お手に取って。 / コンシェルジュに相談する.

### 1.4 Collection (`/collections/[slug]`)

- Calls `browse_collections {locale}` and `search_products {collection: slug, locale, limit: 20}`.
- The h1 is the collection name and the teaser sits under it. The h1 keeps a 36 px min-height while loading to avoid layout shift.
- A 2-column square-photo grid (`ProductGrid`, `data-testid="product-card"`): each shows name (13 px) and price (12 px, graphite). The first 4 images are eager.
- Empty list: "Nothing in this collection yet." / このコレクションには、まだ商品がありません。
- Errors go through `StatusNote`:
  - `not_found` or `invalid_input` from the URL leads to a "Back to the start" link, not a retry.
  - Otherwise there is a Try again button.
  - If only `browse_collections` failed, the note is shown where the name goes.
  - A combined retry re-runs both calls.

### 1.5 Product (`/products/[slug]`)

- Calls `view_product {slug, locale}`.
- Layout:
  - full-bleed square photo (`images[0]`);
  - eyebrow with the collection name;
  - h1 name (24 px) and price on one line;
  - description (`whitespace-pre-line`) and `craftStory`;
  - a hairline details list with Size (`W × H × D cm`), Personalization (kinds translated, plus " · About N days" lead time) and In stock (boutique names with quantity > 0, or "Out of stock");
  - a secondary button "Ask about this piece" linking to `/concierge?product=<slug>` (`data-testid="ask-about-piece"`).
- A primary "Book a visit" button is pinned to the bottom via `Screen.bar`. It opens the BookingSheet (1.9).
- The header back link is "‹ <collection name>" to `/collections/<slug>`.

### 1.6 My visits (`/visits`)

- Calls `my_appointments {locale}`. The page is wrapped in `<Suspense>` because it reads `useSearchParams`, with a prerendered shell that includes the header, tools line and a spinner. LINE's confirmation link opens this route.
- h1 "My visits" / ご来店予約.
- If `?ref=` matches a visit that is still `requested`, it shows "Request sent. The boutique will confirm on LINE." with a left rule, and a LineChat button. The matching row gets the `wash` background.
- Each row (`data-testid="visit"`) links to `/visits/<ref>` and shows:
  - boutique name plus a StatusTag;
  - the visit time formatted in Asia/Tokyo ("Sat 10 Oct, 14:00" or "10月10日(土) 14:00");
  - the reference in mono (`APT-1234`).
- Empty: "No visits yet."
- Otherwise a LineChat block with the line "Your confirmation arrives in the Maison chat.".

### 1.7 Visit detail (`/visits/[reference]`)

- Calls `my_appointments {locale}` and finds the visit by reference. There is no per-visit tool.
- Shows the reference (mono), the boutique as headline, the time, a StatusTag, a details list (Pieces, and Note if present) and a LineChat button.
- Not found: "We couldn't find this visit."
- Status tag:
  - outlined ink "Awaiting the boutique" when `requested`;
  - filled ink "Confirmed" when `confirmed`;
  - plus a small check and "LINE sent" when `confirmationSent`.

### 1.8 Concierge (`/concierge`)

Full details are in section 4. Layout:
- **Title bar:** h1 "Concierge" and a button "8 MCP tools" (`mcpTools(8)`; the names are the eight customer tools). It opens a panel listing the tools plus the Agent view switch. The panel closes on the button, on Escape and on an outside tap.
- **Conversation:** a scroll area.
  - Intro line, or the piece intro when `?product=` is set.
  - User messages are black blocks, right aligned, max width 78%.
  - Assistant messages are plain text with mono tool lines and cards.
- **Bottom bar (pinned):**
  - suggestion chips (hidden on a phone in landscape once the chat has begun);
  - an underline text input (`maxLength` 1000) and a black Send button.
- **Landscape rule:** on a phone in landscape (`short` screen) the suggestion row is hidden once there are messages.

### 1.9 Booking sheet and Book a visit form (shared by product page and concierge picker)

`components/booking-sheet.tsx` is a bottom-sheet dialog. `components/booking-form.tsx` is the form, shared with the concierge's visit picker.

**Sheet**
- `role="dialog" aria-modal`, backdrop `bg-ink/45`.
- Closes on Escape, on the X button and on a backdrop click (pointerdown and click both on the backdrop). Escape is ignored while an IME is composing (`isComposing` or `keyCode 229`).
- Focus moves to the heading on open.
- A 4 px grab handle, the only rounded element in the design.
- Heading "Book a visit" with the product name and price.
- Defaults come from `defaultVisit()`: Ginza, the next Saturday at least 2 days away, at 14:00.
- After success it calls `router.push('/visits?ref=<reference>')`.

**Form fields**
- **Boutique:** a radio fieldset, one radio per boutique returned by `find_boutiques`. A boutique with none of the pieces in stock is disabled and shows "· not in stock". The chosen boutique is the picked one if it has stock, else the first boutique that has stock.
- **Date chips:** a radiogroup of the next 14 days starting tomorrow, on Tokyo's calendar. Each chip is 72 px wide, labelled "Sat 10" or "10日(土)". The row scrolls horizontally, with arrow/Home/End keyboard handling.
- **Time chips:** half-hour slots from open until 30 minutes before close, for the chosen boutique on the chosen day (from `hoursOnDate`). If the chosen time is not offered, the first slot is used.
- **Note:** a textarea, `maxLength` 500, rows 1, auto-growing (`field-sizing: content`). Placeholder "Who is it for? (optional)". The note is sent trimmed, and only if non-empty.
- **Send request:** a primary button. While sending it stays black and shows LINE's light spinner (16 px) and "Loading…". It is disabled when no start time is available or the form is `disabled`.
- **Not now** (picker only) is a secondary button.
- Caption under the buttons: "The boutique confirms your visit on LINE."

**Data and states**
- It calls `find_boutiques {productSlugs: [..], date, locale}` whenever the date is bookable. Any tool error shows an ErrorNote with Try again.
- A closed boutique on the chosen day shows "Closed on this day. Please pick another." (`closedOnDate`).
- A date that is today or in the past (for example Tokyo midnight passed with the sheet open) shows "Please choose a date from tomorrow on." and nothing is sent. `useToday()` re-checks Tokyo's date every 30 seconds.
- Send request calls `request_appointment` (`lib/booking.ts` `requestVisit`, `visitArguments`) with:

```
{ boutique: <slug>,
  productSlugs: [..],
  requestedFor: "YYYY-MM-DDTHH:MM:00+09:00",
  note?: <trimmed>,
  locale }
```

- A refusal stays in the form as an ErrorNote. `boutique_closed` is rewritten to "<boutique name> is closed at that time." in the customer's language.

### 1.10 Agent view

- **What it is.** A toggle ("Agent view" / エージェントビュー) that exposes the real MCP calls behind each screen.
- **Where the switch is:**
  - on every normal screen, in the quiet line under the header (`components/agent-view-switch.tsx`, `role="switch"`, `aria-checked`);
  - on the concierge, inside the "N MCP tools" panel.
- **State.** Stored in `localStorage['maison.agentView']`.
- **Drawer** (`components/agent-drawer.tsx`): a fixed bottom panel, `max-h-[45%]`, mono 11 px, white, with a hairline on top.
  - Header line "MCP · Strapi /mcp".
  - Shows the last 6 calls for the current screen, newest first.
  - Each call shows tool name, duration in ms, `JSON.stringify(args)`, and a summary line:
    - `error: <msg>` for a thrown error;
    - `isError: <code>` for a tool error;
    - otherwise `key: <array length>` or `key: {…}` or `key: value` for each top-level key of `structuredContent`.
  - Empty: "No tool calls on this screen yet."
- **Recording** (`lib/mcp.ts` `createMcp` and `lib/maison.ts` `onToolCall`). Each browser MCP call is recorded as `{id, screen, name, args, result, error, ms, at}`. A listener that throws is logged and skipped. The provider keeps the last 50.
- **Screen names are the `screen` strings** passed to `callTool`: `home`, `collection`, `product`, `visits`, `concierge`. The screen name is passed into `useTool(screen, name, args)`.
- **The concierge's own server-side calls are not in the drawer.** Only the browser-side picker calls (`view_product`, `find_boutiques`, `request_appointment` with screen `concierge`) appear there. The chat shows server tool calls as mono lines instead.

### 1.11 `useTool` data hook (`lib/use-tool.ts`)

- `useTool<T>(screen, name, args | null)` calls the tool once signed in, and again when `JSON.stringify(args)` changes (a language switch re-runs everything).
- It returns `{loading, data: structuredContent, error, retry}`.
- A tool error becomes `ScreenError` via `toolErrorOf`. A thrown error becomes one via `errorOf`: `SessionError` keeps its OAuth code, `TypeError` becomes `network`, anything else becomes `error`.
- `args = null` means wait.

### 1.12 Language switching (EN/JA) and where translations live

- **Header buttons** `EN` and `JA` call `setLocale`, which stores the choice in `localStorage['maison.locale']`.
- **Resolution** (`lib/locale.ts` `resolveLocale`): override from the switch, else the language LINE gave at sign-in (`liff.getAppLanguage()` mapped by `toLocale`, which returns `ja` for any `ja*` and `en` otherwise), else `NEXT_PUBLIC_DEMO_LOCALE` (default `en`). For the "Open in LINE" page, the language comes from LIFF or the browser instead of sign-in.
- **UI strings** are a single static TypeScript object in `lib/copy.ts`: `COPY = { ja: {...}, en: {...} }`.
  - Some entries are functions: `pieces(n)`, `leadDays(n)`, `closedAtTime(boutique)`, `handOff.note(ref)`, `handOff.typed(ref, q)`, `mcpTools(n)`, `results(n)`, `tryAgainIn(seconds)`.
  - Sections: home, collections, visits, status labels, hand-off and LINE chat, concierge intro, suggestions and picker texts, `openInLine`, `personalizationKinds` (slug to text) and `errors` by code.
- **Error copy by code:** `not_found`, `invalid_input`, `boutique_closed`, `in_the_past`, `too_many_open_requests`, `not_signed_in`, `invalid_grant`, `temporarily_unavailable`, `network`, `server_error`, `error`.
  - Unknown codes (including names inherited from `Object`) get the generic `error` copy.
  - The tools' English message and hint are never shown to customers. They show only in the Agent view and in a mock-mode technical line (`ErrorDetail`).
  - When the server names a wait (`Retry-After`), `tryAgainIn` is appended.
- **Catalog and knowledge content** is localized in Strapi. The app passes `locale` to every tool.
- **Number and date formatting** (`lib/format.ts`):
  - `Intl.NumberFormat` for yen. JA uses `ja-JP` JPY. EN uses `en-GB` JPY with `narrowSymbol`, for example `¥385,000`.
  - `Intl.ListFormat`: "A、B、C" or "A, B and C".
  - `dayLabel`: UTC-based, so no time zone shifts the date. `visitTime`: `Asia/Tokyo`, `hourCycle h23`.
  - All "days" are counted on Tokyo's calendar with a fixed +9 h shift: `tokyoDays`, `nextSaturday` (next Saturday at least 2 days away), `tomorrow`, `isRealDate` (guards JavaScriptCore's Invalid Date), `timeSlots`.
  - `mediaUrl`: absolute URLs pass through, relative ones are prefixed with `NEXT_PUBLIC_STRAPI_URL`.
- **System prompt** is built per request in English, with a Japanese tail in rule 4 and a locale instruction in rule 7 (section 4).

### 1.13 Shared UI states

- **Spinner** (`components/spinner.tsx`): LINE's own `/line/LINE_spinner_light.svg` at 30×30 centred, plus a small label. It has `role=status`.
- **StatusNote:** loading shows a spinner. An error shows an ErrorNote with either Try again or "Back to the start".
- **ErrorNote:** a left red rule (`border-l border-error`), `role=alert` or `status`.
- **ErrorDetail:** a graphite mono technical line, shown only when `config.liffMock` is true. `MOCK_FIXES` has suggested fixes for `network` ("Is Strapi running on ...? Open the app at http://localhost:3003, not 127.0.0.1."), `invalid_grant` and `invalid_client`.
- **Details / Detail:** a hairline definition list.
- **LineChat** (`components/line-chat.tsx`): see 2.8.
- **OpenInLine page** (`components/open-in-line.tsx`): see 2.5.

---

## 2. LINE integration

### 2.1 Configuration object (`lib/config.ts`)

All `NEXT_PUBLIC_*` are read by full literal name so the bundler inlines them:
- `strapiUrl`: `NEXT_PUBLIC_STRAPI_URL` (default `http://localhost:1338`, trailing slashes stripped).
- `clientId`: `NEXT_PUBLIC_MAISON_CLIENT_ID`.
- `liffMock`: true unless `NEXT_PUBLIC_LIFF_MOCK === 'false'`.
- `liffId`: `NEXT_PUBLIC_LIFF_ID`.
- `lineOaId`: `NEXT_PUBLIC_LINE_OA_ID`.
- `demoLineUserId`: `NEXT_PUBLIC_DEMO_LINE_USER_ID`, with a hard-coded made-up default LINE user ID in the source (a `U` plus 32 hex digits).
- `demoLocale`: `NEXT_PUBLIC_DEMO_LOCALE`, default `en`.

### 2.2 LIFF init (`lib/liff.ts` `initLiff`)

Runs once per page load. A failure resets `ready`, so Try again starts over. It is browser only, and `@line/liff` is dynamically imported.

**Mock mode** (`NEXT_PUBLIC_LIFF_MOCK !== 'false'`, the default):
- It does `liff.use(new LiffMockPlugin())` and then `liff.init({ liffId: liffId || 'maison-demo', mock: true })`.
- It then calls `liff.$mock.set(prev => ({...prev, isLoggedIn: true, getIDToken: 'valid.<userId>', getAppLanguage: demoLocale, getLanguage: demoLocale}))`. It always uses the function form, because `set()` with a plain object replaces the whole mock store.
- `<userId>` is chosen as follows:
  - `?demoUser=U<32 hex>` on the URL is stored in `sessionStorage['maison.demoUser']` and used. This is how tests and the second-customer check sign in as another customer.
  - Otherwise `NEXT_PUBLIC_DEMO_LINE_USER_ID`, or the built-in default.
- So the ID token is the fake string `valid.<LINE user id>`, which the local verify mock accepts.

**Real LIFF** (`NEXT_PUBLIC_LIFF_MOCK === 'false'`):
- `liff.init({ liffId })`.
- If `!liff.isInClient()`, it throws `OpenInLineError(lineAppUrl(liffId, location.pathname), toLocale(liff.getAppLanguage()), liff.getOS())`. The app deliberately never starts LINE Login outside the LINE app, because in Safari the login looped through LINE and ngrok's warning page and never signed in. The screens then show the "Open in LINE" page.
- If not logged in, it calls `liff.login()` and returns a never-resolving promise (the page is leaving).
- If `getIDToken()` is empty it throws "LINE gave no ID token. The LIFF app needs the openid scope."

**Returned `LiffState`:**
- `getIdToken()`: `liff.getIDToken() ?? ''`.
- `locale`: `toLocale(liff.getAppLanguage())`.
- `mock`: boolean.
- `signInAgain()`: calls `liff.logout()` then `window.location.reload()`, but at most once a minute. It guards with `sessionStorage['maison.signedInAgainAt']`. Within the minute, or without storage, it does nothing, so the screen shows the error instead of looping.
- `friendFlag()`: memoized `liff.getFriendship().friendFlag`, asked once per page load. It returns `null` (never asks) when `NEXT_PUBLIC_LINE_OA_ID` is unset or invalid, or in mock mode. It returns `null` on failure and warns in dev only. It works only when the Official Account is linked to the LINE Login channel.

### 2.3 Session exchange (`lib/session.ts`)

`createSession({strapiUrl, clientId, getIdToken, fetchImpl, now, sleep})` returns `{getToken, refresh}`.

**Endpoint and form** (RFC 8693 token exchange):
- `POST {strapiUrl}/api/strapi-oauth-mcp-manager/oauth/token`
- `Content-Type: application/x-www-form-urlencoded`
- Body fields:
  - `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`
  - `client_id=<NEXT_PUBLIC_MAISON_CLIENT_ID>`
  - `subject_token=<LINE ID token>`
  - `subject_token_type=urn:ietf:params:oauth:token-type:id_token`
  - `resource={strapiUrl}/mcp` (present in the code; the docs table omits it)
- It also sends `ngrok-skip-browser-warning: 1`, but only when `strapiUrl`'s origin equals `window.location.origin` (`lib/tunnel.ts`).

**Client ID.** The "Maison app" OAuth client, created in Strapi by `npm run setup` (local) or by hand on Strapi Cloud. It has "LINE sign-in" customer mode and is mapped to the "Maison customer" admin token. Setup writes its `clientId` to `NEXT_PUBLIC_MAISON_CLIENT_ID` in `liff/.env`. It is a public client with no secret. Only one LINE client can be active per Strapi. This client ID is not the LINE channel ID.

**Response and token handling:**
- On success it returns `{access_token, expires_in}` with no refresh token. The access token is a Bearer string starting `mcp_at_` (the proxy and the concierge route validate `/^Bearer mcp_at_\S+$/`).
- The token is kept in memory only. It is re-used until fewer than 60 s remain, with `expires_in || 3600` s as the lifetime.
- Concurrent callers share one in-flight exchange (`pending`).
- `refresh()` drops the current token and does a new exchange.
- On failure it throws `SessionError(code, description, retryAfterSeconds)`:
  - `invalid_grant` (400): LINE rejected the ID token. Only a new LINE sign-in helps (`signInAgain` getter).
  - `temporarily_unavailable` (503): `retryLater`. It is retried once after `Retry-After` seconds if that is 10 s or less (5 s if no header); a longer wait is not waited out and the error carries it. `Retry-After` is exposed through Strapi CORS.
  - Other codes include `invalid_client` and `server_error`, the latter being the default when the body has no `error`.

**Wiring** (`lib/maison.ts` `getMaison`), once per page load, with memoization reset on failure:
1. Throws if `NEXT_PUBLIC_MAISON_CLIENT_ID` is empty ("Run `npm run setup` and restart the app.").
2. `initLiff()`.
3. `createSession(...)`, wrapped so `invalid_grant` triggers `liff.signInAgain()` when not in mock mode. In mock mode the error is shown, because mock tokens do not expire; it means the app and Strapi disagree about the channel.
4. `await session.getToken()` immediately, so the first screen does not wait.
5. `createMcp(...)`, with the record listener fan-out.

It returns `{locale, mock, session, callTool, friendFlag}`.

### 2.4 Local mode versus LINE mode

| | Local mode (default, the stage) | LINE mode (option B) |
|---|---|---|
| App `.env` | `NEXT_PUBLIC_LIFF_MOCK=true`, `NEXT_PUBLIC_LIFF_ID` empty, `NEXT_PUBLIC_STRAPI_URL=http://localhost:<port>`, `STRAPI_URL=http://127.0.0.1:<port>` | `NEXT_PUBLIC_LIFF_MOCK=false`, `NEXT_PUBLIC_LIFF_ID=<LIFF ID>`, `NEXT_PUBLIC_STRAPI_URL=https://<ngrok domain>`, `STRAPI_URL=http://127.0.0.1:<port>` |
| Strapi `.env` | `LINE_LOGIN_CHANNEL_ID=1234567890` (the mock's), `LINE_VERIFY_URL=http://127.0.0.1:4545/verify`, `MAISON_LIFF_URL=http://localhost:3003`, `PUBLIC_URL=` | `LINE_LOGIN_CHANNEL_ID=<your channel id>`, `LINE_VERIFY_URL=` (empty), `MAISON_LIFF_URL=https://liff.line.me/<LIFF ID>`, `PUBLIC_URL=https://<ngrok domain>` |
| Sign-in | LIFF mock, fake `valid.U…` ID token | Real LIFF inside the LINE app |
| ID token verify | Strapi calls the local mock at `:4545` | Strapi calls LINE's real verify endpoint |
| Start | `npm run dev` (Strapi + `next dev` + mock) | `npm run mode:line`, `npm run dev:strapi`, `npm run setup`, `npm run start:line`, `npm run tunnel`, `npm run qr` |
| Browser calls | Cross-origin to Strapi (CORS allows `http://localhost:3003`) | Only the app's own origin; the app proxies 3 paths |

**`scripts/line-mode.mjs`** (`npm run mode`, `mode:line`, `mode:local`):
- Commands: `status | line | local | require-line | require-local`.
- `line` reads `LINE_MODE_LIFF_ID`, `LINE_MODE_CHANNEL_ID` and `LINE_MODE_DOMAIN` from `liff/.env`. It validates them:
  - the LIFF ID matches `^\d+-[A-Za-z0-9]+$`;
  - the channel ID is digits only and is not the mock's `1234567890`;
  - the domain is a bare hostname.
  - It warns if the LIFF ID does not start with the channel ID. It then rewrites the keys in both `.env` files, `chmod 600`, preserving line endings, and prints no values.
- `currentMode` returns `line`, `local` or `mixed`.
- `require-local` makes `npm run dev` and `dev:app` refuse to start if `NEXT_PUBLIC_LIFF_MOCK=false`. `require-line` makes `npm run start:line` refuse to start unless in LINE mode.
- `readEnv` and `writeEnv` are deliberately dotenv-compatible (CRLF, `export KEY=`, `KEY: value`, NBSP), so a form Strapi honours can't slip past the tunnel's check.
- Both `.env` files can only be created from their `.env.example` by `scripts/init-env.mjs`. It runs on `npm install`, fills in the generated Strapi secrets and the demo admin password, and `chmod 600`s the files. Only keys still holding placeholders (empty or starting `tobemodified`) are replaced.

**`next.config.mjs` `X-Maison-Liff` header** (added to every path):
- `mock` when `NEXT_PUBLIC_LIFF_MOCK !== 'false'`.
- `line-dev` for a dev server in LINE mode.
- `line` for a production build in LINE mode.
- `npm run tunnel` reads it.

### 2.5 "Open in LINE" page

- Shown when LINE mode runs outside the LINE app (`OpenInLineError`).
- Contents:
  - h1 "Open Maison in LINE";
  - body text. On a phone (`liff.getOS()` is `ios` or `android`) it says "Tap Open in LINE below.". On desktop it says to scan the code with LINE's QR reader;
  - a 240 px QR code, black on white, error correction M, margin 2, on a white tile inside a hairline. It is generated client-side from an SVG data URL by `lib/qr-image.ts`, with `qrcode` loaded lazily by dynamic import. If drawing fails, the link is shown as copyable text;
  - on a phone, a primary "Open in LINE" button linking to the LIFF URL;
  - a hint about turning off LINE Labs "Open links in your default browser".
- The URL is built by `lib/line-app-url.mjs` `lineAppUrl(liffId, pathname)`: `https://liff.line.me/<LIFF ID>` plus the path.
  - The query string and hash are dropped, because they can carry tokens.
  - Repeated slashes collapse and a trailing slash is removed.
  - The same file is used by `scripts/line-qr.mjs`.
- This is not an error, so there is no Retry.

### 2.6 Mock LINE verify endpoint (`liff/scripts/mock-line-verify.mjs`)

- A plain `node:http` server on `127.0.0.1:${MOCK_LINE_VERIFY_PORT || 4545}`. It has an `EADDRINUSE` friendly message and sets `exitCode = 1` rather than calling `process.exit`.
- **Only route:** `POST /verify`. Anything else returns 404 `{error:'not_found'}`.
- **Body:** form-encoded, mimicking LINE's `POST https://api.line.me/oauth2/v2.1/verify`.
- **Checks:**
  - `client_id` must equal `LINE_LOGIN_CHANNEL_ID` (default `1234567890`). Otherwise it returns 400 `{error:'invalid_request', error_description:'Invalid IdToken Audience.'}`.
  - `id_token` must be exactly two dot-separated parts, `valid` and `U` plus 32 lowercase hex digits (`lineUserIdOf`). Otherwise it returns 400 `{error:'invalid_request', error_description:'Invalid IdToken.'}`.
- **Success (200):** `{iss:'https://access.line.me', sub:<LINE user id>, aud:<channelId>, exp:now+3600, iat:now, amr:['linesso'], name:'Demo customer'}`.
- **Wiring:** Strapi's `strapi-oauth-mcp-manager` config has `identityProviders.line = { channelId: LINE_LOGIN_CHANNEL_ID, verifyUrl: LINE_VERIFY_URL }`, and `LINE_VERIFY_URL` is dropped when `NODE_ENV=production`. Strapi Cloud therefore always verifies with LINE. This is by design: with the mock behind a tunnel, anyone could sign in as any customer.
- **Started by** `liff` `npm run dev` and `npm start`, through `concurrently`, with `node --env-file-if-exists=.env scripts/mock-line-verify.mjs`.

### 2.7 Tunnel, proxy, QR, stand-in

**Proxy** (`lib/strapi-proxy.ts`, routes `app/mcp`, `app/uploads`, `app/api/strapi-oauth-mcp-manager/oauth/token`). It makes the phone talk only to the app's own origin. Strapi and its admin stay on the laptop.

- Proxied paths (regex): `/mcp`, `/api/strapi-oauth-mcp-manager/oauth/token`, `/uploads/<anything>`. Anything else is 404 from the app.
- **It is closed** (404 `{error:'not_found'}`) unless the build has `NEXT_PUBLIC_LIFF_MOCK === 'false'` (inlined at build time). A mock build, or `npm run dev`, answers 404 on all three paths, so a tunnel left open after `mode:local` can't reach a Strapi that trusts the mock.
- **Path climbing is refused**, including percent-encoded `..`.
- **`/mcp` Authorization rule:** none (Strapi then answers 401 with resource metadata) or a customer session (`/^Bearer mcp_at_\S+$/`). Anything else, such as an admin token, gets 401 `invalid_token` with `WWW-Authenticate: Bearer error="invalid_token"`.
- **Token endpoint rule:** the Content-Type must be `application/x-www-form-urlencoded`, `grant_type` must be the token-exchange URN, and keys must be flat. No duplicate keys and no `[]` keys, so Strapi can't read it two ways. The body is re-encoded. Otherwise it returns 400 `{error:'unsupported_grant_type'}`.
- **Request headers forwarded:** `accept`, `authorization`, `content-type`, `if-modified-since`, `if-none-match`, `last-event-id`, `mcp-protocol-version`, `mcp-session-id`, `range`. Headers named in `Connection` are dropped. No cookies and no Origin.
- **Response headers dropped:** hop-by-hop, `set-cookie`, `content-encoding`, `content-length`, plus anything named in `Connection`. The body streams through, which matters because MCP answers are SSE.
- **Body limit:** 1 MB. Over it returns 413 (checked by Content-Length and again while streaming). An unreadable body returns 400.
- **Upstream** `redirect: 'manual'`; the request abort signal is propagated.
- **Strapi down:** 502 `{error:'temporarily_unavailable'}`.
- **Server-side Strapi origin** is `STRAPI_URL` (default `http://127.0.0.1:1338`), via `strapiOrigin()`. It is never `NEXT_PUBLIC_STRAPI_URL`, which in LINE mode is the app's own public address, so the proxy would call itself.
- `liff/scripts/check-strapi-proxy.mjs` is an end-to-end check (see section 6).

**Tunnel** (`scripts/line-tunnel.mjs`, `npm run tunnel`, `npm run tunnel -- --dry-run`). It refuses to start unless all of these hold:
- `strapi/.env` has no `LINE_VERIFY_URL`, and both env files match LINE mode.
- Nothing answers TCP on `127.0.0.1:4545`. LINE mode therefore uses `start:line`, which does not run the mock.
- `GET http://127.0.0.1:3003/` has `X-Maison-Liff: line`. Otherwise it explains `mock`, `line-dev` or `none`.
- A forged exchange through the app (`subject_token=valid.U000…0`, client id from env) must return 400 `invalid_grant`. This proves Strapi verifies with LINE. It also reports a Strapi that is unreachable (502), `temporarily_unavailable`, `invalid_client` or `unauthorized_client`, a 2xx (a forged token accepted), or anything else.
- It then runs `ngrok http 127.0.0.1:3003 --url=https://<LINE_MODE_DOMAIN> --inspect=false`. `--inspect=false` keeps the local inspector from storing customers' tokens. ngrok's free plan shows an interstitial, which `ngrok-skip-browser-warning: 1` bypasses.

**QR** (`liff/scripts/line-qr.mjs`, `npm run qr -- [/path]`):
- It builds `https://liff.line.me/<LIFF ID>[/path]` from `LINE_MODE_LIFF_ID`.
- It prints a terminal QR code.
- It writes `liff/line/qr/maison-line-qr.png` (1024 px, margin 4) and `maison-line-qr.svg`. That folder is gitignored because it holds the LIFF ID.
- Path validation rejects `?`, `#`, `://`, spaces, backslashes, `..` (including `%2e%2e`), options starting `-`, and more than one argument.

**LINE stand-in** (`scripts/line-stand-in.mjs`, `npm run line:stand-in`). A fake of LINE's Messaging API on `127.0.0.1:${LINE_STAND_IN_PORT || 4010}`, so Strapi's staff follow-up reaches no phone. Strapi targets it through `MAISON_LINE_API_BASE_URL` plus any `LINE_CHANNEL_ACCESS_TOKEN`.
- `POST /v2/bot/message/push` returns 200 `{sentMessages:[{id, quoteToken:'stand-in'}]}` and logs the body.
- `GET /v2/bot/profile/<id>` returns `{userId, displayName:'Demo customer (test)'}`.
- `GET /v2/bot/message/quota` returns `{type:'limited', value:200}`.
- `GET /v2/bot/message/quota/consumption` returns `{totalUsage: <pushes since start>}`.
- Everything else returns 404.
- It appends JSON lines (no headers, so no token) to `strapi/.tmp/line-stand-in.jsonl`.

**Option A (real message to your phone):** put the Official Account's Messaging API channel access token in Strapi's `LINE_CHANNEL_ACCESS_TOKEN`. Put your own user ID in `NEXT_PUBLIC_DEMO_LINE_USER_ID` so the mock customer is you. Strapi pushes a flex confirmation when staff confirm. The button opens `MAISON_LIFF_URL/visits/<reference>`. LINE's push API answers 200 even when it can't deliver, so "LINE sent" means "accepted".

**LINE MINI App:** see section 7. It is the same app on a MINI App channel, with `LINE_MODE_LIFF_ID` and `LINE_MODE_CHANNEL_ID` changed.

### 2.8 "Chat with Maison on LINE" (`lib/line-chat.ts`, `components/line-chat.tsx`)

- `lineChatUrl(basicId)` returns `https://line.me/R/ti/p/%40<id>` when the ID matches `/^@[a-z0-9._-]+$/i`, else null (no button anywhere).
- `lineMessageUrl(basicId, text)` returns `https://line.me/R/oaMessage/%40<id>/?<urlencoded text>`, which opens the chat with the text pre-typed. The text is cut to 500 characters, never mid-emoji, and a lone surrogate becomes U+FFFD.
- `lineChatWords(copy, friendFlag)`: `friendFlag === false` gives "Add Maison on LINE" / "Add Maison on LINE to get your confirmation there."; otherwise (true or null) it gives "Chat with Maison on LINE" / "Your confirmation arrives in the Maison chat.".
- Rendered as a secondary button (`data-testid="line-chat"`) on My visits, on a visit page, after a booking in My visits (next to "Request sent"), and in the concierge under a booking card or the plain hand-off note.
- LINE's links work in LINE on phones, not in LINE for PC.

---

## 3. MCP client (browser) and tool catalogue

### 3.1 Browser client (`lib/mcp.ts`)

- **Library:** `@modelcontextprotocol/sdk` (`Client` and `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/*.js`). `new Client({name:'maison-app', version:'1.0.0'})`.
- **Transport:** Streamable HTTP, `new StreamableHTTPClientTransport(new URL(strapiUrl + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer <session token>', ...tunnelHeaders } } })`.
  - The SDK handles `mcp-session-id`, `mcp-protocol-version` and SSE itself; the app writes none of that.
  - Strapi's CORS allows and exposes the `mcp-*` headers.
  - There is no `x-maison-surface` header from the browser, so Strapi records `createdVia: 'app'` for bookings made here, including from the picker.
- **Connection management** (`createMcp`):
  - Lazy: the first call connects with `session.getToken()`.
  - One connection is held as a `Lease {client, active, retired}`.
  - On `StreamableHTTPError` with code 401 the call exchanges a new token (`session.refresh()`), reconnects and retries once.
  - Concurrent 401s share a single exchange and reconnect. If the refresh fails, all affected calls fail with that refusal and none starts a second exchange.
  - A stale connection is closed only once no call is in flight on it. Closing earlier makes the SDK reject in-flight calls with "Connection closed" instead of their own 401.
- **`callTool(screen, name, args)`:**
  - Returns the raw `CallToolResult`.
  - It records `{id, screen, name, args, result|null, error|null, ms, at}` to listeners, for the agent view. A listener that throws never changes how the call ended.
  - It throws on transport errors. Tool errors come back as results with `isError`.
- **`toolErrorOf(result)`:** `isError` text is parsed as JSON `{error:{code,message,hint}}`. Plain text starting "Input validation error" becomes `invalid_input`. Anything else becomes `error`.

### 3.2 Tools the browser calls

All screens use `result.structuredContent`. `locale` is `'ja' | 'en'`. Common error JSON is `{error:{code,message,hint}}` with `isError: true`. Codes: `not_signed_in`, `not_found`, `invalid_input`, `boutique_closed`, `in_the_past`, `too_many_open_requests`, `too_many_open_questions`, `not_published`, `not_configured`.

| Tool | Arguments | Result `structuredContent` |
|---|---|---|
| `browse_collections` | `{ locale? }` | `{ locale, collections: [{ slug, name, teaser, heroImageUrl: string\|null, productCount }] }` |
| `search_products` | `{ query?(max 100), collection?(slug), category?('trunk'\|'bag'\|'small-leather'\|'travel'\|'objet'), occasion?('travel'\|'anniversary'\|'birthday'\|'wedding'\|'new-job'), minPriceJpy?, maxPriceJpy?, personalizable?, inStockAt?(boutique slug), locale?, limit?(1–20, default 8) }` | `{ locale, total, products: [ProductCard] }`, where ProductCard is `{ slug, name, category, priceJpy, imageUrl\|null, occasions[], personalizable, inStockAt[] }`. Sorted by price descending. `minPriceJpy > maxPriceJpy` gives an `invalid_input` error |
| `view_product` | `{ slug, locale? }` | `{ product: { locale, slug, sku, name, category, priceJpy, description, craftStory, dimensionsCm: {width,height,depth}\|null, personalization: {offered, kinds[], leadDays\|null}, images: [{url, alt}], occasions[], collection: {slug,name}\|null, stock: [{boutique, name, quantity}] } }`. Unknown slug gives `not_found` |
| `find_boutiques` | `{ productSlugs?(≤5), date?('YYYY-MM-DD'), locale? }` | `{ date: string\|null, boutiques: [{ slug, name, city, address, hours: [{weekday,opens,closes}], openOnDate: bool\|null, hoursOnDate: {opens,closes}\|null, stock: [{product, quantity}] }] }`. An unknown product slug gives `not_found` (this is what the concierge pre-check relies on) |
| `request_appointment` | `{ boutique, productSlugs(1–5), requestedFor('YYYY-MM-DDTHH:MM:00+09:00'), note?(≤500), locale? }` | `{ appointment: { reference:'APT-####', status:'requested'\|'confirmed', boutique:{slug,name}, requestedFor, products:[{slug,name}], note, confirmationSent } }`. Errors: `boutique_closed`, `in_the_past` (less than 30 minutes away), `too_many_open_requests` (3 waiting) |
| `my_appointments` | `{ locale? }` | `{ appointments: [Appointment] }`, newest first, own customer only |

Concierge-only (server side, via the AI SDK):

| Tool | Arguments | Result |
|---|---|---|
| `search_knowledge` | `{ query(1–300, trimmed), productSlugs?(≤5), locale? }` | `{ locale, entries: [{ title, answer, category, productSlugs[] }] }`, at most 4, best first, maybe empty |
| `hand_off_to_staff` | `{ question(1–1000), reason?('no_answer'\|'asked_for_person', default no_answer), productSlug?, locale? }` | `{ question: { reference:'Q-####', status:'open', product:{slug,name}\|null } }`. Up to 5 open per customer; asking the same open question again returns its reference |
| `log_inquiry` | `{ message(1–4000), reply?(≤8000), knowledgeFound, handedOff, questionReference?('Q-####'), productSlug?, locale? }` | `{ logged: true }`. Called by the app's server only, never offered to the model |

Staff-only tools `appointment_requests`, `confirm_appointment`, `pending_confirmations` and `record_confirmation` are not used by this app.

**Permissions** (on the "Maison customer" admin token that backs the OAuth client): "MCP: browse the catalog" (`catalog.read`), "MCP: request and view own appointments" (`appointments.request`), "MCP: hand questions to staff" (`questions.ask`) and "MCP: log customer inquiries" (`inquiries.log`). The Public REST role also needs `find` on collections, products, boutiques, knowledge, plus `findOne` on products and `find` on Home-page.

### 3.3 Types (`lib/types.ts`)

`Locale`, `CollectionSummary`, `ProductCard`, `Product`, `BoutiqueInfo`, `Appointment` (shapes as in the table above).

---

## 4. The concierge

### 4.1 Request path

**Client** (`app/concierge/page.tsx`):
- `useChat` from `@ai-sdk/react` with `DefaultChatTransport({ api: '/api/concierge', headers, body })`.
  - `headers` is an async function returning `Authorization: Bearer <fresh session token from getMaison().session.getToken()>` plus `tunnelHeaders`.
  - `body()` returns `{ locale, product? }`, read from refs at send time, so the language switch and the piece apply to later sends.
- `sendAutomaticallyWhen: resumesOncePerAnswer()` (see 4.6).
- It uses `messages`, `sendMessage`, `regenerate`, `status`, `error` and `addToolOutput`.
- The composer is locked while `status` is `submitted` or `streaming`, or while a picker's request is in flight (`composerLocked`).
- `?product=<slug>` is validated with `pieceSlugOf` (`/^[a-z0-9-]+$/`, at most 120 characters). A different intro text and different suggestion chips are used, and the slug goes to the server on each turn. `lib/piece-slug.ts` is a separate import-free module so the page doesn't bundle the concierge's zod schemas, which would add about 60 kB gzipped to the page.

**Route** (`app/api/concierge/route.ts`, `maxDuration = 60`): `handleConcierge(request, { model, modelLabel, modelFix, createMcpClient: createMCPClient (from @ai-sdk/mcp), strapiUrl: strapiOrigin() })`.

**`handleConcierge`** (`lib/concierge.ts`):
1. Requires `Authorization: Bearer mcp_at_…`, else 401 `{error:'Sign in with LINE first.'}`.
2. Reads the body with a 1 MB cap (413 over it; 400 if unreadable). JSON parse failure counts as an empty conversation.
3. Keeps the last **20** messages (`MAX_MESSAGES`).
4. Validates each message: role `user` or `assistant`, a `parts` array of objects, and text parts with string `text`. Otherwise 400.
5. User text parts are capped at **1000** characters (`MAX_CHARS`). Assistant text is not capped, so a long reply never blocks the next turn. No messages, or an oversized one, gives 400.
6. `locale = body.locale === 'en' ? 'en' : 'ja'`. The server default is `ja`.
7. `product` goes through `pieceSlugOf`. A bad value is ignored.
8. Opens an MCP client: `createMCPClient({ transport: { type: 'http', url: '<strapi>/mcp', headers: { Authorization: <customer's own header, unchanged>, 'x-maison-surface': 'concierge' } } })`. If it fails, 502 `{error:'Could not reach the Maison tools: …'}`.
   - The concierge adds no credential of its own.
   - `x-maison-surface: concierge` makes Strapi record `createdVia: 'concierge'`. It is informational only and never used for identity.
9. Loads `mcp.tools()` and removes `log_inquiry` and `request_appointment` from the model's set.

### 4.2 Model and provider (`lib/model.ts` `conciergeModel(env)`)

Priority order:
1. `ANTHROPIC_API_KEY` set: `anthropic('claude-sonnet-5')` via `@ai-sdk/anthropic`. Label "Claude Sonnet 5 (Anthropic)".
2. Else `AI_GATEWAY_API_KEY` set: the model string `'anthropic/claude-sonnet-5'`, routed by the AI SDK through Vercel AI Gateway. Label "Claude Sonnet 5 (AI Gateway)". When both keys are set, `ANTHROPIC_API_KEY` wins.
3. Else a local Ollama through `createOpenAICompatible({ name:'ollama', baseURL: OLLAMA_BASE_URL || 'http://localhost:11434/v1' })`, `chatModel(OLLAMA_MODEL || 'qwen3-14b-32k')`.
   - It is wrapped in `wrapLanguageModel` with `defaultSettingsMiddleware({ settings: { providerOptions: { ollama: { reasoningEffort: 'none' } } } })`. This turns off Qwen3's thinking, which is slow on a laptop.
   - The recommended local model is `qwen3:14b` with `num_ctx 32768`, created as `qwen3-14b-32k` from a Modelfile (`FROM qwen3:14b` and `PARAMETER num_ctx 32768`). It takes about 20 to 60 s per turn.
   - `fix` text: "Start Ollama with <model>, or set ANTHROPIC_API_KEY in liff/.env and restart the app." (for Claude: "Check the laptop's internet connection.").
   - Keys are never put in labels or logs.
- Note: the Strapi admin's own staff chat and inquiry labeller use different models (Strapi's `AI_CHAT_MODEL` defaults to `claude-sonnet-5-5`, labelling uses `claude-haiku-4-5-20251001`). That is outside `liff/`.
- Errors: `describeModelError` explains "The concierge's model (<label>) isn't reachable. <fix>" when the failure is a connect error. It detects `APICallError` messages matching `Cannot connect to API|fetch failed|ECONNREFUSED`, walking `RetryError.errors` and `cause` chains (AI Gateway wraps its errors). Otherwise it uses the plain error message.

### 4.3 AI SDK 7 specifics

- `streamText({ model, instructions, messages, tools, stopWhen: isStepCount(8), abortSignal: request.signal, onEnd, onAbort, onError })`.
- Uses `instructions` (not `system`), `isStepCount` (not `stepCountIs`), `convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true })`, `toUIMessageStream({ stream, originalMessages, onError })` and `createUIMessageStreamResponse`.
- `onEnd`, `onAbort` and `onError` are used. This is a newer API than the AI SDK v5/v6 many people know, so check the installed version's docs when porting.
- **Streaming:** the response is the AI SDK UI message stream (SSE). The client's `useChat` renders `text`, `step-start`, `dynamic-tool` (MCP tools) and `tool-<name>` (the app-local tools) parts as they stream.
- The reply stream is built from `result.stream` through a custom generator (`turnParts`) so that the extra pass's parts can be merged in before the single `finish` (see 4.7).

### 4.4 Limits (summary)

| Limit | Value |
|---|---|
| Route `maxDuration` | 60 s |
| Messages kept | last 20 |
| User text per message | 1000 chars (client `maxLength` is also 1000) |
| Request body | 1 MB |
| Model steps per reply | 8 (`MAX_STEPS`) |
| Extra picker pass | 3 steps, at most 20 s, skipped if under 5 s of the 55 s turn budget remain |
| Turn budget | 55 s total (60 s less the 5 s log timeout) |
| `choose_visit` pieces pre-check | 5 s timeout |
| `log_inquiry` call | 5 s timeout; reply cut to 8000 UTF-16 units; question cut to 1000 |
| Calendar in prompt | 14 days from today (Tokyo) |
| Replies | "two or three short sentences"; suggest at most 3 products |
| Strapi | 5 open hand-off questions per customer; 3 open visit requests per customer |

### 4.5 System prompt (`conciergeInstructions(locale, now, piece)`)

Built per request.

**Preamble:**
- "You are the concierge of Maison, a fictional luxury house of trunks, bags and small gifts. You help one signed-in customer choose a gift and request a boutique visit."
- "Today in Tokyo: <weekday, YYYY-MM-DD>. Boutique times are Japan time (Asia/Tokyo, +09:00)."
- Then "Calendar of the next 14 days in Tokyo, today first:" followed by 14 lines `YYYY-MM-DD <Sun…Sat or 日…土>`. The weekday names are in the reply's language, and the calendar uses Tokyo's date whatever the server's time zone.

**Rules** (my close paraphrase of each):
1. **Tools for every fact.** Use tools for all facts about products, prices, stock and opening hours. Never invent. Use product names exactly as returned. Call the tools needed in this reply and answer from the results. Never say "I'll look it up" and stop.
2. **Search broadly first.** For a gift use `search_products` with the occasion (`travel` for someone who travels), the budget (`maxPriceJpy`) and the boutique (`inStockAt`). Add a category or collection only if the customer asks. If nothing is found, drop a filter and search again before saying nothing fits.
3. **Visits go through `choose_visit`.** To request a visit, call `choose_visit` with the pieces the customer wants to see and, if named, the boutique slug, the day (the date `resolve_date` returned) and the time (HH:MM, 24 h).
   - Never ask for boutique, day or time in words, never restate them for a yes, and never ask "Shall I request a visit?". Call `choose_visit` instead.
   - The app shows the filled-in form and the customer sends the request there. Until `choose_visit` answers `requested`, nothing is requested, so never say you requested or booked it.
   - If the customer asks to visit before choosing a piece, call `choose_visit` in the same reply with the pieces you suggest in that reply or just before (at most 3). Ask which piece only if you have none to suggest.
4. **Dates only through `resolve_date`.** Call it only when the customer names a day, never to find today's date (given above). In the JA prompt there is an extra Japanese sentence: 日付が出ていないご相談では resolve_date を呼ばないでください。 (do not call it when no date is mentioned).
   - Never work out or guess a date or weekday yourself.
   - When the customer names a day, call `resolve_date` first, on its own, before `find_boutiques` with a date and before `choose_visit`.
   - Use `weekday` for a weekday name ("Saturday": week `this`; "next week's Saturday" / 来週の土曜日: week `next`).
   - Use `relative` for exactly "today", "tomorrow" or "day_after_tomorrow" (明後日).
   - Use `date` for any other day (a calendar date, or a day read off the calendar such as "in 3 days").
   - If no day is named: don't call it, don't pass a date to `find_boutiques` or `choose_visit`, don't suggest a day.
   - Look up opening hours only when asked, by calling `find_boutiques` without a date (it lists weekly hours).
   - Use the date and the weekday returned, never a weekday from the customer's words.
   - If `isPast` is true, ask for another day.
   - For days the calendar doesn't show ("next month"), ask which day.
   - Visits can be requested from tomorrow up to two weeks ahead. For today or a later day, say so in one short sentence and call `choose_visit` without a date.
5. **Never say confirmed.** When `choose_visit` answers `requested`, say in one short sentence that the visit is requested and the boutique will confirm on LINE (the app shows the details). When it answers `closed`, offer help without pushing.
6. **Tool errors.** Follow the error's hint. `not_found` means a slug was wrong: look it up with the tool the hint names, never guess. An input validation error means fix the arguments and call again. Otherwise ask the customer.
7. **Language and style.** Japanese: "Reply in polite Japanese (keigo)." English: "Reply in English." Pass `locale "<locale>"` to every tool that takes one. Two or three short sentences of plain text: no markdown, no bold, no numbered or bulleted lists. The app shows product cards, so don't repeat details.
8. **At most three products** at a time.
9. **Knowledge questions.** For care, materials, sizing, personalization, delivery, payment, returns, repairs, warranty or gift wrapping, call `search_knowledge` with the customer's own words (and `productSlugs` when about particular pieces). Answer only from returned entries, never invent a policy, price or time.
   - If no entry answers, call `hand_off_to_staff` next, before writing anything, with the customer's question in their words, reason `no_answer`, and `productSlug` when about one piece.
   - Then thank the customer and say in one short sentence that a client advisor will look into it and message them on LINE (the app shows details).
   - Never say a question is with the advisors unless `hand_off_to_staff`, or `search_knowledge`'s own hand-off, succeeded for it, in this or an earlier reply. Never promise a time.
10. **Asked for a person.** Call `hand_off_to_staff` at once with their request, reason `asked_for_person`. Hand off each question once: if it is already with the advisors, say so.

**Piece context** (only when `?product=` was passed): a trailing paragraph — 'The customer is on the page of the piece with slug "<slug>". Unless they name another piece, "it" and "this" mean that piece: use that slug with view_product, as productSlugs for search_knowledge, and as productSlug for hand_off_to_staff.'

### 4.6 Tools exposed to the model

**MCP passthrough, 7 tools.** These are every customer tool except `request_appointment` (and `log_inquiry`, which is server-only): `browse_collections`, `search_products`, `view_product`, `find_boutiques`, `search_knowledge`, `my_appointments`, `hand_off_to_staff`.
- Schemas come from Strapi through `mcp.tools()`; see section 3.2.
- Each is wrapped by `withConversationLocale`: if the tool's JSON schema has a `locale` property and the model sends none (or null or ""), the conversation's locale is filled in. In an English chat a booking once came back with the default Japanese names.
- `search_knowledge` and `hand_off_to_staff` are additionally wrapped by `withAutoHandOff` (see 4.8).

**Local tools, 2.**

1. **`resolve_date`** (executes locally in `lib/resolve-date.ts`).
   - Input is a strict zod object, pre-processed by `tidyInput`. `tidyInput` trims and lower-cases strings, drops null and "" values, and drops a `locale` key. This is because the local model fills every field with null or "".
   - Fields (exactly one of `weekday`, `date`, `relative`; `week` only with `weekday`):
     - `weekday`: `'monday'…'sunday'` (lower-case English). The first such day after today.
     - `week`: `'this' | 'next'`. `next` is that weekday in the following Monday-to-Sunday week. On a Thursday, next week's Saturday is 9 days away.
     - `date`: a `YYYY-MM-DD` regex, to get its weekday.
     - `relative`: `'today' | 'tomorrow' | 'day_after_tomorrow'`.
   - Output: `{ date: 'YYYY-MM-DD', weekday: '<name in reply language>', isPast: boolean }`.
   - It is a strict object, so an unknown key is refused with its name, not stripped. Stripping once turned `week: "next"` into this week's Saturday.
   - It throws on invalid input or an impossible date. Days are Tokyo's, from a 14-day window.
   - Reason it exists: on the local model, "Saturday" came out as Friday.
2. **`choose_visit`** (no `execute`, so the model's call ends the step loop and the client answers it).
   - Input (strict object, same `tidyInput`):
     - `productSlugs`: array of 1–5 strings matching `/^[a-z0-9-]{1,120}$/`;
     - `boutique?`: slug;
     - `date?`: `YYYY-MM-DD`;
     - `time?`: `HH:MM` 24 h.
   - A `superRefine` runs only when nothing else failed. It pre-checks the pieces by calling the real `find_boutiques({productSlugs, locale})` with a 5 s timeout. If Strapi answers `not_found`, the call is refused with Strapi's message and hint, so the model fixes the slug (rule 6).
   - Any other outcome lets it through: no `find_boutiques` permission, a refusal the model can't fix, a broken call, or a timeout. The form then makes its own call.
   - Output (written by the browser through `addToolOutput`): `{ status: 'requested', appointment }` or `{ status: 'closed' }`.

`request_appointment` is never offered to the model. The customer's tap books it. The model never books, and never says a visit is confirmed. The title bar still says "8 MCP tools" because `request_appointment` is used through the picker.

### 4.7 Visit picker flow (`choose_visit` to Book a visit form to Send request to `request_appointment`)

Files: `lib/visit-picker.ts` (pure rules), `components/visit-picker.tsx`, `components/booking-form.tsx`, `components/chat-parts.tsx`, `app/concierge/page.tsx`.

1. The model calls `choose_visit`. The AI SDK streams `tool-choose_visit` through `input-streaming` to `input-available`. The step loop ends, with no `execute`, and the reply stops there.
2. **Chat rendering.** For the live picker whose call has fully arrived (`input-available`), `pickerViewOf` gives `form`. The chat shows:
   - the tool line `Local · choose_visit` (no check mark while waiting);
   - below it a `VisitPicker`, an inline `border border-ink` card, `data-testid="visit-picker"`.
   - Heading "Book a visit" and the pieces' names. Names are fetched by `view_product` per slug in the chat's language, never from the model's words. Product photos from searches in the same reply sit above the line (`messageLayout`, see 4.9).
   - The chat scrolls inside its own container to the form's top once (`followScroll`: `picker` / `stay` / `end`), with a 20 px gap. It never uses `scrollIntoView`, which could move LINE's whole page.
3. **Prefill** (`pickerPrefill`) from the call:
   - boutique: the call's slug (if it looks like a slug), else `ginza`. The form then uses it only if that boutique has one of the pieces in stock; else it uses the first boutique that does.
   - date: the call's, only if it is one of the form's day chips (tomorrow to +14 days). Else the next Saturday at least 2 days away.
   - time: the call's, rounded down to the half-hour (14:15 becomes 14:00), else `14:00`. The form uses it only if the boutique is open then; else its first slot.
   - The call is read once (`useState` initializer), so later changes are the customer's.
4. **Send request** runs `requestVisit` with the same arguments as the product sheet, `maison.callTool('concierge', 'request_appointment', …)`, with the customer's own session. A refusal (`boutique_closed`, `in_the_past`, `too_many_open_requests`) stays in the form and nothing reaches the concierge. On success it calls `onAnswer({status:'requested', appointment})`, which is `addToolOutput({ tool: 'choose_visit', toolCallId, output })`.
5. **Not now** calls `onAnswer({status:'closed'})`.
6. **Auto-resume.** `sendAutomaticallyWhen = resumesOncePerAnswer()`, a stateful predicate made once per chat. It returns true once per answered picker (by `toolCallId`), when the last step of the last assistant message holds an answered picker and every other call in that step has finished. It is not the SDK's `lastAssistantMessageIsCompleteWithToolCalls`, which could loop after Strapi tool turns. The `resumed` set prevents resubmitting the same answer if the model replies with nothing.
7. **The concierge continues.** The server sees a last message that is the assistant's own. The model sees the `choose_visit` result `{status: 'requested', …}` and writes one short sentence (rule 5). The turn is not logged as a new inquiry (`resumed`).
8. **Result rendering.**
   - The form is replaced by `BookingCard`, a bordered link to `/visits/<ref>` showing reference, "Awaiting the boutique", boutique and time. Below it is LineChat.
   - Tool lines show `Local · choose_visit ✓ requested` and `MCP · request_appointment ✓` (a synthetic line, `PICKER_REQUEST_LINE`, because the browser's call is not in the conversation).
   - After Not now: "Closed without a request." / リクエストせずに閉じました。
   - A picker the customer moved past by typing: "No request sent." / リクエストは送信されていません。
9. **Guards** (`visit-picker.ts`):
   - Only the newest picker can send (`livePickerOf`): the last waiting picker in the newest message, if that message is the assistant's and no answered picker follows it in that message.
   - Send and the suggestions are disabled while a reply is streaming (`canSend = !busy`) and, through `onSending`, while the picker's request is on its way (`composerLocked`).
   - A picker still `input-streaming` with no reply coming in is a cut-off call, which gets a plain Try again.
   - `ignoreIncompleteToolCalls: true` on the server drops an unanswered picker from the next model request.
10. **Safety net (extra pass)** — a second model call on the same reply:
    - **Why.** In production the model once asked for the boutique, day and time in words instead of calling `choose_visit`.
    - **Conditions.** The turn ended whole, and all of these hold:
      - it is not a resume;
      - `asksToVisit(question)` is true;
      - no visit has been requested in this chat (`visitRequestedIn`);
      - the turn made no `choose_visit` call in any state, and no `my_appointments` call;
      - a piece is known: the page's `?product=`, or a slug returned by `search_products` or `view_product` earlier in the conversation or in this turn.
    - **`asksToVisit` (regex-based, English and Japanese).**
      - It counts first-person requests: "Can/Could/May I/we …", "I'd like to …", "I want to …", "let's book/schedule", "book it/one/a visit/an appointment". Each needs a visit verb: book, visit, schedule, reserve, make an appointment, come in/by, drop by, or "see <piece> in person / in store / in <city> / at the boutique".
      - Japanese: 予約したい, 予約できますか, 予約をお願い, 来店したい, 見に行きたい, and others. Some need a place or day in the same sentence: 伺いたい, 見られますか, 見たい, 行けますか.
      - Exclusions win over a request's words: "my visit/booking/appointment", cancel/change/move/reschedule/confirm/check/status, policy/cost/free/fee/charge, "need to", required, can't/don't/not now, "no thanks", "visiting hours", table/restaurant/hotel/taxi/flight. Japanese: 予約は必要, 予約の確認, キャンセル, 予約注文, and similar.
    - **Time budget.** `TURN_BUDGET_MS` = 55 s since the request start. The pass is skipped when under 5 s remain (a warning is logged), else it runs for up to 20 s (`PICKER_PASS_TIMEOUT_MS`).
    - **The pass.** Same model, instructions and tools, `activeTools: ['resolve_date','choose_visit']`, `toolChoice: 'required'`. After step 0 it forces `choose_visit` if not yet called (`prepareStep`). `stopWhen: [hasToolCall('choose_visit'), isStepCount(3)]`.
    - **Message tail.** Its messages are the conversation plus the turn's own response messages. Trailing assistant messages are popped, because Claude Sonnet 5 refuses a request that ends with an assistant turn (a prefill) with 400.
    - **Merging.** If it ends whole with a visible picker, its parts (without `start`) are merged into the same assistant message, and the first pass's `finish` is replaced by the extra pass's. If it fails, times out or shows no picker, the customer keeps the first reply and the server logs why (`NO_PICKER`).
    - **Logging and cleanup.** The turn is logged once, after both passes. The MCP client is closed after the extra pass and the log, and always on abort or error.

### 4.8 Hand-off to staff

- **Model path.** `search_knowledge` returns entries, or an empty `entries` array. If empty, the model calls `hand_off_to_staff {question, reason:'no_answer', productSlug?, locale}`. For "talk to a person" it uses reason `asked_for_person`.
- **Server safeguard** (`withAutoHandOff`), because the local model once searched, found nothing, skipped the call and wrote that the question was with advisors:
  - If a `search_knowledge` result comes back whole with `entries.length === 0` and there is a customer question, the app's own server calls `hand_off_to_staff` itself, with:
    - `question` = the customer's last message, trimmed and cut to 1000 (`lastQuestionOf`);
    - `reason:'no_answer'`;
    - `productSlug` from `pieceOfSearch`: the one slug the search named; or the page's piece if the search named none or included it; or none if several are named and the page's is not among them;
    - the chat's `locale`.
  - On success it adds a text content block ("No entry answers this, so the question was passed to Maison's client advisors as Q-####. Don't call hand_off_to_staff for it.") and a `structuredContent.handOff: {reference, question, product}` to the search result.
  - On failure the search result is returned unchanged and a warning is logged, unless the request was aborted.
  - Calls run one at a time through a promise queue. Once a question is recorded in this request, a later model `hand_off_to_staff` call is answered locally with the recorded one and doesn't reach Strapi. A failed call doesn't count, so a retry works.
  - It returns the tools unchanged if either tool is missing (a token without the permission).
- **Chat rendering** (`lib/tool-view.ts` `handOffAt`, `components/chat-parts.tsx` `HandOffNote`). One note per message. The first that applies wins:
  - `recorded`: under the first call that recorded the hand-off (the model's `hand_off_to_staff`, or a `search_knowledge` result carrying `handOff`). Text: "Thanks for asking! Give us a few minutes: one of our client advisors will message you here with the answer. (Q-4821)". A secondary button "Send it in the LINE chat" (`data-testid="hand-off-line"`) opens `lineMessageUrl`, with the typed text "Question for a Maison advisor (Q-4821): <question>", only if `NEXT_PUBLIC_LINE_OA_ID` is set.
  - If a `hand_off_to_staff` is still running, no note.
  - `empty_search`: the plain note, under the last `search_knowledge` that came back with no entries and had nothing recorded. Text: "Our team answers questions like this in Maison's LINE chat.", plus the LineChat button.
  - `failed_hand_off`: the same plain note, under the last failed `hand_off_to_staff`.
  - The plain notes never say the question is with the advisors. They always leave a path to a person.
  - The plain note only shows when no search in the message found entries and none is running. The last search decides, because the local model makes bad first calls.
- **After the turn.** `log_inquiry` is called by the app's server, not the model, once per customer message (not per resume). It carries message, reply, `knowledgeFound`, `handedOff`, `questionReference` and `productSlug`.
  - A picker note is appended to the logged reply: "(The concierge showed a visit picker so the customer can request a visit.)".
  - It has a 5 s timeout, never changes the customer's turn, and only warns on failure.
  - It is skipped if there is no `log_inquiry` tool, no question, or the turn was a resume.
- **What staff see in Strapi:** the Maison page has Requests, Questions and Inquiries tabs, and Strapi sends LINE messages itself. That is outside this app.

### 4.9 How the chat UI renders a message (`components/chat-parts.tsx`, `lib/tool-view.ts`, `lib/message-layout.ts`, `lib/chat-text.ts`)

- **User messages:** black blocks, right aligned, typed text only.
- **Assistant text:** `parseChatText` handles a small markdown subset only. It supports `**bold**`, line breaks, and numbered and bulleted lists (the model writes them despite being told not to). Everything else stays literal. The output is data rendered as React elements, never HTML. A blank line ends a paragraph or list, indented lines continue a list item, and ordered lists keep their own start number.
- **Tool lines** (`toolView`): one mono 11 px line per call, in `mist` grey (or `error` red when failed). Format: `MCP · <tool> <status>` or `Local · <tool> <status>`. Local tools are `resolve_date` and `choose_visit`.
  - Status is `…` while the call is coming in or running. `✓` on success, with an answer if available: `✓ Saturday 2026-10-10` for `resolve_date`, `✓ requested` or `✓ closed` for `choose_visit`, `✓ 5 results` for the first array in `structuredContent`. `✕ <code>` on failure.
  - A waiting picker shows no mark.
  - The status comes from `structuredContent`, never from the model's text.
  - MCP tools arrive as `dynamic-tool` parts with `toolName`. The app's own tools arrive as `tool-<name>` parts. `toolPartOf` normalizes both.
- **Product cards.** A `search_products` result shows the first 3 products as a 3-column grid of square photos with name and price, linked to `/products/<slug>`.
- **Message ordering** (`messageLayout`):
  - words appear as they came;
  - a run of tool lines stays together, with its cards (booking card, picker, hand-off note) directly below the run;
  - the photo grids found go at the end of the message, but never below a visit picker. They are inserted just before that picker's line, so pieces sit under the words that suggested them and above the form.
- **Retry on empty reply** (`needsRetry` in `lib/chat-retry.ts`), the local model "ends a turn with tool calls and no words":
  - The last message is the assistant's, nothing is streaming, and the last shown part isn't text. The chat shows "No reply came back." and a Try again button (`regenerate()`), with `data-testid="retry-reply"`.
  - It is never offered if the reply holds a `request_appointment` call that may have booked, a picker awaiting an answer or one that requested a visit, or a hand-off note that is an answer. Reason: asking again drops the booking and could double book. An empty reply after a failed hand-off, where the plain note is not an answer, does offer Try again.
  - A cut-off `choose_visit` (still `input-streaming` with no reply coming) never shows a form and gets Try again.
- **Errors.** A stream or request error shows an ErrorNote with the customer-facing copy by code. Model failures come through `toUIMessageStream({ onError: describeModelError })`. In mock mode the technical detail line shows too.
- **Suggestions.** Two chips normally:
  - EN: "I'm looking for a gift under ¥400,000 for a friend who travels. Could I see it in Ginza on Saturday at 2 pm?" and "Can I book a visit?".
  - JA equivalents.
  - From a product page: "Can I have it personalized?", "How do I care for it?", "Which boutique has it in stock?".
  - Chips are max 85% wide with a two-line clamp, and are disabled while locked.
  - The first one is the demo's scripted prompt: it runs `search_products`, then `resolve_date`, then `choose_visit` for Ginza, the next Saturday and 14:00.
- **Follow-scroll.** The conversation follows new words while within 80 px of the end, and stops following if the customer scrolls up. Sending a message or answering a picker resumes following.

---

## 5. Environment variables for `liff/`

Names only; values are never listed. `liff/.env` is created from `liff/.env.example` by `scripts/init-env.mjs`. `.env`, `.env.*` and `liff/line/qr/` are gitignored, and `liff/.vercelignore` keeps env files out of uploads.

**App and Strapi connection**
- `NEXT_PUBLIC_STRAPI_URL`: where the browser reaches Strapi (sign-in token exchange, `/mcp`) and the base for relative media URLs. Local mode: `http://localhost:<strapi port>`. LINE mode: the app's own https origin (the tunnel). Vercel production: the Vercel app's own origin, no trailing slash. Alternative: Strapi Cloud's URL directly, which requires `MAISON_APP_ORIGIN` on Strapi for CORS.
- `NEXT_PUBLIC_MAISON_CLIENT_ID`: the "Maison app" OAuth client ID. The app refuses to start without it. `npm run setup` writes it. Each run of setup creates a new one, so restart the app and reload.
- `STRAPI_URL`: server-side only. Where the app's server reaches Strapi (the concierge's MCP calls, the Home page text, the proxy). Default `http://127.0.0.1:1338`. In production it is the Strapi Cloud URL.

**LINE**
- `NEXT_PUBLIC_LIFF_MOCK`: any value except `false` runs the LIFF mock. `false` is real LIFF. It also opens the three proxy routes, and the `X-Maison-Liff` header reads it. Must be set explicitly to `false` in production, because `.env.example` has `true`.
- `NEXT_PUBLIC_LIFF_ID`: the LIFF ID for real sign-in and the Open-in-LINE link. Empty in local mode.
- `NEXT_PUBLIC_DEMO_LINE_USER_ID`: the mock customer's LINE user ID (`U` plus 32 hex). Set it to your own for option A so the mock acts as you. Mock mode only.
- `NEXT_PUBLIC_DEMO_LOCALE`: the fallback language (default `en`).
- `NEXT_PUBLIC_LINE_OA_ID`: the Official Account's basic ID with `@`, for the "Chat with Maison on LINE" and "Send it in the LINE chat" buttons. Empty means no buttons. It is built into the app, so rebuild after changing it.
- `LINE_MODE_LIFF_ID`, `LINE_MODE_CHANNEL_ID`, `LINE_MODE_DOMAIN`: inputs for `npm run mode:line`, `qr` and `tunnel`. Not read by the app at runtime. Leave unset on Vercel.
- `LINE_LOGIN_CHANNEL_ID`, `MOCK_LINE_VERIFY_PORT`: used by the local verify mock only. Defaults: channel `1234567890`, port `4545`. The channel must match `strapi/.env` in local mode.

**Concierge model**
- `ANTHROPIC_API_KEY`: use Claude Sonnet 5 directly.
- `AI_GATEWAY_API_KEY`: use Claude Sonnet 5 through the Vercel AI Gateway.
- `OLLAMA_MODEL` (default `qwen3-14b-32k`) and `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`): the local fallback when neither key is set.

**Test env.** `test:e2e` and `test:live` also load `../strapi/.env`, which supplies `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD`. `LIVE_MODEL=claude` selects Claude for live tests. `LINE_STAND_IN_PORT` is read by the stand-in script. `MAISON_E2E_ADMIN_JWT` is set at runtime by the e2e global setup.

**Root files.** The root `.env.cloud` is a separate, gitignored file with these names (values not read): `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `LINE_LOGIN_CHANNEL_ID`, `MAISON_SETUP_LIFF_ENV`, `MAISON_SETUP_OPS_TOKEN_FILE`, `STRAPI_URL`, `PUBLIC_URL`. These are the setup script's inputs.

**Strapi-side variables the rebuild must keep compatible** (from `docs/production.md` and `strapi/config/*.ts`): `LINE_LOGIN_CHANNEL_ID`, `LINE_VERIFY_URL` (local only), `MAISON_LIFF_URL`, `PUBLIC_URL`, `MAISON_APP_ORIGIN`, `LINE_CHANNEL_ACCESS_TOKEN`, `MAISON_LINE_API_BASE_URL` (stand-in only), `ENCRYPTION_KEY`, `MCP_ENABLED`, `AI_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `MAISON_DEMO_LINE_USER_ID`, plus Strapi's own secrets.

---

## 6. Tests

### 6.1 Unit (Vitest, `liff/vitest.config.ts`)

- **Config:** `include: ['lib/**/*.test.ts']`, environment `node`. `server-only` is aliased to Next's empty module.
- **Command:** `npm test` runs `vitest run`.
- **Coverage by file** (26 test files in `lib/`; test counts from grep, so approximate):
  - `concierge.test.ts` (~150): the whole `handleConcierge` route, covering:
    - auth and validation (401, 400, 413, 502);
    - the stream;
    - instructions (calendar, locale, piece paragraph);
    - `choose_visit` schema and its Strapi `not_found` pre-check;
    - `asksToVisit` English and Japanese, including exclusions;
    - the safety net (conditions, budget, parts merge, failure cases);
    - the auto hand-off on an empty knowledge search, and `hand_off_to_staff` once per request;
    - `turnFactsOf`, `turnReplyOf`, the end-of-turn `log_inquiry` (timeouts, cuts), and `describeModelError`;
    - `pieceSlugOf`, `withConversationLocale`.
  - `visit-picker.test.ts`: `pickerPrefill`, `livePickerOf`, `pickerViewOf`, `resumesAfterPicker` and `resumesOncePerAnswer`, `composerLocked`, `followScroll`.
  - `tool-view.test.ts`: line text, hand-off notes, `choose_visit`, `handOffAt` placement.
  - `booking.test.ts`, `format.test.ts`, `resolve-date.test.ts`, `chat-text.test.ts`, `message-layout.test.ts`, `chat-retry.test.ts`, `locale.test.ts`, `copy.test.ts`, `status.test.ts`.
  - `session.test.ts`: token exchange, retry-after, caching.
  - `mcp.test.ts` and `mcp.race.test.ts`: 401 retry and concurrent 401s on the real SDK client.
  - `liff.test.ts`: init inside LINE, outside LINE, with the mock, and `friendFlag`.
  - `maison.test.ts`: `getMaison`, `invalid_grant` handling, `onToolCall`.
  - `model.test.ts`: provider choice.
  - `home-page.test.ts`, `strapi-proxy.test.ts` (mock build, LINE build, `strapiOrigin`, `requireLocalMode`), `next-config.test.ts` (`X-Maison-Liff`), `line-chat.test.ts`, `line-app-url.test.ts`, `open-in-line.test.ts`, `qr-image.test.ts`, `tunnel.test.ts`.
- **`node --test` suites for scripts** (root `npm test`): `scripts/line-mode.test.mjs`, `line-tunnel.test.mjs`, `line-stand-in.test.mjs`, `maison-setup.test.mjs`, `home-page-starting-text.test.mjs`, `liff/scripts/line-qr.test.mjs`, `liff/scripts/mock-line-verify.test.mjs`.
- **Plugin tests** (`npm test --prefix strapi/src/plugins/maison` plus the `@strapi/utils` check) are outside `liff/`.
- `lib/**` tests are excluded from `tsconfig.json`, which also excludes `e2e`, `live` and the config files.

### 6.2 E2E (Playwright, `liff/playwright.config.ts`, `liff/e2e/`)

- **Config:**
  - `baseURL: http://localhost:3003`, viewport 390×844, one worker, 60 s timeout.
  - `webServer: npm run dev` with `reuseExistingServer`.
  - `globalSetup` signs in as the demo admin and POSTs `/maison/demo/reset`, which deletes every appointment, notification, question, inquiry and staff-added knowledge. It stores `MAISON_E2E_ADMIN_JWT` in the environment.
  - Traces are `retain-on-failure` with DOM snapshots off, so session tokens aren't stored.
- **Requirements:**
  - Strapi running in local mode on 1338.
  - `npx playwright install chromium` (about 276 MiB).
  - `requireLocalMode()` makes it refuse to run in LINE mode.
- **`maison.spec.ts`:**
  - books a visit via the product sheet and finds it in My visits, checking `request_appointment` carried `locale: 'en'`;
  - the booking sheet sends the customer's language (`ja`);
  - Osaka closed on Tuesdays, so the sheet says so before any request;
  - a boutique without the piece can't be chosen;
  - a day that has become today (using `page.clock` past Tokyo midnight) asks for a later one and sends nothing;
  - Home headline from Strapi, EN then JA after the switch;
  - Agent view shows `browse_collections` then `search_products`;
  - an unknown product says so and leads back to the start;
  - a second customer (`?demoUser=`) doesn't see the first's visits;
  - LINE chat button present or absent depending on `NEXT_PUBLIC_LINE_OA_ID` (two cases, run once each, the other skipped);
  - safe area: 34 px bottom in portrait, and 44 px sides plus 21 px bottom in landscape with the full 844 px width.
- **`api.spec.ts`:**
  - `my_appointments` only shows each customer's own visits;
  - the Content Manager's appointment list and search never expose a customer;
  - REST API tests (`/api/maison`): public catalog with no credentials, an unknown slug returns the tool's hint, and booking only works with a customer session.
  - It uses plain Node `fetch`, not Playwright's `request`, so Authorization headers are never printed.
- There are no e2e tests for the concierge UI. The concierge is covered by unit tests and the live tests.
- **Leaves behind:** a few open requests. Run Reset demo activity before going on stage.

### 6.3 Live tests (`liff/live/concierge.live.test.ts`, `liff/live/support.ts`, `vitest.live.config.ts`)

- **Config:** `include: ['live/**/*.live.test.ts']`, timeout 300 s, serial.
- **Command:** `npm run test:live`. Needs local mode, Strapi up, and the client ID from `npm run setup`.
- **Conditions:** it starts the verify mock if nothing answers on its port. It skips if the client ID is missing, Strapi is down, or the model isn't available. It calls the real `POST` route handler in-process with a `Request` and parses the SSE.
- **Local model (default).** Always Ollama, even with a Claude key set. Checks:
  - the demo gift question is answered from catalog tools, naming only products the tools returned (and at least one that fits the Ginza, travel, ≤¥400,000 filter);
  - the demo's first suggestion ends in a `choose_visit` picker for Ginza, the next Saturday in Tokyo, 14:00, after `resolve_date`, with pieces from a search in that turn. It asserts the reply doesn't say a visit is confirmed, or requested before the customer sends it, and names no other day;
  - "How do I care for the leather?" calls `search_knowledge`, finds the entry, and doesn't call `hand_off_to_staff`;
  - "Can I pay in bitcoin?" shows a hand-off note whose reference matches what Strapi recorded.
- **Claude** (`LIVE_MODEL=claude npm run test:live`, using `ANTHROPIC_API_KEY` or `AI_GATEWAY_API_KEY`; costs money). Checks:
  - "Can we schedule one?" from the Weekender 50 page gives one picker for that piece with no boutique, day or time filled in and no `resolve_date`;
  - the demo's first suggestion gives the same picker as on the local model;
  - Paul's 3 October production conversation (as sent by the page, with its `search_products` call in the history) followed by "I would like to book a visit to see cabin case" ends in a picker for the Cabin Case 55, from the model's own call or the extra pass, with the reply not claiming the visit is requested.
- **Reply checkers in `support.ts`:** `saysConfirmed` and `saysRequested` (English and Japanese clause-level regexes that ignore "once it is confirmed" and "tap Send request"), `datesIn`, `weekdaysIn`, `sseEvents`, `ensureVerifyMock`, `reachable`, `ollamaUp`, `strapiUp`. A "describe" block in the live file unit-tests those checkers without needing the network.
- **Leaves behind:** logged inquiries and an open question for staff.
- **Strapi's own suites** (`strapi/src/plugins/maison`): a live labelling test, integration tests that start Strapi in-process with a LINE push stand-in, and MCP smoke tests that mint tokens (which must be deleted afterwards).

### 6.4 Other scripts

- `liff/scripts/check-strapi-proxy.mjs`: an end-to-end check of the LINE-mode proxy against a stand-in Strapi. It checks streaming (first SSE event before the second, 1.5 s later), status and `Retry-After` pass-through, byte-for-byte images, that nothing else reaches Strapi (`/admin`, OAuth authorize and register, REST, `.well-known`, `_health`, `/uploads` climbs, over-1 MB 413, non-session `/mcp` 401, other grants 400), and that a mock build answers 404 on all three paths.
- `liff/scripts/render-channel-icon.mjs`: renders `liff/line/channel-icon.png`, a 130×130 px ink background with a white "M" in Jost 500, with the logo measured between 54 and 76 px, through headless Chromium.

---

## 7. Design

**Styling approach**
- **Tailwind CSS v3.4** (`tailwind.config.ts`, `postcss.config.mjs` with tailwindcss and autoprefixer), content `app/**` and `components/**`. There are no CSS modules and no CSS-in-JS. `app/globals.css` holds `@tailwind` layers, the LINE safe-area variables, and a `@layer components` block.
- **Components defined there** (all square, tap targets at least 44 px): `.wordmark`, `.eyebrow`, `.label`, `.btn-primary`, `.btn-secondary`, `.btn-text`, `.chip`, `.field`.
  - `.chip` has aria-pressed and aria-checked states, plus `:has(input:checked)` in a separate rule.
  - `.field` is an underline input at 16 px, so iOS doesn't zoom.
- **Black-and-white, no rounding, no shadows.**
  - `borderRadius: { none: '0px' }` and `boxShadow: { none: 'none' }` are the only values, so stray `rounded-lg` or `shadow-md` draw nothing. The one exception is the sheet's grab handle, which uses an arbitrary value.
  - Default border colour is `hairline`.
- **Colors:**

  | Name | Value | Use |
  |---|---|---|
  | `paper` | `#ffffff` | background |
  | `ink` | `#0a0a0a` | text and primary |
  | `graphite` | `#555555` | secondary text |
  | `mist` | `#737373` | captions (4.6:1 on white) |
  | `hairline` | `#e7e7e7` | rules and borders |
  | `wash` | `#f4f4f4` | image placeholders, quiet surfaces, stage page background |
  | `error` | `#b42318` | errors |

  The `accent-color` for radios is ink.
- **Fonts**, self-hosted from `@fontsource` with no CDN:
  - `sans`: Jost, then Zen Kaku Gothic New, then Hiragino Sans, then system-ui. Jost 300/400/500 and Zen Kaku Gothic New 300/400/500 are loaded.
  - `mono`: `ui-monospace`, SF Mono, Menlo, then Zen Kaku Gothic New. Used for tool lines, references and the agent view.
  - There is no serif. `font-serif` draws nothing, and Cormorant Garamond is installed but not imported.
  - Bold is mapped to weight 500, the heaviest loaded.
  - `:lang(ja) h1, h2` use `word-break: auto-phrase`.
- **Type scale** (custom font sizes):

  | Name | Size | Notes |
  |---|---|---|
  | `wordmark` | 17 px | 0.42em tracking, weight 500 |
  | `nav` | 11 px | 0.14em tracking |
  | `eyebrow` | 11 px | 0.18em tracking |
  | `button` | 12 px | 0.2em tracking, weight 500 |
  | `body` | 14 px | line-height 1.6 |
  | `title` | 24 px | weight 400 |
  | `headline` | 31 px | weight 300, -0.01em tracking |

- **Custom screens** (media queries):
  - `stage`: `(min-width:500px) and (hover:hover) and (pointer:fine)`, the laptop phone-frame mode.
  - `short`: `(orientation:landscape) and (min-width:500px) and (max-height:500px)`, a phone in landscape.

**LINE MINI App guidelines followed** (`docs/line-mini-app.md`)
- **Icon.** `liff/line/channel-icon.png`, 130×130, logo within 54–76 px (`render-channel-icon.mjs`).
- **Safe area** (`globals.css`, applied to the frame, headers, bars and the agent drawer):
  - `--line-safe-bottom: 34px` and `--line-safe-x: 0` in portrait;
  - `--line-safe-x: 44px` and `--line-safe-bottom: 21px` in landscape (orientation landscape and min-width 500);
  - both 0 on the stage laptop;
  - the header uses `top-[env(safe-area-inset-top,0px)]`.
  - Landscape is detected as at least 500 px wide, so a phone held upright with a soft keyboard doesn't shift the app sideways.
- **Loading icon.** LINE's own `public/line/LINE_spinner_light.svg`, 30×30 centred (16 px inside the busy button).
- **LIFF behaviour.**
  - `liff.init()` runs at or below the endpoint URL.
  - Outside LINE the app never starts LINE Login and shows "Open in LINE".
  - An expired ID token (they last an hour) leads to logout and reload, LINE's own pattern.
- **Still to do before LINE review.** A MINI App must work in an external browser without LINE Login, but every screen here needs a session. Lighthouse Performance must be 50 or more. The MINI App policy, a channel description and a privacy policy are needed. Test scenarios are required for a reservation service.
- **Channel rules.** The channel name can't contain "LINE" (it is named Maison). A MINI App's size is always Full. LIFF scopes are `openid` and `profile`. LIFF Add friend option is on (Normal) once the Official Account is linked. The MINI App and Messaging API channels must be in the same provider, or user IDs won't match.
- **Opening URLs.** An unverified MINI App opens at `https://miniapp.line.me/<LIFF ID>`; `https://liff.line.me/<LIFF ID>` also works. Confirmation links use `MAISON_LIFF_URL` plus `/visits/<reference>`.

**Image handling**
- Catalog images come from Strapi media (`/uploads/...`), with URLs in the tool results (`heroImageUrl`, `imageUrl`, `images[].url`).
- `mediaUrl()` leaves absolute URLs alone and prefixes relative ones with `NEXT_PUBLIC_STRAPI_URL`. In LINE mode `/uploads/*` is proxied by the app.
- `ProductImage` renders a plain `<img>` with `width=1200 height=1200`, `decoding="async"`, optional `loading`, `object-cover` and `bg-wash`. The 1200 px square is a design assumption, with one file per photo and no `srcset`, so there is no `sizes`. The box's CSS (`aspect-square`, or `h-60` for Home bands) holds the layout.
- A null URL renders a `bg-wash` div, aria-hidden. List photos use `alt=""` because the adjacent name is the link text. Only the product page's hero has real alt text (`images[0].alt`, falling back to the name).
- Eager for the first Home band and the first 4 grid items; lazy otherwise.

---

## 8. Deployment (Vercel)

From `docs/production.md`, `liff/vercel.json` and `liff/.vercelignore`.

- **Project.** A Next.js project on Vercel with the root directory set to `liff/`.
- **`liff/vercel.json`:** `{ "framework": "nextjs", "regions": ["iad1"] }`. `iad1` is Washington, D.C., chosen close to the Strapi Cloud project; change it to the region nearest yours.
- **`liff/.vercelignore`:** excludes `.env`, `.env.*` (except `.env.example`), `.vercel`, `.next`, `node_modules`, `playwright-report`, `test-results`, `line/qr` and `*.tsbuildinfo`.
- **Function duration:** `maxDuration = 60` s on the concierge route (a Vercel plan that allows 60 s is needed).
- **Build output:** none beyond the defaults. There is no `output: 'standalone'` and no custom headers other than `X-Maison-Liff`.
- **Settings are Vercel project environment variables** (Settings, Environment Variables). Redeploy after any change, because `NEXT_PUBLIC_*` are baked in at build time.

| Variable | Production value / note |
|---|---|
| `NEXT_PUBLIC_LIFF_MOCK` | `false`. Required. Also turns on the app's three proxy routes. Any other value runs the mock, which production Strapi refuses |
| `NEXT_PUBLIC_LIFF_ID` | The production LIFF app's ID. The LIFF endpoint URL is the Vercel app's URL |
| `NEXT_PUBLIC_STRAPI_URL` | The Vercel app's own https origin, no trailing slash. The app proxies `/mcp`, the token endpoint and `/uploads` to `STRAPI_URL`. The alternative is the Strapi Cloud URL directly, which needs `MAISON_APP_ORIGIN` set on Strapi |
| `NEXT_PUBLIC_MAISON_CLIENT_ID` | The client ID from the Strapi Cloud setup, step 9 |
| `STRAPI_URL` | The Strapi Cloud https URL, no trailing slash. The default `http://127.0.0.1:1338` doesn't exist on Vercel |
| `ANTHROPIC_API_KEY` or `AI_GATEWAY_API_KEY` | Secret. One is required, or the concierge tries Ollama on localhost, which doesn't exist on Vercel. `ANTHROPIC_API_KEY` wins if both are set |
| `NEXT_PUBLIC_LINE_OA_ID` | Optional but recommended: the Official Account's basic ID with `@` |
| `NEXT_PUBLIC_DEMO_LOCALE` | Optional, default `en` |

- **Leave unset on Vercel:** `NEXT_PUBLIC_DEMO_LINE_USER_ID`, `OLLAMA_MODEL`, `OLLAMA_BASE_URL`, `LINE_MODE_LIFF_ID`, `LINE_MODE_CHANNEL_ID`, `LINE_MODE_DOMAIN`, `LINE_LOGIN_CHANNEL_ID`, `MOCK_LINE_VERIFY_PORT`.
- **Strapi Cloud** is the other half (not in `liff/`):
  - Base directory `strapi`, Node 22.12 or later, and the Variables listed above.
  - `LINE_VERIFY_URL` is ignored in production, so LINE verifies every ID token.
  - First-time setup is by hand, and `npm run setup` is never run against Cloud:
    - the first admin;
    - load the demo catalog;
    - tick the Public role actions (the Maison catalog reads and Home-page `find`);
    - create the "Maison customer" admin token (4 actions) and optionally the "Maison ops" token;
    - create the "Maison app" OAuth client with "LINE sign-in" and map it to the customer token. A client can only map a token its creator owns, and deleting the customer token ends every session.
  - Keep the customer token's owner admin active.
- **Production notes that affect a rebuild:**
  - Serve everything over https.
  - REST customer routes skip two of `/mcp`'s checks, so keep sessions short with `endUserAccessTokenTtl`.
  - The concierge route has no rate limiting beyond the caps above. The Strapi caps of 3 open visit requests and 5 open questions per customer apply.
  - Publishing the LINE Login channel opens the app to anyone with LINE. Each visitor then becomes a customer: Strapi stores their full LINE user ID, a hash of the session token, the client ID and expiry. Appointments and questions store the full LINE user ID too. Staff see it masked.
  - The ID token is never stored. Strapi checks it with LINE and keeps only the user ID.

---

## 9. Rebuild-relevant observations and pitfalls

1. **Keep the browser to Strapi path identical in both modes.** The browser always talks to `NEXT_PUBLIC_STRAPI_URL`. In LINE mode and on Vercel that is the app's own origin, backed by the 3-path proxy that is only built when `NEXT_PUBLIC_LIFF_MOCK === 'false'`. In TanStack Start, replace the three Next route handlers with server routes. Keep the closed-by-default behaviour (404 unless LINE build) and the header and body allowlists, because the tunnel safety checks depend on them (`X-Maison-Liff` and the forged-token probe).
2. **The Home screen is the only server-rendered piece with a per-request Strapi call.** Both languages are fetched on the server and shipped to the client. Replace `connection()` and `server-only` with a TanStack Start server function or loader that is not cached.
3. **No strict mode.** The agent view and tool-call recording assume effects run once. In TanStack Start (Vite and React), don't wrap in `<StrictMode>`, or de-duplicate records.
4. **The AI SDK 7 API is newer than much documentation.** `instructions`, `isStepCount`, `onEnd`, `toUIMessageStream` and `createUIMessageStreamResponse` are used. The client uses `@ai-sdk/react ^4` `useChat` with `DefaultChatTransport`, `addToolOutput` and `sendAutomaticallyWhen`. Match the installed versions.
5. **The concierge is the app's only real backend logic.** It runs the model, merges the extra pass's parts into one assistant message, and logs the inquiry before closing the MCP client. It needs a long-running server function (60 s, SSE streaming) in TanStack Start (Vercel or Nitro). Make sure the host doesn't buffer SSE.
6. **Dates are Tokyo-calendar everywhere.** Use the fixed +9 h shift helpers in `lib/format.ts` rather than local time, both client-side (chips, `nextSaturday`, `tomorrow`) and server-side (prompt calendar, `resolve_date`). `useToday()` re-evaluates at Tokyo midnight.
7. **The session token is in memory only.** It is re-exchanged from the LINE ID token on 401 or within 60 s of expiry. There is no refresh token. `liff.logout()` and reload is the only recovery from `invalid_grant`, rate-limited to once a minute with `sessionStorage`.
8. **Two different model IDs appear in the repo.** The customer concierge uses `claude-sonnet-5` (and `anthropic/claude-sonnet-5` through the gateway). Strapi's staff chat defaults to `claude-sonnet-5-5`, and the inquiry labeller defaults to `claude-haiku-4-5-20251001`.
9. **Tool names the customer UI relies on:** `browse_collections`, `search_products`, `view_product`, `find_boutiques`, `request_appointment`, `my_appointments` in the browser; plus `search_knowledge`, `hand_off_to_staff`, `log_inquiry` and the local `resolve_date` and `choose_visit` in the concierge. The Strapi plugin may be shared unchanged.
10. **Persisted client state:**
    - `localStorage`: `maison.locale` (`ja`/`en`), `maison.agentView` (`on`/`off`).
    - `sessionStorage`: `maison.demoUser`, `maison.signedInAgainAt`.
    - Nothing else is persisted. Chat history is in memory only and is lost on reload.
11. **Docs versus code mismatch.** `docs/architecture.md`'s token-endpoint table omits `resource`, which the code sends.
12. **No `not-found` or global error pages exist.** The only "not found" handling is per screen, through the tool errors. A TanStack Start rebuild should decide whether to add routes for unknown paths.

**Key file index** (all under `/Users/paul/work/maison-demo/`)
- App pages: `liff/app/{layout,page}.tsx`, `liff/app/collections/[slug]/page.tsx`, `liff/app/products/[slug]/page.tsx`, `liff/app/visits/page.tsx`, `liff/app/visits/[reference]/page.tsx`, `liff/app/concierge/page.tsx`.
- Server routes: `liff/app/api/concierge/route.ts`, `liff/app/mcp/route.ts`, `liff/app/uploads/[...path]/route.ts`, `liff/app/api/strapi-oauth-mcp-manager/oauth/token/route.ts`.
- Config: `liff/next.config.mjs`, `liff/tailwind.config.ts`, `liff/app/globals.css`, `liff/vercel.json`.
- Core logic in `liff/lib/`: `concierge.ts`, `model.ts`, `visit-picker.ts`, `tool-view.ts`, `chat-retry.ts`, `resolve-date.ts`, `booking.ts`, `mcp.ts`, `session.ts`, `liff.ts`, `maison.ts`, `strapi-proxy.ts`, `copy.ts`, `format.ts`, `home-page.ts`, `line-chat.ts`.
- Components: `liff/components/` (screen, header, provider, drawer, booking form and sheet, visit picker, chat parts, open-in-line, line-chat).
- LINE tooling: `liff/scripts/mock-line-verify.mjs`, `liff/scripts/line-qr.mjs`, `liff/scripts/check-strapi-proxy.mjs`, `liff/scripts/render-channel-icon.mjs`, `scripts/line-mode.mjs`, `scripts/line-tunnel.mjs`, `scripts/line-stand-in.mjs`, `scripts/init-env.mjs`.
- Tests: `liff/lib/*.test.ts`, `liff/e2e/*.ts`, `liff/live/*.ts`, `liff/vitest.config.ts`, `liff/vitest.live.config.ts`, `liff/playwright.config.ts`.
- Strapi side (reference): `strapi/src/plugins/maison/server/src/mcp/{schemas.ts,tools/*.ts}`, `strapi/config/plugins.ts`, `strapi/config/middlewares.ts`, `strapi/src/api/home-page/content-types/home-page/schema.json`.
- Docs: `README.md`, `docs/{architecture,line-setup,line-mini-app,testing,production}.md`.