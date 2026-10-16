# Maison on TanStack: from UX to AX with Strapi MCP

Maison is a demo for a fictional luxury house of trunks, bags and small gifts. It shows one idea: from UX to AX. The screens a customer taps (UX) and an agent that acts for the signed-in customer (AX) use the same tools. Both call one Strapi plugin and Strapi's built-in [MCP](https://modelcontextprotocol.io) server.

- **The customer app** is a LINE app (a [LIFF](https://developers.line.biz/en/docs/liff/overview/) app). Customers browse the catalog, ask for a gift, and request a boutique visit. Its **Agent view** shows the MCP call each screen makes.
- **The concierge** is a model that finds pieces with the same MCP tools the screens use. When a customer wants to visit, it fills in the **Book a visit** form in the chat, and the customer books with one tap.
- **Staff** work in the Strapi admin. They confirm visit requests, answer questions the concierge handed over, and read every concierge turn, labelled by Claude Haiku. A staff assistant drawer answers questions about all of this.
- **Strapi sends the confirmation on LINE** when staff confirm a visit, through LINE's Messaging API.

Maison is fictional. It runs on one laptop in local mode: LINE sign-in is simulated with LINE's LIFF mock and a local stand-in for LINE's ID token verify endpoint. It is also deployed, with Strapi on Strapi Cloud and the app on Vercel ([Production](docs/production.md)).

## The TanStack edition

This repository rebuilds [maison-demo](https://github.com/PaulBratslavsky/maison-demo) feature for feature, with these differences.

| Part | Original | This edition |
| --- | --- | --- |
| Customer app | Next.js | TanStack Start, with TanStack Router, Query and Form |
| Model calls | AI SDK (`ai`, `@ai-sdk/*`) | [TanStack AI](https://tanstack.com/ai) for every model call: the concierge (app server and browser), the staff assistant and inquiry labelling (Strapi) |
| Hosted models | Anthropic, Vercel AI Gateway | Anthropic only. TanStack AI has no adapter for Vercel AI Gateway, so it is left out |
| Local models | OpenAI-compatible servers, such as Ollama | Ollama through `@tanstack/ai-ollama`, with no key |
| Browser variables | `NEXT_PUBLIC_*` | `VITE_*` |
| Ports | Strapi 1338, app 3003, verify mock 4545, LINE stand-in 4010 | Strapi 1339, app 3004, verify mock 4546, LINE stand-in 4011 |
| Not found | No screen | A plain not-found screen |

`ai` and `@ai-sdk/*` appear in Strapi's lockfile only as dependencies of Strapi's own `@strapi/content-type-builder`. No code in this project imports them.

Both projects can run at once. `docs/progress.md` lists every other deliberate difference, with its reason.

## Quick start

You need Node.js 22.12 or later and npm.

```bash
npm install   # installs strapi/ and app/, builds the Maison plugin, creates both .env files with new secrets
npm run dev   # Strapi on :1339, the app on :3004 and the LINE verify mock on :4546, all on 127.0.0.1
```

The first start builds Strapi's admin, which takes a minute. Then, in a second terminal:

```bash
npm run setup   # the demo admin, the catalog and its public REST reads, the tokens and the app's OAuth client
```

Stop `npm run dev` (Ctrl-C) and start it again, so the app reads its OAuth client. Then open:

- **The app:** http://localhost:3004. Open it as `localhost`, not `127.0.0.1`: Strapi's CORS allows `http://localhost:3004` only. The app signs in a demo customer with the LIFF mock and starts in English. **EN** and **JA** in the header switch the language.
- **The Strapi admin:** http://localhost:1339/admin, then **Maison** for the requests board. Sign in with `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD`. Open `strapi/.env` in your editor to read them. `npm install` generated the password, and nothing prints it.

To try the whole flow, open **Ask the concierge** in the app and tap the first suggestion. The concierge suggests a gift and shows the **Book a visit** form, filled in. Tap **Send request**, then press **Confirm** on the Maison board.

## Models

| Use | Model | Set by |
| --- | --- | --- |
| The concierge | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | `ANTHROPIC_API_KEY` in `app/.env` |
| The concierge, with no key | `qwen3-14b-32k` on [Ollama](https://ollama.com) at `http://127.0.0.1:11434` | `OLLAMA_MODEL`, `OLLAMA_BASE_URL` in `app/.env`. A trailing `/v1` on `OLLAMA_BASE_URL`, as maison-demo had it, is dropped |
| The staff assistant | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | `AI_API_KEY` in `strapi/.env`; `AI_CHAT_MODEL` changes the model |
| Inquiry labelling | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | `AI_API_KEY` in `strapi/.env` |
| Inquiry labelling, with no key | Ollama | `AI_PROVIDER=ollama` and `AI_BASE_URL` in `strapi/.env` |

- **Restart after a change.** The app and Strapi read their `.env` files at start.
- **Ollama and the concierge.** It takes about 20 to 60 seconds a turn, where Claude takes seconds. Create the model from a `Modelfile`:

  ```text
  FROM qwen3:14b
  PARAMETER num_ctx 32768
  ```

  ```bash
  ollama pull qwen3:14b
  ollama create qwen3-14b-32k -f Modelfile
  ```

- **The staff assistant needs Claude.** It works with Anthropic only. Without `AI_API_KEY`, its drawer says it is not set up.
- **Without a labelling key,** labelling is off and new inquiries wait under **Not labelled**.

## Repository layout and ports

```
maison-tanstack/
  app/        TanStack Start customer app, with the concierge
  strapi/     Strapi 5.57 project, with src/plugins/maison
  scripts/    init-env, line-mode, tunnel, LINE stand-in, LINE verify mock
  docs/       spec, plan, progress ledger, and the how-to pages below
  package.json  root scripts: install both halves, dev, setup, test, LINE mode
```

| Path | What it is |
| --- | --- |
| `app/` | The customer app: screens, the browser MCP client, the concierge route `POST /api/concierge`, the LINE mode proxy routes, Playwright and live tests |
| `strapi/src/plugins/maison/` | The Maison plugin: content types, 13 MCP tools and a prompt, REST and admin routes, the Maison page, the staff assistant drawer, labelling and the seed data |
| `strapi/src/api/home-page/` | The Home page single type: the words on the app's Home screen, in English and Japanese |
| `strapi/scripts/maison-setup.mjs` | `npm run setup` |
| `scripts/` | `init-env.mjs` (runs on `npm install`), `line-mode.mjs`, `line-tunnel.mjs`, `line-stand-in.mjs`, `mock-line-verify.mjs`, each with a `node --test` suite |

| Process | Port |
| --- | --- |
| Strapi | 1339 |
| The app | 3004 |
| LINE verify mock | 4546 |
| LINE Messaging API stand-in | 4011 |

Everything listens on 127.0.0.1 only. The original uses 1338, 3003, 4545 and 4010: leave those free.

## Root scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Strapi, the app and the verify mock, together. Refuses to start in LINE mode |
| `npm run dev:strapi`, `npm run dev:app` | One half alone. `dev:app` and `npm start` in `app/` run the app with the verify mock, and start no second mock when one already answers on 4546 |
| `npm run setup` | The demo admin, catalog, Public grants, tokens and OAuth client. Safe to run again, but it replaces the app's OAuth client, so restart the app after it |
| `npm test` | The unit tests of both halves and the scripts. See [Testing](docs/testing.md) |
| `npm run test:integration`, `test:e2e`, `test:live`, `test:live:claude` | The tests that need more. See [Testing](docs/testing.md) |
| `npm run mode`, `mode:line`, `mode:local`, `start:line`, `tunnel`, `qr` | Running inside LINE. See [Running with LINE](docs/line-setup.md) |
| `npm run line:stand-in` | A local stand-in for LINE's Messaging API, so the staff follow-up reaches no phone |

## Start over with a clean database

1. Stop Strapi. Delete the database and the uploaded images together, keeping `.gitkeep`:

   ```bash
   rm -f strapi/.tmp/data.db
   find strapi/public/uploads -type f ! -name .gitkeep -delete
   ```

2. Start Strapi, run `npm run setup`, then restart the app and reload its page.

Delete the uploads only together with the database. The catalog's images are in `strapi/public/uploads/`.

## Documentation

| Page | What it covers |
| --- | --- |
| [How Maison works](docs/architecture.md) | The two halves, the MCP paths, sign-in, and where TanStack AI is used |
| [Testing](docs/testing.md) | Every test command, what it needs and what it leaves behind |
| [Deploying and running in production](docs/production.md) | The live setup on Vercel (the app) and Strapi Cloud (Strapi), and how it was switched over |
| [Running with LINE](docs/line-setup.md) | A real LINE message on your phone, the real app inside LINE, and running as a LINE MINI App |
| [The Maison plugin in this repo](docs/maison-plugin.md) | Where the plugin lives, how it shares Strapi's packages, and a summary of its reference |
| [The plugin's README](strapi/src/plugins/maison/README.md) | The full reference: tools, routes, permissions, configuration and admin pages |
| [Ops tools for an agent](docs/ops-tools.md) | The ops tools, and how to connect Claude Desktop |
| [Running the talk demo](docs/talk-demo.md) | Setup, checklist, the 3-minute run, rehearsal and a backup video |
| [The spec](docs/spec.md), [the plan](docs/plan.md), [the ledger](docs/progress.md) | What this rebuild is, how it was planned, and every decision |
