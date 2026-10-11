# Maison: a luxury house's catalog over Strapi MCP

The Maison plugin of [Maison on TanStack](../../../../README.md). It is a Strapi 5 plugin that shows one content model serving people and AI agents. It adds a fictional luxury house, "Maison": collections, products, boutiques and stock. Signed-in customers can request boutique visits, and staff review and confirm them.

- **Thirteen MCP tools and one MCP prompt** on Strapi's `/mcp`, each gated by a permission you grant per token
- **REST routes at `/api/maison`** for websites: the catalog under Strapi's role permissions, and bookings for the signed-in LINE customer, on the same services, input checks and sign-in as the tools
- **A human gate:** agents can request appointments, but only staff confirm them
- **Customer questions for staff:** when the concierge can't answer, Strapi records the question, staff let the customer know or answer on LINE in their own name, and an answer can become product knowledge ([Customer questions](#customer-questions))
- **Customer inquiries:** every concierge turn is recorded, a model labels it in the background, and staff work the queues on the Maison page and reply on LINE ([Customer inquiries](#customer-inquiries))
- **Customer identity comes from sign-in, never from the model**, through [strapi-oauth-mcp-manager](https://github.com/PaulBratslavsky/strapi-oauth-mcp-manager) 1.1 and LINE
- **Every model call in the plugin goes through [TanStack AI](https://tanstack.com/ai):** inquiry labelling and the staff assistant ([Labelling](#labelling), [The assistant drawer](#the-assistant-drawer))
- **The assistant drawer:** a chat for staff, in a drawer on every admin page, that looks up requests, questions, inquiries and the catalog, answers in Markdown with tables, shows each lookup in a box, and saves each admin's chats ([The assistant drawer](#the-assistant-drawer))
- **A live requests board and demo data** in the admin panel, with content in Japanese and English

Maison is fictional. The plugin uses no real brand's names, products or images.

## Five surfaces, one set of services

| Surface | Who uses it | What decides access |
|---|---|---|
| MCP tools on `/mcp` | The customer app, its AI concierge, an ops agent in Claude Desktop | The admin token's Maison permissions |
| REST routes at `/api/maison` | Websites and other apps | The catalog: a role or API token holding its action. Bookings: a LINE customer session |
| The Maison admin page and Homepage widget | Staff | The admin's role |
| The assistant drawer | Staff | The admin's role, tool by tool |
| The Content Manager | Staff | Content Manager permissions |

The tools, the REST routes, the board, the Homepage widget and the staff assistant call the same services, so they give the same answers. The Content Manager goes through the Document Service instead, with the same validation on create and update.

Confirming a request is one act wherever it happens: the `confirm_appointment` tool, the board's **Confirm** button and **Publish** in the Content Manager all publish the appointment, and Strapi then sends the customer the LINE confirmation ([LINE confirmations](#line-confirmations)). One difference: **Publish** in the Content Manager doesn't check the visit time, so it can confirm a visit that has already passed.

## Requirements

- Strapi `^5.57.0` (this project pins 5.57.0), with the MCP server enabled: `mcp: { enabled: true }` in `config/server.ts`
- The i18n plugin, which is on by default
- Node 22.12 or later. TanStack AI ships as ES modules only, and the plugin's server is CommonJS, so the plugin loads it with one cached dynamic `import()` ([TanStack AI in the plugin](#tanstack-ai-in-the-plugin))
- For the customer tools and the customer routes, strapi-oauth-mcp-manager 1.1 with LINE sign-in configured. Without it, those tools answer `not_signed_in` and those routes answer 503.
- For the assistant drawer, an Anthropic API key in `AI_API_KEY`, with `AI_PROVIDER` unset or `anthropic` ([The assistant drawer](#the-assistant-drawer))
- The `@strapi/utils` of the Strapi app must be the copy the plugin loads. In this project, `strapi/scripts/share-strapi-utils.mjs` removes the plugin's own copy ([Install](#install))

## Install

Maison lives in this repository, in `strapi/src/plugins/maison`. The project's Strapi loads it as a local plugin from `strapi/config/plugins.ts`:

```ts
// strapi/config/plugins.ts (shortened: every value is trimmed, and an empty value counts as unset)
maison: {
  enabled: true,
  resolve: 'src/plugins/maison',
  config: {
    liffUrl: env('MAISON_LIFF_URL', '').trim() || null,
    lineChannelAccessToken: env('LINE_CHANNEL_ACCESS_TOKEN', '').trim() || null,
    lineApiBaseUrl: env('MAISON_LINE_API_BASE_URL', '').trim() || null,
    aiProvider: env('AI_PROVIDER', '').trim() || null,
    aiModel: env('AI_MODEL', '').trim() || null,
    aiChatModel: env('AI_CHAT_MODEL', '').trim() || null,
    aiApiKey: env('AI_API_KEY', '').trim() || null,
    aiBaseUrl: env('AI_BASE_URL', '').trim() || null,
    demoLineUserId: env('MAISON_DEMO_LINE_USER_ID', '').trim() || null,
  },
},
```

- **`npm install` at the repository root** installs `strapi/`. Its `postinstall` installs and builds the plugin, then runs `node scripts/share-strapi-utils.mjs`. The plugin runs from its `dist/` folder.
- **Maison shares Strapi's `@strapi/utils`.** The plugin is a local plugin with its own dependencies, so its build would load its own copy, and a validation error raised in its document middleware would not be core's. The Content Manager would then answer 500 where it should answer 400 (`test/integration/validation-errors.test.mjs` holds this). The script removes the plugin's copy, and `node strapi/scripts/share-strapi-utils.mjs --check` fails when it is back. `npm run develop`, `npm run start` and the integration suites run the check first.
- **After any `npm install` in the plugin's own folder,** run `node scripts/share-strapi-utils.mjs` from `strapi/`.
- **To use the plugin in another Strapi app,** copy this folder into that app's `src/plugins/maison`, install it, add the entry above to `config/plugins.ts`, and apply the same `@strapi/utils` sharing step.

Start Strapi. Open **Maison** in the admin menu and choose **Load demo catalog** under **Demo data**, then **Load demo activity** for requests, questions and inquiries to show ([Load demo activity](#load-demo-activity)). `npm run setup` at the repository root does the catalog step for you.

## Configuration

| Key | Default | Purpose |
|---|---|---|
| `liffUrl` | `null` | Base of the links in LINE confirmations, e.g. `https://liff.line.me/<LIFF ID>`. Use `http://localhost:<port>` for local development. Until it's set, Strapi sends no confirmations and `pending_confirmations` answers `not_configured`. An empty value counts as not set. |
| `timezone` | `Asia/Tokyo` | Opening-hours checks, the times in messages, and the day of the `date` filter |
| `defaultLocale` | `ja` | Content language when a tool call doesn't pass `locale` (`ja` or `en`) |
| `maxOpenRequestsPerCustomer` | `3` | Unconfirmed future requests a customer may have |
| `houseName` | `{ ja: 'メゾン', en: 'Maison' }` | Header of the LINE confirmation, in the visit's language |
| `disabledTools` | `[]` | Tool names to leave out of MCP. In the assistant drawer it removes the catalog tools it names (`search_knowledge`, `search_products` and `view_product`) and affects no other tool. |
| `lineChannelAccessToken` | `null` | The channel access token of your LINE Messaging API channel, which Strapi sends confirmations and staff's answers to customer questions with: `env('LINE_CHANNEL_ACCESS_TOKEN', null)`. Without it, Strapi sends none. An empty value counts as not set. |
| `lineApiBaseUrl` | `https://api.line.me` | Where Strapi sends them. Any https URL, or `http://127.0.0.1:<port>` and `http://localhost:<port>` for a stand-in in tests. No trailing slash. |
| `aiProvider` | `anthropic` | The provider of the model that labels inquiries: `anthropic` or `ollama`: `env('AI_PROVIDER', '')`. Both go through TanStack AI. An empty value counts as not set. |
| `aiModel` | the provider's own | A model ID: `env('AI_MODEL', '')`. Without one, it's `claude-haiku-4-5-20251001` for `anthropic` and `qwen3-14b-32k` for `ollama`. |
| `aiChatModel` | `claude-sonnet-5-5` | The model of the assistant drawer's chat, an Anthropic model ID: `env('AI_CHAT_MODEL', '')`. It is not `aiModel`, which labels inquiries. The chat uses `aiApiKey`, and is ready only when `aiProvider` is `anthropic` ([The assistant drawer](#the-assistant-drawer)). An empty value counts as not set. |
| `aiApiKey` | `null` | The provider's API key: `env('AI_API_KEY', '')`. Only Anthropic uses it: it is never sent to an Ollama host. Without it, and for `ollama` without `aiBaseUrl`, labelling is off ([Labelling](#labelling)). |
| `aiBaseUrl` | `null` | The Ollama host, such as `http://127.0.0.1:11434`: `env('AI_BASE_URL', '')`. Only the `ollama` provider uses it. An http or https URL, with no trailing slash and no `/v1` path. |
| `demoLineUserId` | `null` | Optional. Your own LINE user ID, `U` and 32 lowercase hex characters: `env('MAISON_DEMO_LINE_USER_ID', '')`. With it, [Load demo activity](#load-demo-activity) gives your LINE account one waiting request, one open question and one open complaint, so confirming and replying send real LINE messages to your phone. Any other value is ignored, with a warning at boot that names the setting and never the value, and the demo activity goes to made-up customers only. Never logged, and masked in the admin like every customer, with a "Your LINE" label next to your own rows. An empty value counts as not set. |

## Tools

| Tool | Permission | What it does |
|---|---|---|
| `browse_collections` | MCP: browse the catalog | Published collections, with a teaser and product count |
| `search_products` | MCP: browse the catalog | Products by collection, category, gift occasion, price, personalization and boutique stock |
| `view_product` | MCP: browse the catalog | One product: story, dimensions, personalization, stock per boutique |
| `find_boutiques` | MCP: browse the catalog | Boutiques, opening hours, open on a date, stock for chosen products |
| `search_knowledge` | MCP: browse the catalog | What Maison has written down for customers, such as care, sizing, delivery, repairs, warranty and gift wrapping: the best four published entries for a question, or none |
| `request_appointment` | MCP: request and view own appointments | Creates a **draft** visit request for the signed-in customer, and names the boutique and products in the customer's `locale`, which the visit keeps for its LINE confirmation |
| `my_appointments` | MCP: request and view own appointments | The signed-in customer's own requests and confirmations |
| `hand_off_to_staff` | MCP: hand questions to staff | Hands the signed-in customer's question to Maison's client advisors, with the piece it is about when it is about one, and answers a reference like `Q-4821`. Strapi sends the customer nothing: staff reply in the LINE chat ([Customer questions](#customer-questions)). Five questions can wait for one customer at a time, and asking one again that is still waiting answers its reference |
| `log_inquiry` | MCP: log customer inquiries | Records one concierge turn for staff: the customer's message and the concierge's reply, and whether knowledge was found or the turn handed the question off. The customer app's server calls it after each turn, with the customer's session. It isn't for the concierge to call, and the staff assistant doesn't offer it ([Customer inquiries](#customer-inquiries)) |
| `appointment_requests` | MCP: review appointment requests | Requests for staff, by default the ones still waiting. Customers are masked. |
| `confirm_appointment` | MCP: confirm appointment requests | Confirms a request by publishing it, which sends the customer's LINE confirmation, once |
| `pending_confirmations` | MCP: send appointment confirmations | Confirmed upcoming visits whose confirmation hasn't gone out, each with a ready LINE flex message |
| `record_confirmation` | MCP: send appointment confirmations | Records whether a LINE confirmation was delivered |

**Product knowledge** is a content type, `plugin::maison.knowledge`, localized with draft and publish. Each entry has a title, an answer of up to 2,000 characters, a category, the products it's about (`productSlugs`, empty for every piece) and keywords. `search_knowledge` scores published entries on the question's words: in the title most, then the keywords, then the answer. With `productSlugs`, it leaves out entries about other pieces, and an unknown or unpublished product is `not_found`. A search in `ja`, the default locale, reads only the Japanese versions. A search in `en` reads the English versions, and an entry's Japanese version where it has no English one.

**Load demo catalog** adds 16 entries in English and Japanese, also to a catalog loaded before. It first reads what is missing, and answers at once: `200` with all zeros when everything is there, or `202` with `started: true` and what it will add, which it then writes in the background ([Load demo activity](#load-demo-activity) works the same way). Each entry is one document with an `en` and a `ja` version: the title, answer and keywords are in each language, and the category and products are shared. The content is in `server/seed/knowledge.json`, each entry's Japanese version under `ja`.
- **English:** it adds the 16 English entries only when no English entry exists, so if it stops partway through them, delete the English product knowledge entries and press **Load demo catalog** again.
- **Japanese:** then it finds each entry's English document by its English title, and when that document has no Japanese version, adds one and publishes it, four entries at a time. A Strapi that has only the English entries gets the 16 Japanese versions, and pressing again adds nothing.
- **Staff changes stay:** an entry whose English title staff changed is skipped, and the entries staff added by answering questions are never changed.
- **The result:** Strapi answers `knowledge`, the English entries it adds, and `knowledgeJa`, the Japanese versions, and the page's notice names both. The log says what was added once it has finished, and a failure partway is logged as an error: press **Load demo catalog** again, since it adds only what is missing. A press while a load is still running answers `409` with `already_loading` and starts nothing. `npm run setup` presses again every second until everything is there.

The **`send_pending_confirmations` prompt** tells an ops agent how to deliver confirmations with [LINE Bot MCP](https://github.com/line/line-bot-mcp-server): the ones Strapi couldn't send, since Strapi sends them itself. It checks that each customer is reachable (`get_profile`) before pushing, because LINE's push API answers 200 even when it can't deliver. The prompt drives both `pending_confirmations` and `record_confirmation`, so disabling either one in `disabledTools` also drops the prompt. Strapi's start-up log says how many tools and prompts Maison registered.

**Errors don't throw.** They come back as `isError` results whose text is `{"error":{"code","message","hint"}}`. The codes are `not_signed_in`, `not_found`, `invalid_input`, `boutique_closed`, `in_the_past`, `too_many_open_requests`, `too_many_open_questions` (MCP only: no REST route hands off a question), `not_published` and `not_configured`. The hint says what to do next.

One exception on MCP: arguments that fail the MCP SDK's schema check, such as a date that isn't on the calendar, come back as plain text (`Input validation error: …`), not in the JSON error shape. Errors from the tools themselves are always JSON.

## Three doors, one service layer

Maison's services sit behind three HTTP doors. Each door checks who is calling in its own way, then calls the same services with the same input checks.

| Door | Path | For | Who may call |
|---|---|---|---|
| REST routes | `/api/maison/…` | Websites and other apps | The catalog: a role or API token. Bookings: a LINE customer session |
| Admin routes | `/maison/…` | The Maison page and the Homepage widget | Admins whose role holds the action |
| MCP tools | `/mcp` | Agents | Admin tokens with Maison permissions |

### The REST routes

| Route | Mirrors | Access |
|---|---|---|
| `GET /api/maison/collections` | `browse_collections` | `plugin::maison.collections.find` |
| `GET /api/maison/products` | `search_products` | `plugin::maison.products.find` |
| `GET /api/maison/products/:slug` | `view_product` | `plugin::maison.products.findOne` |
| `GET /api/maison/boutiques` | `find_boutiques` | `plugin::maison.boutiques.find` |
| `GET /api/maison/knowledge` | `search_knowledge` | `plugin::maison.knowledge.find` |
| `POST /api/maison/appointments` | `request_appointment` | A LINE customer session |
| `GET /api/maison/my-appointments` | `my_appointments` | A LINE customer session |

Each route takes its tool's input, checks it with the same schema (`server/src/mcp/schemas.ts`), and answers with the tool's structured content:
- **Query parameters** have the tool's argument names, limits and checks: `?occasion=travel&maxPriceJpy=400000&locale=en`.
- **A list repeats its parameter:** `?productSlugs=weekender-50&productSlugs=passport-cover`. One is a list of one. A comma-separated list isn't split, so it fails the slug check.
- **`locale`** is `ja` or `en`, and defaults to `defaultLocale`, as on the tools. A booking takes it in the body.
- **The booking body** is `request_appointment`'s input, as JSON: `boutique`, `productSlugs`, `requestedFor`, and an optional `note` and `locale`. The `locale` picks the language of the boutique and product names in the answer, and of the visit's LINE confirmation. Any other field is ignored, a customer included.
- **A booking** answers 201 with `{ "appointment": … }`. The requests board shows it as made via `web`.

```bash
STRAPI=http://localhost:1339   # this project's Strapi; a stock Strapi listens on 1337

# The catalog, once a role holds its actions (below)
curl "$STRAPI/api/maison/collections?locale=en"
curl "$STRAPI/api/maison/products?occasion=travel&maxPriceJpy=400000&inStockAt=ginza&locale=en"
curl "$STRAPI/api/maison/products/weekender-50?locale=en"
curl "$STRAPI/api/maison/boutiques?productSlugs=weekender-50&productSlugs=passport-cover&date=2026-10-10"
curl "$STRAPI/api/maison/knowledge?query=How%20do%20I%20care%20for%20the%20leather%3F&locale=en"

# Bookings, with a customer's LINE session
curl -X POST "$STRAPI/api/maison/appointments" \
  -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
  -d '{"boutique":"ginza","productSlugs":["weekender-50"],"requestedFor":"2026-10-10T14:00:00+09:00","note":"A gift","locale":"en"}'
curl -H "Authorization: Bearer $SESSION" "$STRAPI/api/maison/my-appointments?locale=en"
```

**Errors** are `{ "error": { "code", "message", "hint" } }`, with the code, message and hint the tool would return. The hints are the tools' own words, so a tool they name stands for its route: `search_products` is `GET /products`.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_input` | The shared schema rejects a value (no hint; MCP answers these as `Input validation error: …`), or a minimum price is above the maximum |
| 401 | `not_signed_in` | A customer route has no LINE customer session. Sent with `WWW-Authenticate: Bearer` |
| 404 | `not_found` | An unknown product, collection or boutique |
| 409 | `boutique_closed`, `too_many_open_requests` | The same request can succeed once something changes: the boutique's hours, or one of the customer's open requests |
| 422 | `in_the_past` | The visit starts less than 30 minutes from now |
| 503 | `not_configured` | Customer sign-in isn't configured: oauth-mcp-manager 1.1 isn't installed |
| 503 | `temporarily_unavailable` | Checking a customer's session failed on the server, such as a database error. It isn't a sign-out: try again. Only the REST door has this code |

Strapi answers some requests itself, in its own error body: a 403 when no role or token holds a catalog action, and a 401 for a bearer token it doesn't recognize on a catalog route.

### Grant the catalog

The catalog routes use Strapi's content-API permissions, so a request needs one of these:
- **A role holding their actions,** under **Settings → Users & Permissions plugin → Roles**: **Public** for a public website.
- **A read-only, full-access or custom API token,** under **Settings → API Tokens**. A custom token needs the actions. A read-only token can call them because they're named `find` and `findOne`, the only actions Strapi lets a read-only token call.

The five actions:
- `plugin::maison.collections.find`, for `GET /collections`
- `plugin::maison.products.find`, for `GET /products`
- `plugin::maison.products.findOne`, for `GET /products/:slug`
- `plugin::maison.boutiques.find`, for `GET /boutiques`
- `plugin::maison.knowledge.find`, for `GET /knowledge`

The list there also shows the two customer actions, `plugin::maison.customer.requestAppointment` and `plugin::maison.customer.myAppointments`. Roles don't apply to them, so granting them opens nothing.

These actions aren't the admin token permissions under Tokens. "MCP: browse the catalog" (`plugin::maison.catalog.read`) gates the tools only.

### The customer session

The customer routes take the same session as the MCP tools: the access token oauth-mcp-manager issues for a customer's LINE sign-in. The routes set `auth: false`, so users-permissions doesn't refuse that token, and Maison's `customer-session` policy checks it instead:
- It passes the `Authorization` header to `identity.customerSession`, the function behind the tools' `getCustomerSubject`.
- That first runs `/mcp`'s session check, oauth-mcp-manager's `resolveAccessToken`, and only then asks `resolveSubject` whose session it is. The tools skip the first step, because `/mcp` has already run it on their request.
- A LINE customer gets through, as `ctx.state.maisonCustomer`. The routes book and list for that customer only.
- Anything else is a 401 with `WWW-Authenticate: Bearer`: no header or a malformed one, an unknown, expired, revoked or rotated session, a user who is no longer active, a staff session, an admin or API token, or a users-permissions JWT.
- Without oauth-mcp-manager 1.1, it's a 503 `not_configured`, which says customer sign-in isn't configured.
- If checking the session fails on the server, such as a database error, it's a 503 `temporarily_unavailable`, not a 401: the session may still be good.
- It never logs a token, the admin key behind a session, or a full LINE user ID.

`/mcp` goes further than that check in two ways:
- **An expired admin token.** Strapi core also refuses a session whose admin token has expired (`checkExpiry`). The REST door accepts that session until the session itself expires: at most the session TTL, 1 hour, because oauth-mcp-manager issues no new session for an expired admin token. Closing this gap belongs in oauth-mcp-manager, with `resolveAccessToken` refusing an expired admin token, in a later release.
- **The tool's permission.** Each tool also needs its own permission on that admin token, such as "MCP: request and view own appointments" for `request_appointment`. The REST door doesn't check it: the customer's session is enough.

Send the session to the customer routes only. The catalog routes check tokens with Strapi's own content-API auth, which doesn't know LINE sessions and answers 401. A website on another origin also needs its origin in `strapi::cors`.

### The admin routes

Admin routes are served under `/maison`. Each takes an admin session whose role holds the permission, and the same services as the tools.

| Route | Permission | What it does |
|---|---|---|
| `GET /maison/appointments` | MCP: review appointment requests | The board's list of requests |
| `GET /maison/appointments/summary` | MCP: review appointment requests | The three cards and the five newest requests, for the board and the Homepage widget |
| `POST /maison/appointments/:reference/confirm` | MCP: confirm appointment requests | Confirm: publishes the request and sends the LINE confirmation |
| `POST /maison/appointments/:reference/notify` | MCP: confirm appointment requests | Send again ([Send again](#send-again)) |
| `GET /maison/questions` | Read customer questions | The questions, filtered by status |
| `POST /maison/questions/:reference/notify` | Answer customer questions on LINE | Let them know |
| `POST /maison/questions/:reference/answer` | Answer customer questions on LINE | Answer, with the product knowledge option |
| `GET /maison/inquiries` | Review customer inquiries | The inquiries, by queue |
| `GET /maison/inquiries/summary` | Review customer inquiries | The four open counts |
| `GET /maison/inquiries/quota` | Review customer inquiries | The month's LINE messages against the plan's limit |
| `POST /maison/inquiries/:documentId/reply` | Reply to customer inquiries on LINE | Reply on LINE |
| `POST /maison/inquiries/:documentId/close` | Reply to customer inquiries on LINE | Close, with a reason |
| `POST /maison/inquiries/:documentId/label` | Reply to customer inquiries on LINE | Change label |
| `POST /maison/inquiries/:documentId/label-again` | Reply to customer inquiries on LINE | Label again |
| `GET /maison/assistant/status` | Use the Maison assistant | Whether the assistant is ready, and its tools |
| `POST /maison/assistant/chat` | Use the Maison assistant | One assistant turn, streamed |
| `GET /maison/conversations` | Use the Maison assistant | The admin's saved chats |
| `POST /maison/conversations` | Use the Maison assistant | Save a new chat |
| `GET /maison/conversations/:documentId` | Use the Maison assistant | One saved chat |
| `PUT /maison/conversations/:documentId` | Use the Maison assistant | Rename or update a saved chat |
| `DELETE /maison/conversations/:documentId` | Use the Maison assistant | Delete a saved chat |
| `POST /maison/demo/seed` | Load and reset demo data | Load demo catalog |
| `POST /maison/demo/reset` | Load and reset demo data | Reset demo activity |
| `POST /maison/demo/activity` | Load and reset demo data | Load demo activity |

The sections below give each route's body and answers.

### Why the tools aren't REST wrappers

The two doors share what's underneath, not each other. A route doesn't call a tool, and a tool doesn't call a route: both call the services, with the same schemas and the same customer check. They're shaped for different callers:
- **An agent works through a task.** Each tool is one step of it. Its description tells the model when to use it and what it won't do, and its errors name the next tool to call, such as "Call find_boutiques to find valid boutique slugs."
- **A website works with resources.** It wants paths it can link to and cache, status codes, query strings, and Strapi's role permissions.
- **Some tools have no route, on purpose.** The staff tools sit behind the admin routes, for the board. `pending_confirmations` returns customers' full LINE user IDs, so it stays with the ops agent.

## The admin page

**Maison** in the admin menu is shown to admins with "MCP: review appointment requests", "Read customer questions", "Review customer inquiries" or "Load and reset demo data". It has up to three tabs, each shown to the admins who may see what is in it, and **Demo data** below them. The title and its subtitle share one row at the top, so the tabs start high on the page. A tab's label says how many are waiting in it, so staff who land on one see where the work is: **Requests 3** for the requests waiting for staff, **Questions 2** for the open and taken questions, and **Inquiries 2** for the inquiries in Needs an answer. A tab with nothing waiting has no number. The numbers refresh every 5 seconds, whichever tab is open, and at once after an action. The page opens on the first tab the admin may see, or on the one its address names: `/plugins/maison?tab=inquiries`, `?tab=questions` or `?tab=requests`, when the admin may see that tab. Picking a tab puts it in the address.
- **Requests**, for admins with "MCP: review appointment requests": the Homepage widget's three cards (waiting for staff, confirmed and upcoming, LINE sent), then a board that refreshes every 5 seconds. You can filter it to requests waiting for staff, confirmed ones, or all. Each row shows the customer's note. Admins with "MCP: confirm appointment requests" get a **Confirm** button on requests whose visit is still ahead, and the cards update as soon as they confirm. They also get **Send again** on confirmed requests whose LINE column says "not sent", until the visit is over ([Send again](#send-again)). A made-up demo customer's request says "demo customer" in grey, and has no Send again: Strapi sends those customers nothing.
- **Questions**, for admins with "Read customer questions": the questions the concierge handed to staff, with **Let them know** and **Answer** for admins with "Answer customer questions on LINE" ([Customer questions](#customer-questions)).
- **Inquiries**, for admins with "Review customer inquiries": every concierge turn, in queues, with **Reply on LINE**, **Close**, **Change label** and **Label again** for admins with "Reply to customer inquiries on LINE" ([Customer inquiries](#customer-inquiries)).
- **Demo data:** **Load demo catalog**, **Load demo activity** (below) and **Reset demo activity**, which deletes every appointment, notification, question and inquiry, every admin's saved assistant chats, and the product knowledge entries staff added by answering questions.

The assistant is not a tab. It was the page's fourth tab, **Ask**, and is now a drawer on every admin page ([The assistant drawer](#the-assistant-drawer)), so the Maison page is a page of three lists. An old address with `?tab=ask` opens the first tab, as an address with any name that is not a tab does.

### Load demo activity

**Load demo activity**, under Demo data, adds five made-up customers, each with one visit request, one question and two inquiries, received over the last three days. It needs the demo catalog: without it, nothing is added, and the page says to press **Load demo catalog** first.

- **The customers** are Aiko T., Kenji M., Sophie L., Daniel R. and Mei W., with fixed LINE user IDs that belong to nobody: `line:Udec0de`, zeros, then a digit. Staff see them masked, as `line:Udec…01`.
- **Requests:** five visits at Ginza, Omotesando and Osaka, 2 to 13 days ahead, on a half-hour inside the boutique's opening hours (never Osaka on a Tuesday), for pieces the boutique has in stock when the button is pressed. They are requested through the same service as a customer's, so each gets an `APT-` reference and passes the board's rules. They mix English and Japanese, the app and the concierge, and two carry a note. Three wait for staff. Two are confirmed as any confirmation is, and record `demo`, with no LINE call ([Demo customers](#demo-customers)).
- **Questions:** five that product knowledge doesn't answer, with `Q-` references: three open (one of them asking for a person), one taken and one answered. Nothing was sent to the customers, so none of them has a LINE outcome, and the answer isn't product knowledge.
- **Inquiries:** each question's hand-off turn, in Needs an answer (the answered question's is replied, with the answer), and five more: two complaints, one praise, one question the concierge answered from product knowledge, and one left unlabelled, which the labelling sweep labels within a minute when AI is on. Their labels are recorded with `modelVersion` `demo-seed` and no `promptVersion`, and each queue comes from the same rule as a model's labels.

It adds them only when none of the five customers has an appointment, a question or an inquiry, so pressing it again changes nothing, and nobody else's activity counts or is touched. **Reset demo activity** deletes the demo activity with everything else. What it adds is in `server/seed/activity.json`.

**It answers at once and writes in the background.** On Strapi Cloud each write goes to a remote database, and a press that waited for all of them took about 28 seconds, long enough for Cloud's proxy to answer an HTML error page. So `POST /maison/demo/activity`:
- first checks whether the demo activity is there and plans the visits, which only reads, so "load the catalog first" (a 404) still comes back on the press
- answers `200` with `{ created: false, customers: 0, … }` when it was there already
- otherwise answers `202` with `{ started: true, appointments, questions, inquiries }`, the counts it will add, and the page says "Loading demo activity: the lists fill in over the next few seconds."
- then writes three groups side by side: the visits (each request, its confirmation, then when it came in), the questions (each with its hand-off, one after another so each reference stays unique), and the standalone inquiries. The log says what was added once it has finished. A failure partway is logged as an error that says to press Reset demo activity, then Load demo activity again. It never stops Strapi.

A press while a load is still running answers `409` with `already_loading`, and starts nothing. On any demo button, an answer that isn't JSON, such as a proxy's HTML page, shows "Strapi took too long to answer. Wait a few seconds: the lists refresh by themselves." instead of a parse error.

**Your own LINE account.** With `demoLineUserId` set (`MAISON_DEMO_LINE_USER_ID`), three items marked `"owner": "you"` in `activity.json` go to your LINE account instead of a made-up customer: one waiting request, one open question (no answer in product knowledge) and one open complaint. You aren't a demo customer, so confirming the request, **Let them know**, **Answer** and **Reply on LINE** send real LINE messages to your phone. Your question is named with your LINE display name when Strapi has a channel access token, and has no name otherwise. If your account has as many open requests as a customer may have (`maxOpenRequestsPerCustomer`), your request stays with its made-up customer, and the log says so. Your items are added only in the same load as the made-up customers', and your own activity never stops a load or is touched. Without the setting, every item goes to the made-up customers.

### Demo customers

The five made-up customers' LINE user IDs belong to nobody, so LINE refuses every message to them. Strapi never tries: for a made-up customer (`isDemoCustomer` in `server/src/domain/demo-activity.ts`, the subjects in `activity.json`), every action that would push to LINE skips the push and records the outcome `demo`, with the detail "Demo customer: no LINE message". Everything else the action does still happens.
- **Confirming a visit**, by any route: a `demo` notification, and no Send again. The board's LINE column says "demo customer" in grey, and Confirm's notice says "Confirmed APT-1234. Demo customer: no LINE message."
- **Let them know** and **Answer:** the question is taken or answered, an answer can become product knowledge, and its hand-off inquiries are replied. The question's `lineOutcome` is `demo`, shown in grey under its status.
- **Reply on LINE:** the inquiry is replied, with `lineOutcome` `demo`, shown in grey.

These answer `200` with `status: "demo"`, and the page shows an info notice. A `demo` outcome is never pending (`pending_confirmations` lists none), and never counts as "LINE sent". The LINE quota line counts what LINE itself reports, so a demo outcome never shows there.

## The assistant drawer

The assistant is a chat for staff, in a drawer that opens from a round button at the bottom right of every admin page: the Content Manager, the Maison page, the settings and the rest. It looks things up and summarizes them: visit requests, the questions the concierge handed to staff, inquiries, and the catalog. It never sends, confirms, answers, closes or relabels anything. Staff do that with the Maison page's own buttons.

- **Who sees it:** admins whose role holds "Use the Maison assistant" (`plugin::maison.assistant.use`). Super Admin has it. The drawer is added to the page by Maison's menu link, so the admin also needs a permission that shows that link: "MCP: review appointment requests", "Read customer questions", "Review customer inquiries" or "Load and reset demo data". An admin who holds the assistant permission and none of those has no menu link, and so no drawer ([How it is mounted](#how-it-is-mounted)).
- **What it needs:** an Anthropic API key in `AI_API_KEY`, with `AI_PROVIDER` unset or `anthropic`. Without one, the drawer shows "The assistant isn't set up", the reason and **Check again**, and no text box. Set the key, restart Strapi, and press **Check again**.
- **Which model:** `aiChatModel` (`AI_CHAT_MODEL`), `claude-sonnet-5-5` by default. It is not `aiModel`, which labels inquiries. The model's ID is in a badge in the top bar.
- **How it calls the model:** only through TanStack AI. The server runs `chat()` from `@tanstack/ai` with the Anthropic adapter, and the page runs `useChat` from `@tanstack/ai-react`. The TanStack AI packages are pinned to exact versions (`@tanstack/ai` 0.68.0, `@tanstack/ai-anthropic` 0.21.1, `@tanstack/ai-react` 0.30.3, `@tanstack/ai-client` 0.39.2 and `@tanstack/ai-ollama` 0.11.16), because a range lets npm install two copies of the SDK side by side. See [TanStack AI in the plugin](#tanstack-ai-in-the-plugin).

### How it is mounted

Strapi has no place for something that is on every admin page. Its Admin Panel API offers menu links, settings links, Content Manager panels and actions, injection zones and Homepage widgets (docs.strapi.io, "Admin Panel API for plugins"), and none of them is on every page. What Strapi does draw on every signed-in page is the icon of each menu link, in the left menu. So Maison's menu link has an icon component of its own, `MaisonMenuIcon`, and the assistant is added to the page through it.
- **The icon is still the Crown.** `MaisonMenuIcon` draws the Crown with the props Strapi gives its icons, so the menu looks as it did. Strapi can draw the icon more than once at the same time: in the left menu, and in the mobile menu while that is open. Each icon claims when it mounts and releases when it unmounts (`menuIconOwner.ts`). The oldest icon is the owner, and only the owner looks after the assistant, so there is one assistant however many icons are on the screen. When the owner goes, the oldest icon that is left takes over.
- **The chat is not in the icon.** Strapi draws the icon again on every change of address. In 5.57.0, `LeftMenu` reads the location, so it renders on each change, and `MainNavIcons` makes a new component for each link on each render, so React replaces the old icon with a new one. A chat held by the icon would be lost at each click on a menu link, and at each change of tab on the Maison page, and an answer on its way would stop. So the owning icon only tells a **host** (`assistantHost.tsx`) what Strapi's providers say and the host cannot read: the theme, the language, and whether this admin holds "Use the Maison assistant". The host draws the assistant in a React root of its own, in an element added to the body.
- **How long it stays:** for as long as an icon is on the screen. Half a second after the last icon has gone, which is when the admin has signed out, the host removes the assistant and its chat, so the next admin does not find it. While the admin is signed in, the chat, its saved chats and the text typed and not sent stay as staff move between pages and while the drawer is closed, and an answer on its way goes on. A reload ends them.
- **The code is loaded when it is needed.** The icon and the host are in the admin's first bundle, and are small. The assistant itself (Markdown, TanStack AI and the screens) is a chunk of its own, loaded the first time an admin who may use it is on a page. Its status check and its saved chats are asked for the first time the drawer is opened, not on every page. If the chunk fails to load, or the chat fails while it is drawn, the round button stays. Pressing it shows "The assistant could not load. Reload the page to try again.", and the error is written to the browser's console.
- **A window 1080px wide or more:** below that width, which is Strapi's `large` breakpoint, Strapi draws only a few links in the top bar of its mobile layout, and the other links, Maison's among them, only inside its menu while that menu is open. So the round button is there while the menu is open and goes half a second after it closes, and the chat goes with it. Use the assistant in a window 1080px wide or more.
- **The cost of this choice:** it rests on how Strapi 5.57.0 draws its menu (`components/MainNav/MainNavLinks.mjs` and `components/LeftMenu.mjs` in `@strapi/admin`; both files are byte for byte the same in 5.55.1 and 5.57.0), not on a documented API. A Strapi upgrade can need a fix here. `test/unit/maison-menu-icon.test.tsx` holds the rule: it draws the icon in a stand-in for the menu that follows those files (`test/unit/fake-strapi-menu.tsx` names the files and lines it follows). After a Strapi upgrade, compare those two files of Strapi with the stand-in, run the tests, and open any admin page: the round button must be at the bottom right.

### The screen

The button is 56px across, 24px from the bottom and right edges, in the primary colour with the Sparkle icon, and it is not on the screen while the drawer is open. The drawer slides in from the right and is the full height of the window, with no dark layer behind it, so the page beside it stays readable and clickable. It is above the page and the left menu and below Strapi's dialogs, so **Reply on LINE**, **Answer** and **Change label** open above it. Only the message list scrolls up and down, and it follows the newest message only while you are at the bottom. The top bar, the quick questions and the text box stay where they are.
- **Widths:** the chat is 600px wide, and 960px when the drawer is expanded. The list of saved chats is a column of 260px beside the chat. **History** makes the drawer 260px wider, 860px or 1220px expanded, so the chat keeps its width and gives up nothing to the list. A drawer is never wider than 90vw: only when it would pass that does the chat give up the difference, and the list keeps its 260px. The width changes over 0.2 seconds, the drawer and the list together, and not at all for staff who prefer less motion.
- **The top bar:** **History** opens the saved chats. **Tools (N)** opens a read-only list of the tools your chat has, each with a label, one line about it and its name. A role that may read less sees fewer. A badge names the model. **New chat** starts an empty chat. When the chat is too long to go on, the button also shows the words "New chat". At the right end, **Expand the assistant** widens the chat from 600px to 960px (**Collapse the assistant** narrows it again) and never opens the list, and **Close the assistant** closes the drawer.
- **The saved chats:** only **History** shows or hides the list, as a column beside the chat, to its left, at either width. It is never drawn over the messages. Picking a chat, starting a new one and deleting one leave it as it is.
- **Keyboard and focus:** opening moves the focus to the text box. Escape, with the focus in the drawer, closes it, and the focus goes back to the round button. An Escape that something else has used first does not close it: the one that closes the list of tools, and the one that cancels a conversion of Japanese text. There is no focus trap, because the page stays usable.
- **Messages:** your messages are on the right, the assistant's on the left with its avatar. The assistant's bubble uses the full width beside the avatar. Answers are Markdown: paragraphs, lists, tables, code and quotes. Images are not drawn. Only `http:` and `https:` links are links, and they open in a new tab. Raw HTML shows as text.
- **Tables:** header cells stay on one line. Body cells wrap between words and never inside one that fits, and each column is 7rem to 22rem wide (the admin's rem is 10px, so 70px to 220px), so a date such as `2026-10-05` and a masked customer such as `line:Udec…02` keep their line, and a long text wraps inside its column. A table is never squeezed to fit the bubble, because a browser that squeezes a table breaks a date after its second hyphen. It is as wide as its columns want to be, and a table wider than the bubble scrolls sideways inside its bubble, and nothing else moves: not the message list, not the drawer. This is the same at 600px and at 960px. At 600px, a table with a long text column is wider than the bubble, so scroll it sideways to read that column.
- **Tool boxes:** each lookup is a box in the answer, in the order it happened, closed at first. Its header says `Tool: list_requests` and then a spinner, "3 results" (or "1 result", or "done" for a tool with nothing to count), or "failed". Opened, it shows the result as JSON with the customer-text tags taken out and customers still masked. A failed box is marked: its border takes the error colour, its header says "failed" in the error colour, and its body shows the tool's own message.
- **Waiting:** three dots show while the assistant starts to answer, and "Working on it…" shows under the boxes while a tool runs.
- **The text box:** one line, growing to six. Enter sends, Shift+Enter adds a line, and the Enter that confirms a Japanese conversion sends nothing. **Send** and **Stop** sit side by side, so a double click on Send never stops an answer.
- **Quick questions:** five small buttons in a row directly above the text box, for the whole chat: in the empty chat, and after any number of messages, so a demo can use them at any point. They are "Which visits are waiting for staff?", "Any complaints this week?", "Which customer questions still need an answer?", "How many inquiries are open in each queue?" and "What are customers asking about today?" They show whenever the assistant is ready. Pressing one sends that question as it is written, leaves what you have typed in the text box, and puts the focus there. They are off while an answer comes, and they wrap onto more lines when the drawer is narrow. They are outside the message list, so they never scroll with it. The empty chat shows only its title and one sentence.

### Saved chats

Each admin's chats are saved for them. In the drawer, each admin sees only their own chats. A Super Admin can read every saved chat through Strapi's Content Manager API, because hiding the content type from the Content Manager screens does not close that API.
- **When it saves:** after each turn ends, however it ends. A cut-off tool call or a turn that failed before anything came back is taken out first, so a reopened chat never shows a spinner.
- **The list:** **History** opens it. It lists your chats, newest first. It shows the newest 100 chats. A chat beyond those 100 stays stored and is not listed, so you cannot open or delete it from the list. Each row has a trash button that deletes the chat at once. While an answer comes, its rows, **New chat** and the trash buttons are off.
- **When the drawer is opened:** the first time in a page load, the assistant is checked and the list loads, and not on every page. Once the assistant is ready, the most recent chat reopens, or the chat you had already begun. With no saved chat, the empty chat shows. Opening the drawer never starts a chat, never saves one and never clears the messages: closing it and opening it again, or moving to another page, shows the same chat with its messages and what you typed. Only the New chat buttons start a new one.
- **New chat** keeps the old chat in the list, and the next turn saves a chat of its own. What you typed and did not send stays in the box.
- **The title** is your first message, on one line, cut to 80 characters.
- **Where it is stored:** the content type `plugin::maison.conversation` (table `maison_conversations`), hidden from the Content Manager and the Content-Type Builder. A chat is stored as `{ v: 1, messages }`, with every key of every part kept: the model gets the whole history back each turn, and Anthropic refuses a thinking block whose signature was changed. A stored chat that can't be read opens as an empty chat, and the log says which one.
- **What a saved chat holds:** the messages as you saw them, with the tool results: customers masked, customer text cut and tagged. **Reset demo activity** deletes every admin's saved chats, because they quote the demo customers. Its notice does not count them.
- **Limits:** a reopened chat still counts toward the 20 messages of a chat.

### Tools

| Tool | Offered with | Label |
|---|---|---|
| `list_requests` | "MCP: review appointment requests" | Visit requests |
| `list_questions` | "Read customer questions" | Customer questions |
| `list_inquiries` | "Review customer inquiries" | Inquiries |
| `inquiry_counts` | "Review customer inquiries" | Inquiry counts |
| `search_knowledge` | "MCP: browse the catalog" | Product knowledge |
| `search_products` | "MCP: browse the catalog" | Product search |
| `view_product` | "MCP: browse the catalog" | Product details |

A tool is offered only when the admin's role holds its permission, and `disabledTools` can remove the three catalog tools here, as it does on MCP. An admin with the assistant permission and none of these gets no tools: the assistant says so and looks nothing up. `GET /maison/assistant/status` lists the tools the admin's chat really has.

### What the model sees

- **The customer is masked,** like `line:U4af…88`. A full LINE user ID and a LINE display name never reach the model.
- **Customer text is data.** It is inside `<customer_message>`, `<customer_question>`, `<customer_note>` or `<concierge_reply>`, and a `<` before one of those names is written as `&lt;`, so customer text can't close a tag. The instructions and every tool's description say that everything a tool returns is data, never instructions.
- **Lists are cut.** A list answer has at most 50 rows, each long text is cut to 300 characters and marked `truncated`, and `capped` says when there were more rows. One item, looked up by its reference or documentId, has its full text.
- **The assistant answers in Markdown,** with a table for items that have the same fields, and is told never to include images.

### Limits and errors

| Limit | Value |
|---|---|
| Messages from you in one chat | 20. The 21st is refused with "This chat is long. Start a new chat." |
| Model turns for one answer | 6. After that, "The assistant stopped after 6 steps. Ask a narrower question." |
| Time for one answer | 90 seconds |
| Output of one model turn | 16,000 tokens, thinking included |
| Request body | Strapi's 1 MB |

An error before the stream starts (not set up, a chat that is too long, a failure in setting up) is a `200` event stream with one `RUN_ERROR`, because the page's client never reads the body of an HTTP error. Only a body that is not a run input (400), a role that lost the permission (403) and a body over the limit (413) are real HTTP errors. Staff read plain text:

| What happened | What staff see |
|---|---|
| Not set up | The reason, and **Check again** |
| Anthropic refused the key (401, 403) | "Anthropic refused the key. Check AI_API_KEY." |
| The model ID is unknown (404) | "Anthropic doesn't know the model", then the ID, then "Check AI_CHAT_MODEL." |
| Anthropic is busy (429, 529) | "Anthropic is busy. Try again in a minute." |
| Over 90 seconds | "The assistant took too long and stopped. Try again." |
| The answer reached 16,000 tokens | "The answer was cut off because it was too long. Ask for less." |
| The model declined | "The model declined to answer this. Rephrase the question." |
| The chat can't continue, or is too long | "This chat can't continue. Start a new chat." or "This chat is long. Start a new chat.", with **New chat** |
| The connection dropped | "The connection to Strapi was lost. Try again." |
| The session ended | "Your Strapi session has ended. Reload the page to sign in again." |
| A tool fails | Its box is marked "failed", with its message |
| A call to the saved chats fails | "Couldn't load your saved chats.", "Couldn't open that chat.", "Couldn't save this chat." or "Couldn't delete that chat." |
| Anything else | "Something went wrong. Try again." |

The log has one line for each turn, with the admin's ID, the tools called and how long it took, and never customer text. A model error goes to the log once, with the key taken out, and staff never read the provider's own text.

### Routes

All of them are for admins who hold "Use the Maison assistant", and are served under `/maison`.
- `GET /assistant/status`: `{ ready: true, model, tools: [{ name, label }] }`, or `{ ready: false, reason }`. Never the key.
- `POST /assistant/chat`: one turn, streamed. The page sends the whole history each time.
- `GET /conversations` (the admin's chats, newest first, at most 100, each `{ documentId, title, updatedAt }`) and `POST /conversations` (`{ title, messages }`).
- `GET /conversations/:documentId`, `PUT /conversations/:documentId` (`{ title, messages }`, either or both, and at least one) and `DELETE /conversations/:documentId`. A chat that belongs to another admin answers `404`, as an ID nobody has does. A body that parses but is not a chat answers `400` with "This chat could not be saved." So does a `PUT` with an empty body, and a `PUT` whose `title` is not text or has no words.

### Checking it in the browser

This is for the person who tries the drawer. It needs Strapi running (port 1339 here), an Anthropic key in `AI_API_KEY`, an admin whose role holds "Use the Maison assistant" and a permission that shows the Maison menu link, and a window 1080px wide or more. Each item says what to do and what to expect.
1. **The button on every page.** Open a Content Manager list and an entry, the Media Library, a Settings page and the Maison page. A round Sparkle button is at the bottom right of each. It is not there for an admin without the assistant permission.
2. **Open, Escape and the focus.** Press the button: the drawer slides in from the right, the full height of the window and 600px wide, with no dark layer, and the focus is in the text box. Press Escape: it closes, and the focus is on the round button. Open it again and press **Close the assistant**.
3. **The page stays clickable.** With the drawer open, click a row, a tab and a link in the left menu: the page reacts, and the drawer stays open.
4. **Dialogs open above it.** On the Maison page, with the drawer open, press **Reply on LINE** on an inquiry, then **Answer** on a question. Each dialog and the dim layer behind it are above the drawer.
5. **The same chat every time.** Ask a question, and type half of another in the box. Close the drawer and open it again: the same messages and the same half question. Go to another admin page and open it: still the same. Open **History**: one row for the chat, not one for each opening. Reload the page and open the drawer: the most recent chat is back. Only **New chat** starts a new one.
6. **The five quick questions.** In the empty chat, five small buttons are above the text box. Press one while the box has half a question in it: the question is sent, the half question stays in the box, and the focus is in the box. The buttons are grey while the answer comes, and they are still there when it is over and after more messages.
7. **Expand and History.** **Expand the assistant**: the chat grows from 600px to 960px, and the list of saved chats does not open. **Collapse the assistant**. **History**: the drawer gets 260px wider (860px, or 1220px expanded), the list is a column to the left of the chat, and the chat keeps its width. Make the window about 1100px wide and open both: the drawer stops at 90% of the window, and the chat gets narrower, not the list.
8. **Tables.** Ask "Which visits are waiting for staff?" and for a table of the open questions with their reference, customer, date and text. Header cells stay on one line, dates and masked customers stay on one line (not even `2026-10-` and `05` on two lines), and long text wraps between words in a column about 220px wide. Check it at 600px and expanded. A table wider than the bubble scrolls sideways inside the bubble, and nothing else moves: at 600px, the long text column is off to the right until you scroll.
9. **Scrolling.** In a long chat, only the message list scrolls up and down: the top bar, the quick questions and the text box stay where they are. While an answer streams, scroll up: the list does not pull you back down. Send a message: it goes to the bottom.
10. **Light and dark.** Switch the admin theme from the profile menu with the drawer open and a table in the chat: the drawer, the bubbles, the quick questions and the table are readable in both.
11. **The compact header.** On the Maison page, the title "Maison" and its subtitle are on one row about 56px high, and the tabs start right under it. Make the window narrower: the subtitle wraps under the title. The page has three tabs, and `/plugins/maison?tab=ask` opens the first one.
12. **A role with no tools.** Use a role that holds "Use the Maison assistant" and "Load and reset demo data" and nothing else. It opens the Maison page and has the drawer, and the assistant has no tool for it. Open the drawer: the top bar says **Tools (0)**, and opening the list says "Your role has no tools, so the assistant can't look anything up."

## The Homepage widgets

**Maison requests** on the admin's Homepage is shown to admins with "MCP: review appointment requests":
- Three cards count one pipeline of visits still ahead: **Waiting for staff**, **Confirmed, upcoming**, and **LINE sent**, the confirmed visits whose LINE confirmation has been sent. They wrap when the widget is narrow.
- Below them, a table lists the five newest requests, newest first. A narrow widget scrolls it sideways. Its columns are:
  - **Requested:** how long ago the request came in, like "12 min ago", and from a day on its date, like "Oct 1". Hover for the full date and time.
  - **Reference**, **Customer** (masked, like `line:U4af…88`) and **Boutique**.
  - **Visit:** the visit time in Tokyo.
  - **Note:** what the customer wrote, cut to one line. Hover for all of it. A dash when there is none.
  - **Status** and **LINE** ("LINE sent", "not sent", or "demo customer" for a made-up customer), in the words and colours of the board.
- It refreshes every 5 seconds. If a refresh fails, it keeps the last result on screen with a note.
- **Open the board** goes to the Maison page. It shows the same three cards above the board, and the board has a **Note** column too, where the whole note wraps instead of being cut.

Its numbers and rows come from `GET /maison/appointments/summary`, which calls `appointments.summarizeRequests()` and follows the board's own definitions. Each row is a row of the board's "All requests" view, without the products and `createdVia`: its `createdAt` is when the request came in, and its `note` is what the customer wrote. Strapi keeps each admin's Homepage layout once they've changed it, so an admin who has moved or removed widgets adds this one with **Add Widget**.

**Maison inquiries**, a second widget, is shown to admins with "Review customer inquiries". It shows the four open counts of the Inquiries tab as cards, **Needs an answer**, **Complaints**, **Praise** and **Not labelled**, which wrap when the widget is narrow. It refreshes every 5 seconds, and if a refresh fails it keeps the last result on screen with a note. **Open the inquiries** goes to the Inquiries tab of the Maison page. It's a widget of its own because the requests widget's body is laid out for a fixed height. Its numbers come from `GET /maison/inquiries/summary`, the same route as the cards on the tab.

## Tokens

Strapi's `/mcp` only accepts **admin** API tokens. Create them under **Settings → Administration Panel → Admin Tokens** and grant only the Maison permissions a caller needs:
- **Customer token:** "MCP: browse the catalog", "MCP: request and view own appointments", "MCP: hand questions to staff" and "MCP: log customer inquiries". Map it to the LINE client in oauth-mcp-manager. Every customer session runs with this token's permissions, so keep it narrow.
- **Staff token:** "MCP: browse the catalog", "MCP: review appointment requests" and "MCP: confirm appointment requests", for an agent that works for staff.
- **Ops token:** only "MCP: send appointment confirmations".

The same permissions on an **admin role** decide what staff see in the chat and on the Maison page. "Load and reset demo data", "Read customer questions", "Answer customer questions on LINE", "Review customer inquiries" and "Reply to customer inquiries on LINE" are ordinary admin role permissions.

## Customer identity

A tool never takes the customer as an argument. Customer tools pass the caller's own `Authorization` header to oauth-mcp-manager:

```ts
strapi.plugin('strapi-oauth-mcp-manager').service('oauth').resolveSubject(authorization); // 'line:U…' or null
```

Anything but `line:U` followed by 32 lowercase hex characters counts as not signed in. That includes plain admin tokens, staff sessions, and a missing oauth-mcp-manager. Staff tools and the board show customers masked, as in `line:U4af…88`, and never the full LINE user ID.

The REST customer routes run the same lookup through the `customer-session` policy, after running `/mcp`'s session check (see [The customer session](#the-customer-session)).

The Content Manager doesn't show an appointment's `customer` field at all, in the list or the edit view. The schema also marks it `hidden` in its config and `searchable: false`, as the question and inquiry content types do, so no admin API answer carries it and the list search doesn't match it. The Document Service still reads and writes it, and saving or publishing an appointment in the Content Manager leaves it as it was.

## LINE confirmations

Strapi sends the customer the LINE confirmation when staff confirm a visit, whichever way they do it:
- the board's **Confirm** button
- `confirm_appointment`, from an MCP client
- **Publish** on the appointment in the Content Manager

Each of them publishes the appointment. Once that publish has gone through, Strapi pushes the visit's flex message to the customer with LINE's push API, `POST /v2/bot/message/push`. It's the message `pending_confirmations` lists for the visit, built by the same code. Sending never makes the publish fail.
- **Confirm and `confirm_appointment`** wait for LINE's answer, 8 seconds at most, so their answer and the board's next refresh show how it went.
- **Publish in the Content Manager**, and its bulk Publish, run inside a database transaction. Strapi sends once that transaction commits, and the publish doesn't wait for LINE: the board shows the outcome on its next refresh. A publish that's rolled back sends nothing.

**The message is in the language the customer booked in.** That's the appointment's `language`, `ja` or `en`, which the booking's `locale` sets, on `request_appointment` or the REST booking. A customer app passes the language its customer is using. A booking without a `locale` gets `defaultLocale`, and a visit without a `language`, such as one booked before appointments kept it, is Japanese.
- The message's words, the house name and the date follow it: `10月10日(土) 14:00` in Japanese, `Sat 10 Oct, 14:00` in English.
- So do the boutique's name and address and the pieces' names. They come from the published versions of the boutique and products in that language, field by field, with the default locale's value where one is missing or empty.
- `pending_confirmations` lists it in that language too.

Strapi records each attempt as a Maison notification, with `recordedBy` set to `strapi`:
- **sent**, with LINE's answer. LINE also answers 200 for a customer it can't deliver to, such as one who has blocked the account, so `sent` means LINE took the message.
- **failed**, with LINE's HTTP status and its message, or why LINE couldn't be reached

A visit gets one confirmation. Once a `sent` notification exists for it, Strapi sends nothing more, so publishing a confirmed visit again sends nothing. A visit that's over gets none, as `pending_confirmations` lists none, even when the Content Manager publishes it.

Two sends for the same visit at the same moment share one push, within one Strapi process. That's enough for this demo, which runs one Strapi. In production it isn't: several Strapi processes can each send, and a crash between the push and its record leaves no `sent` row. The usual remedies are a claim row with a unique index on the reference, written before the push so only one sender wins; LINE's `X-Line-Retry-Key` header on the push, with LINE's 409 answer to a repeated key treated as sent; or an outbox, where publishing only writes a pending row and a worker sends it and retries.

**Give Strapi the channel access token** of your LINE Messaging API channel: set `LINE_CHANNEL_ACCESS_TOKEN` in the app's `.env`, read it in `config/plugins.ts` as in [Install](#install), and restart Strapi. Without a token, Strapi sends and records nothing, and logs this once: "LINE_CHANNEL_ACCESS_TOKEN isn't set: confirmations aren't sent from Strapi." The board then shows those visits as "not sent". Without a `liffUrl`, it sends nothing either, because the message's button would have no link.

### Send again

On the board, a confirmed request whose LINE column says "not sent" has a **Send again** button until its visit is over, for admins with "MCP: confirm appointment requests". It sends the confirmation, unless it has gone out already, and shows a notification saying how it went. It calls `POST /maison/appointments/:reference/notify`, gated on the same permission as **Confirm**, which answers:

| Status | When |
|---|---|
| 200, with `status: "sent"` | LINE took the message |
| 200, with `status: "already_sent"` | It had gone out already, so nothing was sent |
| 200, with `status: "sent_unrecorded"` | LINE took the message, but recording it failed, so its row still says "not sent". Don't send it again |
| 200, with `status: "demo"` | A made-up demo customer's visit: nothing was sent, and a `demo` notification records it ([Demo customers](#demo-customers)) |
| 404 | No appointment has that reference |
| 409 (`not_confirmed`) | The visit isn't confirmed |
| 422 (`past`) | The visit is over, so it gets no confirmation |
| 502 (`failed`) | LINE refused it or couldn't be reached. The failure is recorded |
| 503 (`not_configured`) | There's no `lineChannelAccessToken` or no `liffUrl` |

Every error says why in its message, which is what the board shows.

## Customer questions

When the concierge has no answer in product knowledge, or the customer asks for a person, it calls `hand_off_to_staff`. Strapi records the question for the signed-in customer under a reference like `Q-4821`, with the piece it's about and the customer's LINE name when LINE gives one, and sends the customer nothing. A question the customer already has with staff (open or taken), in the same words apart from capitals and extra spaces, isn't recorded twice: the tool answers the existing reference, before it counts the five. Staff follow up on the Maison page, under **Customer questions**.

**The section** refreshes every 5 seconds and filters to **Open** (open and taken questions, the default), **Answered** or **All**, newest first. Each row shows when the question came in (Tokyo time), the customer's LINE name with the masked ID under it, the piece, the question, why it was handed off ("No answer in product knowledge" or "Asked for a person"), and its status: Open, Taken by Jane, or Answered by Jane, with "Added to product knowledge" when it was. When the last LINE message for a question failed, the row says so, in LINE's words.

Two permissions, which an admin role holds like any other:

| Permission | What it gives |
|---|---|
| Read customer questions (`plugin::maison.questions.read`) | The section, and a way into the Maison page |
| Answer customer questions on LINE (`plugin::maison.questions.answer`) | The two buttons below. It needs Read customer questions too, because the buttons live in the section |

- **Let them know**, on an open question, sends the customer one LINE message in the admin's first name: a person has the question and will reply in the chat. The question becomes taken.
- **Answer**, on an open or taken question, opens a dialog with the question, a box for the answer (never pre-filled) and **Add to product knowledge**, ticked. **Send on LINE** sends the answer in the admin's name and marks the question answered. With the box ticked, it also publishes the answer as a product knowledge entry that every customer's concierge can use, so the answer should suit any customer. The entry is in the question's language, about the question's piece, under the category the admin picked, and titled by **Title in product knowledge**: the customer's own question (cut to 200 characters) to start with, which the admin can edit. Customers see the title with the answer, so the dialog says to take out anything personal. **Send on LINE** stays disabled while the box is ticked and the title is empty.

Both buttons are disabled while a request runs. Nothing guards two admins pressing them for the same question at the same moment: both messages could go out.

**The routes** are admin routes, so each takes an admin session that holds its permission:

| Route | Permission | Body |
|---|---|---|
| `GET /maison/questions?status=open\|answered\|all` | Read customer questions | None. Answers `{ questions }` |
| `POST /maison/questions/:reference/notify` | Answer customer questions on LINE | None |
| `POST /maison/questions/:reference/answer` | Answer customer questions on LINE | `{ text, addToKnowledge, category, title }` |

`text` is 1 to 2,000 characters. `addToKnowledge` defaults to `true`, and while it's true, `category` is one of `care`, `materials`, `sizing`, `personalization`, `delivery`, `returns`, `repairs`, `warranty`, `gifting` and `store`. With `addToKnowledge: false`, leave `category` out. `title` is 1 to 200 characters and only used while `addToKnowledge` is true: it titles the knowledge entry, and without one the customer's question (cut to 200 characters) is the title. The message is signed with the first name of the signed-in admin's account, never with anything the request says. An admin without a first name, or whose first name is the house's own, writes for the team.

The two POSTs answer:

| Status | When |
|---|---|
| 200 | LINE took the message. The answer is `{ reference, status: "sent", message }`, with `knowledgeDocumentId` when the answer became a knowledge entry, and `warning: true` when something after the message went wrong. For a made-up demo customer it is `status: "demo"`: nothing went to LINE, and the rest happened ([Demo customers](#demo-customers)) |
| 400 (`invalid_input`) | The reference isn't like `Q-4821`, `text` is empty or longer than 2,000 characters, `title` is empty or longer than 200 characters, or there's no `category` while `addToKnowledge` is true |
| 404 (`not_found`) | No question has that reference |
| 409 (`already_taken`) | Let them know, for a question someone has taken already |
| 409 (`already_answered`) | Either POST, for an answered question |
| 502 (`failed`) | LINE refused the message or couldn't be reached. The question stays as it was, apart from recording why, which its row shows, and nothing is saved as knowledge |
| 503 (`not_configured`) | There's no `lineChannelAccessToken`. Nothing is sent |

Every error says why in its message, which is what the page shows. A 200 with `warning: true` has the customer's message out, and its `message` says what went wrong after: "…, but recording it failed (…). Don't send it again." when LINE took the message but the question couldn't be updated, and "…It couldn't be added to product knowledge: …" when the answer went out but its entry wasn't made. The page shows that `message` as a warning that stays until it is dismissed, and any other 200's as a success, which fades.

**What the customer gets** is a LINE text message from Maison's channel, in the question's language, written in the admin's first name and quoting the question cut to 80 characters. Let them know, in English:

> Hello, this is Jane, a client advisor at Maison. Thank you for your question about the Jewelry Coffret: "Can it hold a watch?" I'm looking into it and will reply here in this chat as soon as I can.\
> Jane, Maison

And an answer:

> Hello, this is Jane, a client advisor at Maison. Thank you for your question about the Jewelry Coffret: "Can it hold a watch?"
>
> Yes, a watch up to 42 mm fits.
>
> If anything else comes to mind, just reply here.\
> Jane, Maison

A question in Japanese gets both messages in Japanese, signed with "Maison" and the name joined by a full-width space. Without a piece, "about the Jewelry Coffret" is left out. Without a first name, or with the house's own as the first name ("Maison", in any case, or either `houseName` in the config), the message opens "Hello, this is Maison's client advisor team." and is signed "Maison".

**Reset demo activity**, under Demo data, deletes every question and the product knowledge entries their answers added, in every language, as well as every inquiry, appointment and notification. The catalog and the seeded product knowledge, in both languages, stay. Strapi answers `{ appointments, notifications, questions, inquiries, knowledge }`, what it deleted, and the page says so.

## Customer inquiries

Every message a customer sends the concierge is an **inquiry**. The customer app's server records each finished turn with `log_inquiry`, a model labels it in the background, and staff work the queues under **Inquiries** on the Maison page. Nothing is sent to a customer about an inquiry unless a person replies on LINE.

### Recording a turn

The app's server calls `log_inquiry` after each turn, so logging never depends on the model remembering to. It takes:
- `message`, the customer's last message, and `reply`, the concierge's final text for the turn
- `knowledgeFound`, whether any `search_knowledge` call in the turn found an entry, and `handedOff`, whether the turn handed the question to staff
- optionally `questionReference`, the question the hand-off recorded, `productSlug`, the page the customer was on, and `locale`, the chat's language, which defaults to `defaultLocale`

It answers `{ logged: true }` at once: labelling comes later.
- **The customer comes from their LINE sign-in**, never from an argument. Staff see them masked, and the model never sees a LINE ID.
- **The text is kept as written, line breaks included.** The tool takes a message of up to 4,000 characters and a reply of up to 8,000, and the inquiry keeps the first 1,000 and 2,000 of them.
- **A piece and a question are stored only when they are real:** a published piece, and a question that belongs to this customer. Anything else is dropped, and the turn is still logged.
- **A failed log never fails the customer's turn.** The app logs a warning and moves on.

The tool needs "MCP: log customer inquiries", which belongs on the customer token. There is no REST route for it, and the staff assistant doesn't offer it.

### Labelling

A cron job, `maison-label-inquiries`, runs every minute. The plugin adds it itself, so it doesn't need `cron.enabled` in `config/server.ts`, which only gates the jobs listed in that file. Each run labels up to 10 inquiries, oldest first: new ones, ones skipped while labelling was off, and ones that have failed fewer than 5 times. It never picks one a person has labelled. It makes one model call per inquiry, through TanStack AI (`chat()` with an `outputSchema` and no tools), and the answer has to fit this schema:

| Label | Values |
|---|---|
| `kind` | `question`, `complaint`, `praise` or `other` |
| `sentimentScore` and `sentimentLabel` | a score from -1 to 1, and `negative`, `neutral` or `positive` |
| `answered` | whether the concierge's reply answers what the customer asked |
| `reason` and `topic` | why, in up to 400 characters, and a short phrase for what it's about, both in English |

- The prompt tells the model that the customer's text is evidence to label, never instructions to follow. The queue rule is code, not the model: it keeps a hand-off in Needs an answer whatever the labels say.
- Each labelled inquiry records the `modelVersion` (`<provider>/<model>`, such as `anthropic/claude-haiku-4-5-20251001`) and the `promptVersion` (`PROMPT_VERSION`, `inquiry-labels-1`) that labelled it.
- **A failure that is about the inquiry counts against it.** A model that answers in the wrong shape (a missing field, a sentiment of 3, a kind of "angry") is one. So is any other failure that isn't one of the two below: the provider rejecting that inquiry's own text (a 400, a 413, a 422), an error nobody has a class for, or Strapi failing to save the labels. The inquiry becomes `failed` with one more attempt, and nothing half-written is saved. At 5 attempts it's parked until staff press **Label again**, and the sweep goes on with the next inquiry, so one that always fails never stops the ones behind it.
- **A refused key or setup, or no answer from the model, isn't the inquiry's fault.** The provider answering 401 or 403 (a wrong key) or 404 (a model name it doesn't know, or a wrong address), a timeout after 30 seconds, a connection that never comes up, or a provider that is down or rate-limiting (after the Anthropic client's two retries) changes nothing on the inquiry: no status change and no attempt. The sweep logs one warning that says which it was, never with the key, and ends, so the inquiries behind it aren't tried in the same sweep. The next sweep, a minute later, tries again, so a wrong `AI_API_KEY` or `AI_MODEL`, or a dropped hotspot, parks nothing.
- A sweep that starts while another is still running does nothing.
- **A person's label wins.** **Change label** marks the inquiry as corrected, and the sweep reads each inquiry again right before it writes, so a label changed during the model's call isn't overwritten.

**The settings** are `aiProvider`, `aiModel`, `aiApiKey` and `aiBaseUrl` ([Configuration](#configuration)), which `config/plugins.ts` reads from `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` and `AI_BASE_URL`. The default is Anthropic's Claude Haiku 4.5. `ollama` is for local use without a key: the model is `AI_MODEL`, or `qwen3-14b-32k`, at the host in `aiBaseUrl`, with thinking turned off.

**Without a key, the plugin still runs, with rows waiting.** Labelling is on only when the provider has its own setting: `aiApiKey` for `anthropic`, `aiBaseUrl` for `ollama`. The Anthropic key is never sent to an Ollama host. With neither, nothing is sent to a model. The sweep marks new inquiries `skipped`, and they wait under **Not labelled**. A hand-off is in **Needs an answer** from the start, and staff can label any inquiry by hand with **Change label**. Once a key is set and Strapi has restarted, the next sweep labels the waiting ones too.

### The queues

The queue is decided by code, from the labels and the hand-off, never by the model alone:

| Queue | An inquiry is in it when |
|---|---|
| **Needs an answer** | the turn handed the question to staff, whatever the labels say, or it's labelled a question that nobody has said was answered: the model said the concierge didn't answer it, or a person labelled it a question by hand |
| **Complaints** | the model labelled it a complaint |
| **Praise** | the model labelled it praise |
| none | anything else, such as small talk or a question the concierge answered. **All** still shows it |

**Not labelled** isn't a queue. It holds the open inquiries nobody has labelled yet, because they're waiting, were skipped, or failed, so when in doubt a person sees them. A replied or closed inquiry is in no queue and shows only under **All**.

### The tab

**Inquiries** opens on **Needs an answer**, and refreshes every 5 seconds, newest first, up to 50 rows. Four cards count the open inquiries in **Needs an answer**, **Complaints**, **Praise** and **Not labelled**, and five buttons filter the list to those, or to **All**. Above the table, a line gives the month's LINE messages, like "LINE messages this month: 12 of 200": replies count toward the channel's quota, as confirmations do. Strapi asks LINE for it when the tab opens and after a reply, not on the refresh, because each ask makes two calls to LINE. The line is left out without a channel access token, and when LINE gives no answer. Without a token, the Reply on LINE dialog says so as soon as it opens, in the words Send would be refused with, and **Send on LINE** is disabled.

Each row shows:
- when the customer wrote (Tokyo time), and the customer, masked
- their message, which keeps its line breaks and scrolls in its box when it's long, and the piece it's about
- the kind and the sentiment, like "negative (-0.6)". A label a person gave has no score, so it shows alone. A note under the kind says why an inquiry has none yet (waiting for the next sweep, skipped while labelling was off, or failed), or that a person changed its labels
- the status: **Open**, **Replied by Jane**, or **Closed** with the reason written out, like "Closed: spam". A failed LINE message shows under it, in LINE's words
- **What the concierge said**, which shows the concierge's reply, and the model's topic and reason, labelled as the model's own words

**A hand-off isn't answered here.** Its row shows its question, like `Q-4821 · answer it under Questions`, and has no Reply on LINE: a hand-off is answered under **Questions**, where the question's own flow and the product knowledge loop stay the one way to answer it. Answering the question marks its inquiries replied. One logged after its question was answered stays open and says `Q-4821 · answered under Questions`: close it.

Admins with "Reply to customer inquiries on LINE" get these buttons, which are disabled while a request runs:
- **Reply on LINE**, on an open inquiry that isn't a hand-off, opens a dialog with the customer's message and a box for the reply, which is never pre-filled. **Use the suggested text** puts in the text for a complaint or for praise, in the chat's language, after anything already typed. Staff edit it, and **Send on LINE** is enabled for a reply of 1 to 2,000 characters. It pushes one LINE text message from Maison's channel, in the inquiry's language, and marks the inquiry replied, with the text, when, and by whom. The message quotes the customer's first 80 characters, and is signed by Maison. The admin's first name is saved on the inquiry, and never sent:
  > About your message: "The clasp of my coffret broke after a week."
  >
  > We're sorry about this, and thank you for telling us. A member of our team will look into it and reply in this chat with the next step.
  >
  > Maison

  A Japanese chat gets `「…」についてのお問い合わせへのご返信です。` in place of the first line. A message LINE refuses is recorded as failed, with LINE's answer, and the inquiry stays open. Only customers who have added Maison on LINE get it. LINE answers 200 for one who hasn't, or who has blocked the account, and delivers nothing, so the inquiry is marked replied all the same. Nothing guards two admins replying to the same inquiry at the same moment: both messages could go out.
- **Close**, on an open inquiry, with a reason: **Answered elsewhere**, **Not needed** or **Spam**. It isn't offered for a replied inquiry, which keeps its reply.
- **Change label** sets the kind, the sentiment, or both, and sends only what the admin changed. The inquiry is then the person's: the sweep never labels it again, **Not labelled** no longer lists it, and its queue follows the new kind by the same rule as before, so a question labelled by hand is in **Needs an answer**. A new sentiment drops the model's score, and the model's reason and topic stay as the model wrote them. An inquiry with no kind needs one: a sentiment alone would leave it in no queue and out of **Not labelled**, so **Save label** stays disabled until a kind is picked, with "Pick a kind too." under **Kind**, and the server refuses it with the same words.
- **Label again**, on an inquiry the model failed on, puts it back for the next sweep with its attempts reset. It isn't offered for one a person has labelled.

### The suggested texts

For a complaint:

> We're sorry about this, and thank you for telling us. A member of our team will look into it and reply in this chat with the next step.

For praise:

> Thank you so much for your kind words. If you have a moment, a review or a word to a friend would mean a great deal to us.

A chat in Japanese gets the Japanese texts, which are in `server/src/domain/inquiry-replies.ts`. The admin bundles the same words in `admin/src/inquiries.ts`, and a test holds the two equal. A question, and an inquiry in no queue, has no suggested text: a question needs an answer written for it.

### The routes and their codes

The routes are admin routes, so each takes an admin session that holds its permission:

| Route | Permission | Body | Answers |
|---|---|---|---|
| `GET /maison/inquiries?filter=…&limit=…` | Review customer inquiries | None. `filter` is `needs-answer` (the default), `complaint`, `praise`, `not-labelled` or `all`, and `limit` is 1 to 100 (50 by default) | `{ inquiries }`, newest first |
| `GET /maison/inquiries/summary` | Review customer inquiries | None | `{ needsAnswer, complaint, praise, notLabelled }`, the open counts |
| `GET /maison/inquiries/quota` | Review customer inquiries | None | `{ configured, used, limit }`: `configured` is false without a channel access token, and then `used` and `limit` are null, as they are when LINE gives no answer. `limit` is null for a channel with none |
| `POST /maison/inquiries/:documentId/reply` | Reply to customer inquiries on LINE | `{ text }` | `{ documentId, status: "sent", message, warning? }`, or `status: "demo"` for a made-up demo customer ([Demo customers](#demo-customers)) |
| `POST /maison/inquiries/:documentId/close` | Reply to customer inquiries on LINE | `{ reason }`: `answered-elsewhere`, `not-needed` or `spam` | `{ inquiry, message }` |
| `POST /maison/inquiries/:documentId/label` | Reply to customer inquiries on LINE | `{ kind, sentimentLabel }`, one or both | `{ inquiry, message }` |
| `POST /maison/inquiries/:documentId/label-again` | Reply to customer inquiries on LINE | None | `{ inquiry, message }` |

The staff name for a reply comes from the signed-in admin's account, never from the request. `message` is in words staff can read: "Sent the reply on LINE.", "Closed the inquiry.", "Changed the label." or "It will be labelled again within a minute." A 200 from Reply with `warning: true` means LINE took the message but recording it failed: its `message` says so, and the page shows it as a warning that stays until it is dismissed. The errors:

| Status | When |
|---|---|
| 400 (`invalid_input`) | The filter isn't one of the five, `limit` is out of range, the reply text is empty or over 2,000 characters, the reason isn't one of the three, or Change label has neither a kind nor a sentiment, one that isn't a label, or only a sentiment for an inquiry with no kind |
| 404 (`not_found`) | No inquiry has that `documentId` |
| 409 (`already_closed`) | Reply or Close, for a closed inquiry |
| 409 (`already_replied`) | Reply or Close, for a replied inquiry |
| 409 (`use_question`) | Reply, for a hand-off: "Answer it under Questions (Q-4821)." Nothing is sent |
| 409 (`not_failed`) | Label again, for an inquiry the model didn't fail on, or one a person labelled |
| 502 (`failed`) | Reply, when LINE refused the message or couldn't be reached. The inquiry records why and stays open |
| 503 (`not_configured`) | Reply, when there's no `lineChannelAccessToken`. Nothing is sent or recorded |

Every error says why in its message, which is what the page shows.

### The permissions

| Permission | What it gives |
|---|---|
| MCP: log customer inquiries (`plugin::maison.inquiries.log`) | `log_inquiry`, for the customer token |
| Review customer inquiries (`plugin::maison.inquiries.view`) | The Inquiries tab, the Maison inquiries widget, the three GET routes, and a way into the Maison page |
| Reply to customer inquiries on LINE (`plugin::maison.inquiries.reply`) | The four buttons above. It needs Review customer inquiries too, because the buttons live in the tab |

**Reset demo activity** also deletes every inquiry, however many there are, whether each is open, replied to or closed.

## Run the ops agent

Strapi sends confirmations itself. The ops agent's tools are still there for an agent that retries the ones that didn't go out: `pending_confirmations` lists them, failed ones included, and `record_confirmation` records what the agent sent, with `recordedBy` set to `ops-agent`.

Point Claude Desktop at Strapi with the ops token and at LINE Bot MCP with a Messaging API channel access token. Then run the `send_pending_confirmations` prompt. The URL below is this project's Strapi, on port 1339. `npm run setup` writes the ops token to `strapi/.tmp/maison-ops-token`. [Ops tools for an agent](../../../../docs/ops-tools.md) has a command that adds the server to Claude Desktop on macOS without printing the token.

```json
{
  "mcpServers": {
    "maison": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:1339/mcp", "--header", "Authorization: Bearer ${MAISON_OPS_TOKEN}"],
      "env": { "MAISON_OPS_TOKEN": "<ops token>" }
    },
    "line-bot": {
      "command": "npx",
      "args": ["-y", "@line/line-bot-mcp-server"],
      "env": { "CHANNEL_ACCESS_TOKEN": "<channel access token>" }
    }
  }
}
```

## Extend it

- **Your own tools:** register them in your app's `register()`, reusing the plugin's services:
  - `strapi.plugin('maison').service('identity').getCustomerSubject(extra)` for the signed-in customer
  - `service('errors').toolError(code, message, hint)` for errors in the same shape
  - `service('catalog')` and `service('appointments')` for the same logic the tools use, including `listRequests` and `confirm`
- **Your own routes:** guard a customer route with `config: { auth: false, policies: ['plugin::maison.customer-session'] }`, and read the customer from `ctx.state.maisonCustomer`. For an `Authorization` header anywhere else, `service('identity').customerSession(authorization)` always runs `/mcp`'s session check first. It answers `{ status: 'signed_in', subject }`, `{ status: 'signed_out' }`, `{ status: 'unavailable' }` when customer sign-in isn't installed, or `{ status: 'error' }` when checking failed on the server: answer that with a 503, not a 401.
- **Fewer tools:** list them in `disabledTools`.

## Seed data

The demo catalog and the demo activity come from three JSON files and 18 images in `server/seed/`. The `files` list in `package.json` ships the folder with the plugin.

| File | What it holds |
|---|---|
| `content.json` | The `ja` and `en` locales, 3 boutiques, 3 collections, 12 products and their stock, in both languages |
| `knowledge.json` | 16 product knowledge entries, each with an English and a Japanese version |
| `activity.json` | The five made-up customers, with a request, a question and inquiries each ([Load demo activity](#load-demo-activity)) |
| `images/` | 18 JPEG images, one per boutique, collection and product, and `SOURCES.md`, which says where each came from |

- **Load demo catalog** reads `content.json`, uploads each image to the Media Library, and adds what is missing. It leaves an existing catalog alone. A test checks that every image the content names is in `images/`.
- **Load demo activity** reads `activity.json` ([Load demo activity](#load-demo-activity)).
- **Reset demo activity** deletes appointments, notifications, questions, inquiries, every admin's saved assistant chats and the knowledge entries staff added. The catalog and the seeded knowledge stay.
- **The Home page text** is not in this folder. It is the app's own single type, `home-page`, in `strapi/src/api/home-page`. Strapi writes its starting text in both languages when there is no Home page, and never overwrites an edit.

## Content types

The plugin has ten content types, all hidden from the Content-Type Builder. The app has one more, the `home-page` single type.

| Content type | Table | Draft and publish | Languages | In the Content Manager |
|---|---|---|---|---|
| `collection` | `maison_collections` | Yes | `ja`, `en` | Yes |
| `product` | `maison_products` | Yes | `ja`, `en` | Yes |
| `boutique` | `maison_boutiques` | Yes | `ja`, `en` | Yes |
| `stock-level` | `maison_stock_levels` | No | One | Yes |
| `appointment` | `maison_appointments` | Yes: a draft is a request, a published version is confirmed | One | Yes, with no `customer` field |
| `notification` | `maison_notifications` | No | One | Yes |
| `knowledge` | `maison_knowledge_entries` | Yes | `ja`, `en` | Yes |
| `question` | `maison_questions` | No | One | No |
| `inquiry` | `maison_inquiries` | No | One | No |
| `conversation` | `maison_conversations` | No | One | No |

## Services and rules

The services are in `server/src/services`. The rules that do not need Strapi are plain functions in `server/src/domain`, with unit tests that need no Strapi.

| Service | What it holds |
|---|---|
| `catalog` | Collections, products, boutiques, stock, opening hours in Tokyo time, and product knowledge search |
| `appointments` | Requests (30 minutes ahead at least, `maxOpenRequestsPerCustomer`, open hours), the board's lists and summary, and confirming |
| `identity` | Who the caller is: `getCustomerSubject`, `customerSession`, and the masking of LINE user IDs |
| `confirmations` | The ops tools' side: pending confirmations and recording a delivery |
| `line-confirmations` | Pushing the confirmation to LINE when a visit is confirmed, once, and Send again |
| `questions` | Handing a question to staff (five open or taken per customer), Let them know, Answer, and the product knowledge loop |
| `inquiries` | Recording turns, the queues, Reply on LINE, Close, Change label and Label again |
| `labelling` | The per-minute sweep and the model call ([Labelling](#labelling)) |
| `assistant`, `conversations` | The staff assistant's chat and each admin's saved chats ([The assistant drawer](#the-assistant-drawer)) |
| `seed` | Load demo catalog, Load demo activity and Reset demo activity |
| `errors` | `toolError`, the `{ error: { code, message, hint } }` shape |

- **A document middleware** (`server/src/document-middleware.ts`) checks products, boutiques, knowledge entries and stock levels on create and update, the same for the admin and for the tools. After an appointment is published, it sends the LINE confirmation ([LINE confirmations](#line-confirmations)).
- **`bootstrap`** registers the 13 admin permissions ([Permissions](#permissions)), adds the error middleware for the customer routes, warns about a missing `liffUrl` or a bad `demoLineUserId`, and adds the labelling cron job.
- **`register`** registers the tools and the prompt on `strapi.ai.mcp`, and only when Strapi's MCP server is enabled.

## Permissions

The 13 actions are registered in `server/src/bootstrap.ts`. Grant the "MCP" ones on admin tokens, and the others on admin roles.

| Permission | Action |
|---|---|
| MCP: browse the catalog | `plugin::maison.catalog.read` |
| MCP: request and view own appointments | `plugin::maison.appointments.request` |
| MCP: review appointment requests | `plugin::maison.appointments.review` |
| MCP: confirm appointment requests | `plugin::maison.appointments.confirm` |
| MCP: send appointment confirmations | `plugin::maison.confirmations.send` |
| MCP: hand questions to staff | `plugin::maison.questions.ask` |
| MCP: log customer inquiries | `plugin::maison.inquiries.log` |
| Read customer questions | `plugin::maison.questions.read` |
| Answer customer questions on LINE | `plugin::maison.questions.answer` |
| Review customer inquiries | `plugin::maison.inquiries.view` |
| Reply to customer inquiries on LINE | `plugin::maison.inquiries.reply` |
| Load and reset demo data | `plugin::maison.demo.manage` |
| Use the Maison assistant | `plugin::maison.assistant.use` |

The five catalog routes use a different set of actions, which a role or an API token holds ([Grant the catalog](#grant-the-catalog)).

## TanStack AI in the plugin

| What | Where | TanStack AI API |
|---|---|---|
| The one loader | `server/src/ai/sdk.ts` | A cached dynamic `import()` of `@tanstack/ai`, `@tanstack/ai-anthropic` and `@tanstack/ai-ollama` |
| The model choice | `server/src/ai/provider.ts` | `createAnthropicChat(model, key)` or `createOllamaChat(model, host)` |
| Inquiry labelling | `server/src/services/labelling.ts` | `chat({ outputSchema })` with a zod 4 schema from `@strapi/utils`, and `wrapFetch` to read the HTTP status |
| The assistant, server | `server/src/services/assistant.ts` | `chatParamsFromRequestBody`, `chat()`, `maxIterations(6)` and `toServerSentEventsResponse` |
| The assistant's tools | `server/src/ai/sdk.ts` (`toTools`), `server/src/assistant/tools.ts` | `toolDefinition(...).server(...)` |
| The assistant, admin | `admin/src/components/assistant/AssistantProvider.tsx` | `useChat` from `@tanstack/ai-react` and `fetchServerSentEvents` from `@tanstack/ai-client` |

- **Why one loader.** The plugin's server is CommonJS, and the TanStack AI packages have no `require` export. Only `ai/sdk.ts` names them, and only through `await import()`, so Strapi does not load them at start-up.
- **The build checks it.** `npm run build` runs `scripts/check-esm-import.mjs` afterwards. It fails when a built server bundle loads any of the packages statically. A unit test holds that only `ai/sdk.ts` names them.
- **The Haiku ID.** Labelling passes `claude-haiku-4-5-20251001` to `createAnthropicChat` with one typed cast, because the adapter's model list has `claude-haiku-4-5` only.
- **No Vercel AI SDK.** Nothing in the plugin imports `ai` or `@ai-sdk/*`.

## Development

Run these from `strapi/src/plugins/maison`:

```bash
npm test                    # unit and component tests (vitest, with jsdom and Testing Library for the admin)
npm run test:ts:back        # type-check the server
npm run test:ts:front       # type-check the admin
npm run test:integration    # builds the plugin, checks the shared @strapi/utils, then boots Strapi in process
npm run test:live           # labelling with a real model, skipped without AI_API_KEY (or, for ollama, AI_BASE_URL)
npm run build               # strapi-plugin build, then the ESM check
npm run watch               # rebuild on each change
```

- **Unit tests** need nothing running. `npm test` leaves the live test out.
- **Integration tests** (`test/integration/*.test.mjs`) boot this project's Strapi in the same process, each suite on its own SQLite file `strapi/.tmp/maison-test-<name>.db`, and listen on a free port, so they never touch the dev server or its database. The harness keeps the app's `LINE_CHANNEL_ACCESS_TOKEN` and its `AI_*` settings out of Strapi and stops Strapi's cron, so the labelling job does not race a suite's own calls. The LINE suites point `lineApiBaseUrl` at a stand-in on a free local port, and the labelling suite talks to a stand-in Ollama server. No test reaches LINE or a model.
- **The live test** sends sample exchanges to the model the `AI_*` environment variables name, through the same code as the sweep, and never prints the key: `AI_API_KEY=... npm run test:live`, or `AI_PROVIDER=ollama AI_BASE_URL=http://127.0.0.1:11434 AI_MODEL=<a pulled model> npm run test:live` for Ollama. The root [Testing](../../../../docs/testing.md) page has the full list.
- **The assistant's tests never reach Anthropic.** They use a scripted adapter, set through the service's `adapterFor`.
- **The README test** (`test/unit/readme-ask.test.ts`) holds this file's section on the assistant drawer to the code: the tools, the routes, the limits, the widths and the quick questions.
- The plugin runs from `dist/`, so rebuild and restart Strapi after changing it.
