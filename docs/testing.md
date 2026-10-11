# Testing

Five commands from the repository root run the tests. The plugin and the app also have commands of their own.

| Command | What it runs | Needs running | Leaves behind |
| --- | --- | --- | --- |
| `npm test` | The app's unit tests, the plugin's unit tests (with the README test), the `@strapi/utils` check, and the `node --test` suites of `scripts/` and `app/scripts/` | Nothing | Nothing |
| `npm run test:integration` | The plugin's integration suites: 21 files, each boots Strapi in this process | Nothing. Stop Strapi if you want, it does not matter | Test databases and uploaded images (see below) |
| `npm run test:e2e` | Playwright tests of the app and its API, in local mode | `npm run dev` (Strapi, the app and the verify mock), and `npm run setup` done once | Open requests and a changed demo database |
| `npm run test:live` | The concierge route against the running Strapi, on Ollama | `npm run dev`, `npm run setup`, and Ollama with the model | Inquiries and one open question |
| `npm run test:live:claude` | The visit picker's cases on Claude Sonnet 5.5 | `npm run dev`, `npm run setup`, and `ANTHROPIC_API_KEY` in `app/.env` | The same, and a charge from Anthropic |

## What each command does

### `npm test`

It runs, in order, and stops at the first failure:

1. `npm test --prefix app`: Vitest. Unit tests for every rule in `app/src/lib/`, the concierge route on a scripted model, the chat on the real `ChatClient`, and the components.
2. `npm test --prefix strapi/src/plugins/maison`: Vitest. Unit tests for the plugin's domain rules, services, MCP tools, routes, labelling, the staff assistant, and the admin components (jsdom and Testing Library). It includes `test/unit/readme-ask.test.ts`, which holds the plugin README's claims to the code.
3. `node strapi/scripts/share-strapi-utils.mjs --check`: fails when the plugin has its own copy of `@strapi/utils` ([the plugin's README](../strapi/src/plugins/maison/README.md#install)).
4. `node --test scripts/*.test.mjs app/scripts/*.test.mjs`: the suites for `init-env`, `npm run setup`, the Home page starting text, `line-mode`, the tunnel guard, the LINE stand-in, the verify mock, the QR code and the package scripts.

No test in it calls Anthropic, Ollama or LINE.

### `npm run test:integration`

- **What it does.** `pretest:integration` builds the plugin (`npm run build`, with the ESM check) and checks the shared `@strapi/utils`. Then `node --test --test-concurrency=1 "test/integration/*.test.mjs"` runs each suite: catalog, appointments, confirmations, questions, inquiries, labelling failures, knowledge, the staff assistant, the MCP tools, REST, permissions, summaries, the demo activity, the seed and the validation errors.
- **How.** Each suite boots Strapi in process, on its own SQLite file `strapi/.tmp/maison-test-<name>.db` (an earlier file of that name is deleted first), and listens on a free port. So it never touches the dev server or its database.
- **No live calls.** The harness keeps your `LINE_CHANNEL_ACCESS_TOKEN` and `AI_*` settings out of Strapi, stops Strapi's cron, and points LINE and Ollama at stand-ins on free local ports. It mints its own tokens.
- **What it leaves behind.** The 21 `strapi/.tmp/maison-test-*.db` files, and a `strapi/.tmp/maison-test-<name>-public` folder beside each one with that suite's seed images (about 150 MB in all). Each suite deletes its own database and folder before it boots. `strapi/public/uploads` is not touched: `MAISON_PUBLIC_DIR` moves Strapi's public folder for the suite. Earlier runs, before that change, left about 105 MB of seed images in `strapi/public/uploads` each; to clear them, reset the database and run `npm run setup` ([Start over with a clean database](../README.md#start-over-with-a-clean-database)).
- **Time.** About 75 seconds, after the build.

### `npm run test:e2e`

- **Before the first run.** `npm run dev` in one terminal, then wait until http://localhost:1339/_health answers 204. Run `npm run setup` once on a new database, and restart the app so it reads its OAuth client. The tests use the installed Google Chrome, so no browser is downloaded.
- **If nothing answers on port 3004,** Playwright starts `npm run dev` for the run and stops it after. Run `npm run dev` yourself, so the app and Strapi are not started twice.
- **What it checks.** Booking and **My visits**, Home's headline from Strapi in both languages, the language a booking sends, Osaka's closed day, a boutique without the piece, the Agent view, an unknown product, two customers, LINE's safe areas in portrait and landscape, the concierge chat on recorded streams (the picker, **Send request**, **Not now**, `?product=`, landscape), the LINE mode proxy answers in local mode, and **Chat with Maison on LINE**. API tests check each customer's visits, that the Content Manager's list and search keep customers out, and the REST API. No model is called: the concierge tests answer `POST /api/concierge` with streams recorded in `app/e2e/fixtures/`.
- **Two runs for one case.** The app is built with `VITE_LINE_OA_ID`, so the **Chat with Maison on LINE** tests need two runs: with `VITE_LINE_OA_ID` set in `app/.env`, then `VITE_LINE_OA_ID= npm run test:e2e` after stopping the app on 3004. Each run tests its case and skips the other, so one run always shows one skipped test.
- **What it changes.** Its setup signs in as the demo admin and calls `POST /maison/demo/reset`: it deletes every appointment, notification, question and inquiry, every admin's saved assistant chats, and the product knowledge that staff answers added. Several tests then book through the real Strapi and leave open requests. **Reset demo activity** before a talk.
- **It refuses LINE mode.** With `VITE_LIFF_MOCK=false` it stops at once. Run `npm run mode:local` first.
- **Sign-in limit.** Strapi allows five admin sign-ins per five minutes. A 429 in setup means wait.

### `npm run test:live` and `npm run test:live:claude`

- **What they do.** They send real messages to the concierge's route in process (`handleConcierge`), signed in as a fixed test customer with the verify mock's ID tokens, and make real MCP calls to the running Strapi. The route's events are read with a `StreamProcessor`, as the browser does.
- **They skip** with one plain line saying why when the app's client ID is missing, Strapi does not answer, or the model is not there. In LINE mode they refuse to run. The checks of the helpers in the same file run even when the model cases skip.
- **The local model** (`test:live`) always uses Ollama, even when a Claude key is set, so it costs nothing. `test:live:claude` runs the same four cases on Claude Sonnet 5.5, plus the Claude cases below. The four check that the demo's gift question is answered from the catalog tools, that the demo's first suggestion ends in a picker for Ginza, the next Saturday in Tokyo and 14:00 with nothing booked, that a care question is answered from product knowledge, and that "Can I pay in bitcoin?" shows the hand-off note.
- **Claude** (`test:live:claude`, which sets `LIVE_MODEL=claude`) checks the visit picker's cases: "Can we schedule one?" from a product page, the demo's first suggestion, and a copy of a production conversation of 3 October that ends in a picker for the Cabin Case 55. It only checks that a key is set, and never prints it.
- **What they leave.** Each turn is logged as an inquiry, and the bitcoin case leaves a question for staff open until you answer or reset it. Strapi allows a customer five open questions: past that, nothing is recorded, and the test still passes. **Reset demo activity** between rehearsals.
- **Status.** On 11 October 2026 all 17 passed on Claude Sonnet 5.5 (`npm run test:live:claude`). The Ollama run has not been tried on this laptop.

## The plugin's own commands

Run from `strapi/src/plugins/maison`:

| Command | What it does | Needs |
| --- | --- | --- |
| `npm test` | The unit and component tests | Nothing |
| `npm run test:watch` | The same, watching | Nothing |
| `npm run test:ts:back`, `npm run test:ts:front` | Type-check the server and the admin | Nothing |
| `npm run test:integration` | As above | Nothing |
| `npm run test:live` | Labelling with a real model: five sample turns, about a tenth of a cent on Claude | `AI_API_KEY`, or `AI_PROVIDER=ollama` and `AI_BASE_URL`. Skipped without them |

The live labelling test reads the environment. Load the Strapi file with Node, or pass the key in your shell:

```bash
node --env-file=../../../.env node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
AI_API_KEY=... npm run test:live
AI_PROVIDER=ollama AI_BASE_URL=http://127.0.0.1:11434 AI_MODEL=qwen3-14b-32k npm run test:live
```

Keep the key out of commits and chats.

## The app's own commands

Run from `app/`:

| Command | What it does |
| --- | --- |
| `npm test` | The unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` on the app |
| `npm run typecheck:e2e` | `tsc --noEmit` on the Playwright tests (`tsconfig.e2e.json`) |
| `npm run typecheck:live` | `tsc --noEmit` on the live tests (`tsconfig.live.json`) |
| `npm run build` | `vite build`. Rebuild in local mode before `npm start` if `npm run start:line` built `.output` last |
| `npm run test:e2e`, `npm run test:live`, `npm run test:live:claude` | As above. They load `strapi/.env` and `app/.env` |

## Writing tests

Write each test first and see it fail before the code that makes it pass.

## Known flaky test

One plugin unit test failed once in about 20 runs on 10 October 2026, right after the phase 5 fix round. It did not fail again in 20 runs, alone or under load, and its name was not captured. If a plugin unit test fails once and passes on the next run, write its name in `docs/progress.md`.
