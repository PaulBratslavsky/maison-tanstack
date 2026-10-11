# Deploying and running in production

The two halves deploy separately: the app in `app/` to [Vercel](https://vercel.com), and Strapi in `strapi/` to [Strapi Cloud](https://strapi.io/cloud). The code is ready for both. Nothing in this repository deploys anything, and nothing has run on Vercel or Strapi Cloud yet. Where this page says "expected", it is from documentation or from the installed packages, not from a run on those hosts.

## What was checked on a laptop

| Check | Result |
| --- | --- |
| `NITRO_PRESET=vercel npm run build` in `app/` | Writes Vercel's Build Output API v3 to `app/.vercel/output`: static files, a catch-all function `functions/__server.func`, and a second function `functions/api/concierge.func` whose `.vc-config.json` has `maxDuration` 60 and `regions` `["iad1"]` ([The output](#the-vercel-output)) |
| The built function, run by a small Node server | Answers pages, and streams a server-sent event answer chunk by chunk, half a second apart, without waiting for the end |
| `npm run build`, `npm start`, `npm run start:line`, `npm run dev` in `app/` | Unchanged for the laptop: with no `VERCEL` variable Nitro builds its Node server preset into `app/.output`, and `vite preview` serves that |
| `npm install` in `strapi/` alone (a clean copy of the repository), with and without `NODE_ENV=production` | `postinstall` builds the Maison plugin and shares `@strapi/utils`. `pg` installs |
| `NODE_ENV=production npm run build` in `strapi/` | Passes. It needs no database |

## Where each part runs

- **The app** is a TanStack Start project on Vercel, with `app/` as the project's root directory. Its settings are the Vercel project's environment variables.
- **Strapi** runs on Strapi Cloud, with `strapi` as the project's **Base directory** (Strapi's [Project deployment](https://docs.strapi.io/cloud/getting-started/deployment) page). Strapi Cloud runs with `NODE_ENV=production`, so Strapi ignores `LINE_VERIFY_URL` there, and LINE verifies every ID token (`strapi/config/plugins.ts`). The production config in `strapi/config/env/production/` listens on `0.0.0.0` with `proxy: true`, and uses PostgreSQL (`strapi/package.json` has `pg`).

## The app on Vercel

### How it is built

Sources: the `deployment` skill of `@tanstack/start-client-core` (`app/node_modules/@tanstack/start-client-core/skills/start-core/deployment/SKILL.md`: Start deploys "via Vite and Nitro"), and Nitro 3.0.260903-beta, installed in `app/node_modules/nitro`: its Vercel page (`dist/docs/1.deploy/2.providers/21.vercel.md`) and its Vercel preset (`dist/_presets.mjs`).

- **Nitro is a dependency, pinned exactly** in `app/package.json` (`nitro` 3.0.260903-beta). The skill shows `nitro@npm:nitro-nightly@latest`. This project pins the published beta, because a nightly changes under you.
- **`app/vite.config.ts` has `nitro(nitroOptions)`,** after `tanstackStart()` and before the React plugin. The options are in `app/src/lib/nitro-options.ts`, with a test.
- **The preset is not set in code.** Nitro takes `preset` from the config, then `NITRO_PRESET`, and otherwise detects the host (`dist/_chunks/nitro.mjs` `_loadUserConfig`, then `resolvePreset` in `dist/_presets.mjs`). On Vercel's build the `VERCEL` variable is set, Nitro detects it and builds the `vercel` preset. On a laptop it builds `node-server`. To build the Vercel output on a laptop, set `NITRO_PRESET=vercel`.
- **The build commands are Vercel's defaults for this project:** install `npm install`, build `npm run build` (which is `vite build`). Nitro writes the output to `.vercel/output` in the root directory, and Vercel serves that. There is no output directory to set.
- **Node.** `app/package.json` has `engines.node` `>=22.12.0`. Nitro writes the function's `runtime` from the Node version that builds it (`nodejs24.x` on this laptop, which has Node 24). On Vercel that is the project's Node.js version.
- **Environment files.** `.env` is read by `vite dev` and `vite preview` only. A deployed server gets real variables from Vercel. Nitro's `preview` prints this too.

### The function duration and the region

A turn of the concierge may run 55 seconds, and the end-of-turn log may take 5 more (`app/src/lib/concierge/turn.ts`, `TURN_BUDGET_MS` and `LOG_TIMEOUT_MS`). So `/api/concierge` needs 60 seconds. Next.js had `maxDuration = 60` in the route. Here `app/src/lib/nitro-options.ts` has:

- `vercel.functionRules['/api/concierge'] = { maxDuration: 60 }`. Nitro's `generateFunctionFiles` gives each rule its own function directory (`functions/api/concierge.func`), with the base config and the rule merged, and adds a route in `config.json` that sends `/api/concierge` to it. A test holds that 55 + 5 seconds fit in the 60.
- `vercel.functions.regions = ['iad1']`, the same region as the original's `liff/vercel.json`. Nitro's `vercel.regions` option is for edge functions only: the function config is `vercel.functions`. Change the region to the one nearest your Strapi Cloud project.

Every other route runs in `__server.func`, with no `maxDuration` of its own, so Vercel's default applies. Check that your Vercel plan allows 60 seconds.

### The Vercel output

What `NITRO_PRESET=vercel npm run build` wrote to `app/.vercel/output`:

| Path | What it is |
| --- | --- |
| `config.json` | Version 3. Routes: `/assets/(.*)` gets `cache-control: public, max-age=31536000, immutable`. Then `handle: filesystem` serves static files first. Then `/api/concierge` goes to its function, and everything else goes to `/__server` |
| `static/` | The client build (`assets/`, with hashed names) and `public/` (`line/`) |
| `functions/__server.func` | The catch-all function: `launcherType` `Nodejs`, `supportsResponseStreaming` `true`, `regions` `["iad1"]` |
| `functions/api/concierge.func` | A copy of it with `maxDuration` `60` |

- **Server-sent events stream.** Both functions have `supportsResponseStreaming: true`, and the handler is the web `fetch` format (`dist/presets/vercel/runtime/vercel.web.mjs`), which returns the `Response` as it is. The concierge's response has `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` (`app/src/lib/concierge/handle.ts`). On a laptop the built function streamed a test event stream chunk by chunk.
- **Both folders are ignored by git:** `.vercel/` and `.output/` are in `.gitignore`, and `app/.vercelignore` keeps them out of a `vercel deploy` upload. Nitro makes no other output folder.
- **Rebuild before `npm start`.** A build for Vercel goes to `.vercel/output`, and a normal build to `.output`. `vite preview` serves the last build Nitro made (recorded in `app/node_modules/.nitro/last-build.json`), so after a Vercel build, run `npm run build` before `npm start`. `npm run start:line` builds first, so it is not affected.

### CSRF behind Vercel

`app/src/start.ts` adds Start's CSRF check for server functions. A browser that sends `Sec-Fetch-Site: same-origin` passes on that header alone, with no URL. Without it, the check compares `Origin` (or `Referer`) with `new URL(request.url).origin` (`@tanstack/start-client-core` `createCsrfMiddleware.ts`).

- **The URL on Vercel.** Nitro's Vercel handler passes the request through as Vercel gives it (`vercel.web.mjs`: it adds `ip` and `waitUntil`, and does not touch the URL). So the origin comes from Vercel's runtime, whose launcher is not in any installed package, and it was not run here. Vercel's own web handler in `@vercel/node` builds the URL from `x-forwarded-proto` (default `https`) and `x-forwarded-host`, and every public request to Vercel is https. So the URL is expected to be `https://<host>`, and a LINE WebView without `Sec-Fetch-Site` is expected to pass. This is not confirmed.
- **Check it on a preview deployment** ([Vercel](#3-vercel), step 7).
- **Behind the ngrok tunnel nothing changes.** `npm run start:line` still uses `vite preview`, and Nitro's preview builds each request with srvx and no trusted proxy (`nitro/dist/vite.mjs` `configurePreviewServer`, srvx 1.0.5 `adapters/node.mjs`), so the app sees `http://<domain>`. A server function request with `Origin: https://...`, `X-Forwarded-Proto: https` and no `Sec-Fetch-Site` still gets 403 (tested on a laptop). The limit in [Running with LINE](line-setup.md) stays.


### Variables on the app

Set these in the Vercel project's **Settings**, **Environment Variables**.

- **`VITE_*` names are built into the browser code at build time.** Vite replaces `import.meta.env.VITE_*` when it builds (`app/src/lib/config.ts`). A change needs a new build, so redeploy after any change to one. Never put a secret in a `VITE_*` name.
- **Other names are read at run time,** from `process.env`, inside each request (`app/src/routes/api/concierge.ts`, `app/src/lib/strapi-origin.ts`, `app/src/lib/home-page.ts`). The execution-model skill of `@tanstack/start-client-core` says to read them inside a handler, which this code does.
- **Local `.env` files are for the laptop.** TanStack Start's Vite plugin fills `process.env` from them in `vite dev` and `vite preview` only. A built server does not read `.env`: Vercel gives it real variables.

| Variable | What it is for | Required | Production value |
| --- | --- | --- | --- |
| `VITE_LIFF_MOCK` | Turns the LIFF mock off, so customers sign in with LINE. It also turns on the app's routes for `/mcp`, the token endpoint and `/uploads` | Yes | `false`. Set it: `app/.env.example` has `true`, and any value but `false` runs the mock, which Strapi refuses in production |
| `VITE_LIFF_ID` | The LIFF app that signs customers in, and the "Open in LINE" link outside LINE | Yes | Your production LIFF app's LIFF ID. The LIFF app's Endpoint URL is the Vercel app's URL |
| `VITE_STRAPI_URL` | Where the browser reaches Strapi: the token exchange and `/mcp`. It is also the base of relative media URLs | Yes | The Vercel app's own https origin, with no trailing slash. The app's routes pass `/mcp`, the token endpoint and `/uploads` on to `STRAPI_URL` |
| `VITE_MAISON_CLIENT_ID` | The "Maison app" OAuth client | Yes | The client ID from step 9 of [First-time setup on Strapi Cloud](#first-time-setup-on-strapi-cloud) |
| `STRAPI_URL` | Where the app's server reaches Strapi: the concierge's MCP calls, the Home page text and the proxy routes. Its default, `http://127.0.0.1:1339`, does not exist on Vercel | Yes | The Strapi Cloud URL: https, with no trailing slash |
| `ANTHROPIC_API_KEY` | The concierge's model, Claude Sonnet 5.5 | Yes | A secret: your Anthropic API key |
| `VITE_LINE_OA_ID` | The **Chat with Maison on LINE** and **Send it in the LINE chat** buttons. Empty, they do not appear | No, but recommended: a confirmation only reaches a customer who has added the Official Account | Your Official Account's basic ID, with the `@` |
| `VITE_DEMO_LOCALE` | The language when neither the customer nor LINE gives one | No | `en`, the default |

- **Without a model key,** the concierge calls Ollama on localhost, which does not exist on Vercel. The original also had Vercel AI Gateway. This edition does not, because TanStack AI has no adapter for it.
- **Leave the laptop's settings unset:** `VITE_DEMO_LINE_USER_ID` (the mock's customer), `OLLAMA_MODEL` and `OLLAMA_BASE_URL`, `LINE_MODE_LIFF_ID`, `LINE_MODE_CHANNEL_ID` and `LINE_MODE_DOMAIN` (`npm run mode:line`), and `LINE_LOGIN_CHANNEL_ID` and `MOCK_LINE_VERIFY_PORT` (the verify mock).
- **`VITE_STRAPI_URL` can be the Strapi Cloud URL instead.** The browser then calls Strapi Cloud directly, and Strapi Cloud needs `MAISON_APP_ORIGIN` set to the Vercel app's origin, for CORS.
- **The CSRF check on Vercel** is expected to see the https origin, so LINE WebViews without `Sec-Fetch-Site` pass. It is not confirmed: see [CSRF behind Vercel](#csrf-behind-vercel). The limit in [Running with LINE](line-setup.md) is for `vite preview` behind a tunnel only.

## Strapi on Strapi Cloud

Set these under the project's **Settings**, **Variables**, for its environment (Strapi's [Cloud project settings](https://docs.strapi.io/cloud/projects/settings#variables)). Each value goes only into the project's variables: never into a commit.

| Variable | What it is for | Required | Production value |
| --- | --- | --- | --- |
| `APP_KEYS`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET` | Strapi's own secrets | Yes | Secrets. Check that each one is listed under **Variables**, and add any that is missing with a random value. Never copy one from `strapi/.env` |
| `ENCRYPTION_KEY` | Strapi encrypts admin token keys with it, and oauth-mcp-manager needs it for customer sign-in | Yes | A secret random value. Set it before you create the admin tokens, and never change it afterwards |
| `PUBLIC_URL` | Strapi's public address: the admin, absolute media URLs and oauth-mcp-manager's metadata. The production config has no default | Yes | The Strapi Cloud URL: https, with no trailing slash. Not the app's origin |
| `LINE_LOGIN_CHANNEL_ID` | Turns on LINE sign-in. Strapi checks each ID token with LINE, for this channel | Yes | Your LINE Login channel's ID, digits only. Never the mock's `1234567890` |
| `MAISON_LIFF_URL` | The base of the link in each LINE confirmation, followed by `/visits/<reference>`. Unset, Strapi sends no confirmations | Yes | `https://liff.line.me/` followed by your LIFF ID, with no trailing slash |
| `LINE_CHANNEL_ACCESS_TOKEN` | Sends visit confirmations and staff replies on LINE. Unset, nothing is sent, and the board shows "not sent" | Yes | A secret: your Messaging API channel's access token |
| `MAISON_APP_ORIGIN` | Adds the app's origin to Strapi's CORS | Only when `VITE_STRAPI_URL` is the Strapi Cloud URL | The Vercel app's https origin, with no path and no trailing slash |
| `AI_API_KEY` | Labels customer inquiries, and runs the staff assistant. Unset, labelling is off and the assistant says it is not set up | No, but recommended | A secret: an Anthropic API key |
| `AI_CHAT_MODEL` | The staff assistant's model | No | Leave unset: `claude-sonnet-5-5` |
| `AI_PROVIDER`, `AI_MODEL` | The labelling provider and model | No | Leave unset: Anthropic, with `claude-haiku-4-5-20251001`. The assistant works with Anthropic only |
| `MCP_ENABLED` | Strapi's MCP server at `/mcp` | No | `true`, the default. Leave it unset |
| `MAISON_DEMO_LINE_USER_ID` | Gives your own LINE account demo items when you press **Load demo activity** | No | Your LINE user ID: `U` and 32 lowercase hex characters. Any other value is ignored with a warning |

Never set these on Strapi Cloud:

- **`DATABASE_*`.** Strapi Cloud injects its own PostgreSQL connection, and stops injecting it when you add one of these (Strapi's [Database](https://docs.strapi.io/cloud/advanced/database) page).
- **`HOST` and `PORT`.** The production config listens on `0.0.0.0`, as Cloud needs. `HOST=127.0.0.1`, as in `strapi/.env.example`, would cut Strapi off from Cloud's proxy.
- **`MAISON_PUBLIC_DIR`.** It moves Strapi's public folder, uploads included. Only the integration tests set it. Unset, it is `./public`.
- **`NODE_ENV`.** Strapi Cloud sets it to `production`.
- **`LINE_VERIFY_URL`, `MAISON_LINE_API_BASE_URL` and `AI_BASE_URL`.** On a laptop they point at the verify mock, the LINE stand-in and an Ollama host. Strapi ignores `LINE_VERIFY_URL` in production.
- **`DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `MAISON_SETUP_APP_ENV` and `MAISON_SETUP_OPS_TOKEN_FILE`.** They are inputs for `npm run setup`, which never runs against Strapi Cloud. Strapi does not read them.

Redeploy after changing a variable: press **Save & deploy** in the **Variables** tab, or **Trigger deployment** on the project dashboard (Strapi's [Cloud deployments management](https://docs.strapi.io/cloud/projects/deploys)).

**Time limits.** The staff assistant may stream for up to 90 seconds. Check that Strapi Cloud's proxy allows a request that long. This was not checked.

## The switch-over checklist

This switches Strapi Cloud and the Vercel project from the original (`maison-demo`, a Next.js app) to this project, in this order: the GitHub repository, then Strapi Cloud, then Vercel. Strapi goes first because the original app keeps working against the new Strapi: both use the same Maison plugin name, content types, REST routes and MCP tools. Each step has a check and a rollback. Do not start the next step until the check passes.

Before you start:

- [ ] On this laptop, `npm test`, `npm run test:e2e` and, in `app/`, `npx tsc --noEmit` and `npm run build` all pass, and `git status` is clean.
- [ ] You have the values for [the app's variables](#variables-on-the-app) and [Strapi's variables](#strapi-on-strapi-cloud) to hand. You paste each secret into the dashboard yourself. No secret goes into a commit, a chat or this page.
- [ ] Strapi Cloud has a recent backup of the production database (its own backups, in the project's settings).
- [ ] You wrote down, for each dashboard, what it uses today: the repository, the branch, the base directory, the Node version and the variable names. These are what a rollback goes back to.

### 1. GitHub repository

1. Create an empty repository on GitHub: `<owner>/<repository>`, public if you want it public. Add no README, licence or `.gitignore`: the project has them.
2. In this project, run `git remote add origin <url>`, then `git push -u origin main`. A push needs your explicit OK.

**Check it worked:**
- The repository shows `app/`, `strapi/`, `docs/` and `scripts/` on `main`.
- Before the push, `git ls-files | grep -E '(^|/)\.env'` printed only `.env.example` files. After it, the repository's file search for `.env` finds only those.

**Roll back:** delete the repository, or make it private. Nothing depends on it until step 2.

### 2. Strapi Cloud

Strapi's own steps for changing the repository are in its [Cloud project settings](https://docs.strapi.io/cloud/projects/settings).

1. Open the project, **Settings**, **General**, **Connected Git repository**, **Update repository**. Choose the new repository.
2. In the **Select Git branches** section, set the branch to **`main`** and the **Base directory** to **`strapi`**. For one environment, the same two fields are under its **Configuration** tab, in **Connected branch**.
3. Under the environment's **Configuration**, **Basic information**, check that the Node version is 22.12 or later (`engines` in `strapi/package.json` is `>=22.12.0 <=26.x.x`).
4. Under **Variables**, keep every variable the original has. Compare with [the table](#strapi-on-strapi-cloud). This project adds none that you must set. `AI_CHAT_MODEL` is optional (the staff assistant's model, default `claude-sonnet-5-5`). Leave `MAISON_PUBLIC_DIR` and `DATABASE_*` unset.
5. Press **Save & deploy**, or **Trigger deployment**.

The database stays as it is. This project's content types and the Home page schema match the original's, and the plugin has the same name. Strapi goes from 5.55.1 to 5.57.0, and its own migrations run once on the first start.

**Check it worked:**
- The deployment log shows `npm install` running the `postinstall` step: it builds the Maison plugin, then prints "Strapi core's @strapi/utils is shared by: maison, strapi-oauth-mcp-manager". Then `strapi build` passes.
- `<strapi-cloud-url>/admin` opens, and you can sign in.
- **MCP OAuth** shows no "Strapi's MCP server is disabled" or "Encryption key missing" alert, and **Connection details** reads "LINE sign-in is on for channel" with your channel's ID.
- **Maison** in the sidebar loads the requests board, the Questions and Inquiries tabs and the assistant drawer.
- `curl <strapi-cloud-url>/api/maison/products` answers 200 with the catalog.
- The original app on Vercel, which is still the live one, still shows the catalog and still signs in and chats.

**Roll back:** repeat steps 1 and 2 with the old repository, branch and base directory you wrote down, and redeploy. If the old Strapi will not start on the migrated database, restore the backup from before the switch.

### 3. Vercel

1. In the Vercel project, **Settings**, **Git**: connect the new repository, with `main` as the production branch.
2. **Settings**, **General**:
   - **Root Directory:** `app`.
   - **Framework Preset:** TanStack Start if Vercel lists it, otherwise **Other**. Nitro writes `.vercel/output` (Build Output API v3), and Vercel serves that with either preset.
   - **Build Command:** `npm run build` (`vite build`). **Install Command:** `npm install`. These are the defaults.
   - **Output Directory:** leave it empty.
   - **Node.js Version:** 22.x or 24.x.
3. **Settings**, **Environment Variables**: add the new names. Keep the old `NEXT_PUBLIC_*` names and `AI_GATEWAY_API_KEY` until step 8, so the live deployment and an instant rollback still work. Set each new name for **Production** and for **Preview**.

   | Original name | New name | Value |
   | --- | --- | --- |
   | `NEXT_PUBLIC_LIFF_MOCK` | `VITE_LIFF_MOCK` | `false` |
   | `NEXT_PUBLIC_LIFF_ID` | `VITE_LIFF_ID` | The same LIFF ID |
   | `NEXT_PUBLIC_STRAPI_URL` | `VITE_STRAPI_URL` | The same value: the app's own https origin, with no trailing slash |
   | `NEXT_PUBLIC_MAISON_CLIENT_ID` | `VITE_MAISON_CLIENT_ID` | The same "Maison app" client ID (the production database keeps its client) |
   | `NEXT_PUBLIC_LINE_OA_ID` | `VITE_LINE_OA_ID` | The same |
   | `NEXT_PUBLIC_DEMO_LOCALE` | `VITE_DEMO_LOCALE` | The same, or leave it unset for `en` |
   | `STRAPI_URL` | `STRAPI_URL` | The same Strapi Cloud URL |
   | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | The same key |
   | `AI_GATEWAY_API_KEY` | none | Not read. This project has no gateway |

4. Test on a preview first. Push a branch (for example `deploy-check`) to the new repository. Vercel builds it as a preview deployment. A push needs your explicit OK.
5. **Check the preview build:**
   - The build log says `Building [Nitro] (preset: vercel` and ends with the Build Output API.
   - The deployment's **Functions** list has `__server` and `api/concierge`, and `api/concierge` shows a 60 second maximum duration, in `iad1`.
   - The preview opens, the Home page text shows, and the catalog images load.
6. **Check the concierge:** open the preview inside a browser, ask a question, and watch the answer arrive word by word, not all at once. A slow turn is not cut off at 10 or 15 seconds.
7. **Check CSRF** (a preview may ask for Vercel's deployment protection bypass first). With no `Sec-Fetch-Site`, as an old LINE WebView sends:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'x-tsr-serverFn: true' -H 'Origin: https://<host>' https://<host>/_serverFn/nope
   ```

   Expected: `500`, because the request passes the CSRF check and the made-up function does not exist. A `403` means Start sees `http://<host>` on Vercel. Then add an `origin` option to the CSRF middleware in `app/src/start.ts` that also accepts the `https` form of the request's host, and test it.
8. Merge the branch into `main`. Vercel deploys it to production. Open the production URL and check the same things, then sign in with LINE in the LIFF app and ask for a visit. If the domain did not change, the LIFF app's Endpoint URL needs no change. Once it all works, delete the old `NEXT_PUBLIC_*` names and `AI_GATEWAY_API_KEY`.

**Roll back:** in the project's **Deployments** list, open the last good deployment from the original and choose **Instant Rollback**. This points production back at it without a build. It keeps its own variables. To go back for good, reconnect the old repository in **Settings**, **Git**. The old app works against the new Strapi, so a Vercel rollback needs no Strapi rollback.

### After the switch

- The original's repository is untouched by any of this.
- If the production domain changed, update the LIFF app's Endpoint URL in the LINE Developers console, and `MAISON_APP_ORIGIN` on Strapi Cloud if the browser calls Strapi directly.

## First-time setup on Strapi Cloud

Never run `npm run setup` against Strapi Cloud. On a new Strapi Cloud project, these steps do by hand what it does locally.

1. **Node version.** Strapi needs Node 22.12 or later (`engines` in `strapi/package.json`). Set it under the environment's **Configuration**, **Basic information** (Strapi's [Cloud project settings](https://docs.strapi.io/cloud/projects/settings)).
2. **The install step.** Strapi Cloud installs in the Base directory, `strapi`. `strapi/package.json`'s `postinstall` installs and builds the Maison plugin, then runs `node scripts/share-strapi-utils.mjs`. That script removes the plugin's own copy of `@strapi/utils`, so the plugin shares Strapi's, which keeps Maison's validation errors at 400 where the Content Manager would otherwise answer 500. Check the first build's log for "Removed the Maison plugin's own @strapi/utils" or "Strapi core's @strapi/utils is shared by". If the install runs without scripts, the plugin has no build and does not load. `strapi/package.json` lists the `pg` driver that `config/env/production/database.ts` needs.
3. **Variables.** Set the variables in [Strapi on Strapi Cloud](#strapi-on-strapi-cloud), then deploy.
4. **The first admin.** Open `/admin` on the Strapi Cloud URL and fill in the registration form. The first admin is a Super Admin (Strapi's [Role-Based Access Control](https://docs.strapi.io/cms/features/rbac)). Create the customer token (step 8) and the client (step 10) as the same admin: a client can only map an admin token its creator owns. For a narrow service admin instead, see [The customer token](#the-customer-token).
5. **Check that sign-in is ready.** Open **MCP OAuth** in the sidebar. It should show no "Strapi's MCP server is disabled" or "Encryption key missing" alert, and **Connection details** should read "LINE sign-in is on for channel" with your channel's ID. If not, fix `MCP_ENABLED`, `ENCRYPTION_KEY` or `LINE_LOGIN_CHANNEL_ID`, and redeploy.
6. **The demo catalog.** Open **Maison** in the sidebar and press **Load demo catalog** under **Demo data**. It adds the `ja` and `en` locales, 3 boutiques, 3 collections and 12 products in both languages, their stock, and 16 product knowledge entries in English and Japanese. It answers at once and adds them in the background, which takes up to a minute on Cloud's database. Press it again once that has passed: "The demo catalog and its product knowledge are already loaded." says it is done. The Home page's text needs no step: Strapi writes and publishes it on a new database.
7. **The Public role.** Go to **Settings**, **Users & Permissions plugin**, **Roles**, **Public**. Tick these, leave the rest as it is, and save:
   - under **Maison**: `find` on collections, products, boutiques and knowledge, and `findOne` on products
   - under **Home-page**: `find`
8. **The "Maison customer" token.** Go to **Settings**, **Administration Panel**, **Admin Tokens**, and press **Create new Admin Token** (Strapi's [Admin tokens](https://docs.strapi.io/cms/features/admin-tokens)):
   - **Name:** `Maison customer`
   - **Description:** `Every customer session of the Maison app runs with this token.`
   - **Token duration:** Unlimited
   - **Plugins** tab, **Maison:** tick only "MCP: browse the catalog", "MCP: request and view own appointments", "MCP: hand questions to staff" and "MCP: log customer inquiries".

   Save. Its key goes nowhere: the client in step 10 uses the token itself.
9. **The "Maison ops" token.** Create a second admin token on the same page. **Name:** `Maison ops`. **Token duration:** Unlimited. **Plugins** tab, **Maison:** tick only "MCP: send appointment confirmations". Save, and copy the key Strapi shows. Skip this token if no agent retries confirmations.
10. **The "Maison app" client.** Open **MCP OAuth** in the sidebar, and go to its **OAuth clients** section. If another client with the **LINE sign-in** badge is active, turn off its **Active** switch first: only one LINE client can be active, and turning it off ends its sessions. Then press **Add client**. **Name:** `Maison app`. **Customer sign-in:** "LINE: customers sign in with LINE". **Admin token:** Maison customer. Press **Create**, and copy the **Client ID**. A LINE client has no secret. See the [oauth-mcp-manager README](https://github.com/PaulBratslavsky/strapi-oauth-mcp-manager#readme).
11. **The app on Vercel.** Set the variables in [Variables on the app](#variables-on-the-app), with the Client ID from step 10 as `VITE_MAISON_CLIENT_ID`. Then redeploy the app.
12. **The ops agent.** Give it the "Maison ops" key from step 9, with the Strapi Cloud URL followed by `/mcp` ([Ops tools for an agent](ops-tools.md)). The key goes into no variable on Vercel or Strapi Cloud.

Later:

- **Keep the customer token's owner active.** If that admin is deleted, their tokens are deleted too. If the admin is deactivated or blocked, Strapi refuses their tokens. Either way, customers cannot sign in.
- **A new client gets a new client ID.** Set it as `VITE_MAISON_CLIENT_ID` on Vercel and redeploy the app. Delete the old client before its token: a client mapped to a deleted token refuses sign-in. Deleting the customer token ends every customer session.

## Production notes

### Staff roles

Give staff an admin role with the Maison actions they need instead of Super Admin:

| For | Permissions |
| --- | --- |
| The requests board | "MCP: review appointment requests", and "MCP: confirm appointment requests" for **Confirm** and **Send again** |
| The Questions tab | "Read customer questions", and "Answer customer questions on LINE" for its buttons |
| The Inquiries tab | "Review customer inquiries", and "Reply to customer inquiries on LINE" for its buttons |
| The assistant drawer | "Use the Maison assistant", plus a permission that shows the Maison menu link. The assistant offers only the tools the role allows |
| Demo data | "Load and reset demo data". Do not give it to staff in production: **Reset demo activity** deletes appointments, questions, inquiries and every admin's saved assistant chats |

### The customer token

The "Maison customer" token belongs to a dedicated service admin with a narrow role. A token's permissions are limited to its owner's, so a narrow owner keeps the token from being given more by mistake. A token cannot hold a permission its owner's role lacks, so that role needs:

- the token's four Maison actions: "MCP: browse the catalog", "MCP: request and view own appointments", "MCP: hand questions to staff" and "MCP: log customer inquiries"
- the **Admin tokens** settings permissions, to create the token
- "Manage MCP OAuth clients and grants", to create the client

The service admin then creates both the token and the "Maison app" client: a client can only map an admin token its creator owns.

### LINE sign-in and origins

- **Never set `LINE_VERIFY_URL`** in production.
- **Serve everything over https.** On Strapi Cloud, `PUBLIC_URL` is the Strapi Cloud URL, because the admin is served there. Only [option B](line-setup.md#option-b-the-real-app-inside-line)'s tunnel sets it to the app's origin.
- **`MAISON_APP_ORIGIN`** adds one origin to Strapi's CORS, for an app or website that calls Strapi from the browser on another origin. The Vercel app needs it only when its `VITE_STRAPI_URL` is the Strapi Cloud URL.
- **Bind to 127.0.0.1 on a laptop.** On Strapi Cloud, leave `HOST` unset.

### The Public role

The Public role reads the catalog and the Home page over REST, because `npm run setup` grants it six actions on every run: the five catalog actions and `api::home-page.home-page.find`. If your catalog is not public, remove its five under **Settings**, **Users & Permissions plugin**, **Roles**, **Public**, give websites an API token instead, and leave them unticked in step 7. Without the Home page's `find`, the app shows its built-in Home text.

### The REST API's customer routes

They skip two of `/mcp`'s checks: core's expiry check on the session's admin token, and the tool's own permission (the plugin's README, [The customer session](../strapi/src/plugins/maison/README.md#the-customer-session)). Keep sessions short, with oauth-mcp-manager's `endUserAccessTokenTtl`.

### Staff agents read what customers wrote

`appointment_requests` gives a staff agent customers' notes, up to 500 characters each, which could try to instruct the model. The tool descriptions tell it to treat notes as information, and to confirm only a reference the staff member asked for. Keep `appointments.confirm` off an agent's token, or add an approval step for tools that write.

### LINE confirmations

One Strapi sends each LINE confirmation once. A visit's `sent` record stops a second send, and two sends at the same moment share one push, but only within one Strapi process. With more than one process, add a claim row, LINE's `X-Line-Retry-Key` or an outbox (the plugin's README, [LINE confirmations](../strapi/src/plugins/maison/README.md#line-confirmations)).

### Customer data

Each customer's full LINE user ID is stored in Strapi (appointments, questions, inquiries and oauth-mcp-manager's sessions). Staff see it masked, and the admin API never returns it. [Running with LINE](line-setup.md) lists what each sign-in and each request stores. If your license includes audit logs, they also record what admins do.

### Local checks that stay local

- **`npm run line:stand-in`** (port 4011) and `MAISON_LINE_API_BASE_URL` are for checks on a laptop, so nothing reaches a phone. Leave `MAISON_LINE_API_BASE_URL` unset everywhere else.
- **`npm run tunnel`** and `npm run start:line` are for running the app inside LINE from a laptop. They are not a production setup.
