# Deploying and running in production

These are notes for a later deployment. They describe what to do. Nothing in this repository deploys anything, and no deployment has been made.

The two halves deploy separately: the app in `app/` to [Vercel](https://vercel.com), and Strapi in `strapi/` to [Strapi Cloud](https://strapi.io/cloud).

## What is not ready yet

| Gap | What to do |
| --- | --- |
| **The app has no Nitro server.** `app/vite.config.ts` has no `nitro()` plugin, and `nitro` is not installed. A TanStack Start build without Nitro makes a fetch handler in `app/dist/server`, not a server, and not Vercel's output. | Add Nitro ([the app on Vercel](#the-app-on-vercel)) |
| **`npm start` is `vite preview`.** It serves `app/dist` on 127.0.0.1 for the laptop and for `npm run start:line` behind the ngrok tunnel. It is not a production server. | Use Vercel's build, not `vite preview` |
| **No function duration is set.** `POST /api/concierge` needs 60 seconds. Next.js had `maxDuration = 60` in the route. TanStack Start has no such setting: the host sets it. | Set `maxDuration` ([below](#the-function-duration)) |
| **No `vercel.json` or `.vercelignore` in `app/`.** | Add them when you deploy. The original ignored every `.env` file in an upload |
| **`strapi/package.json` has no `pg` driver.** `strapi/config/env/production/database.ts` uses PostgreSQL, which Strapi Cloud provides. The original listed `pg`. | Run `npm install pg --prefix strapi` before the first Cloud deploy. Whether Cloud adds the driver itself was not checked |
| **Nothing was tested on Vercel or Strapi Cloud.** Everything below that says "expected" is from documentation, not from a run. | Test on a preview deployment first |

## Where each part runs

- **The app** is a TanStack Start project on Vercel, with `app/` as the project's root directory. Its settings are the Vercel project's environment variables.
- **Strapi** runs on Strapi Cloud, with `strapi` as the project's **Base directory** (Strapi's [Project deployment](https://docs.strapi.io/cloud/getting-started/deployment) page). Strapi Cloud runs with `NODE_ENV=production`, so Strapi ignores `LINE_VERIFY_URL` there, and LINE verifies every ID token (`strapi/config/plugins.ts`). The production config in `strapi/config/env/production/` listens on `0.0.0.0` with `proxy: true`, and uses PostgreSQL.

## The app on Vercel

### What TanStack Start needs

Sources: the `deployment` skill of `@tanstack/start-client-core` (`app/node_modules/@tanstack/start-client-core/skills/start-core/deployment/SKILL.md`, which says Start deploys "via Vite and Nitro"), TanStack's hosting guide for Vercel, and Nitro's Vercel page (nitro.build/deploy/providers/vercel).

1. **Install Nitro** in `app/`: `npm install nitro`. The skill shows `nitro@npm:nitro-nightly@latest`. Check TanStack's hosting guide for the current form, and pin an exact version.
2. **Add the plugin** to `app/vite.config.ts`, after `tanstackStart()` and before the React plugin:

   ```ts
   import { nitro } from 'nitro/vite'
   // plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()]
   ```

3. **Deploy through Vercel.** Nitro's page says Vercel supports Nitro with zero configuration, and the preset is `vercel`. Nitro writes Vercel's Build Output API v3. Whether Nitro picks the preset by itself on Vercel's build was not confirmed in its page: if it does not, set `preset: 'vercel'` in the Nitro options (`nitro.config.ts`, the `nitro` key in the Vite config, or the plugin's own options).
4. **Check the build.** `npm run build --prefix app` must then make Nitro's output (`.output`). Then test the output before the first deploy.

### The function duration

A turn of the concierge may run 55 seconds, and the end-of-turn log may take 5 more (`app/src/lib/concierge/turn.ts`, `TURN_BUDGET_MS` and `LOG_TIMEOUT_MS`). So `/api/concierge` needs 60 seconds.

Nitro sets Vercel function options per route with `vercel.functionRules` in its config. Its page shows this form, with `maxDuration` and `memory`:

```ts
// nitro.config.ts (expected form: Nitro's page shows /api/heavy-computation: { maxDuration: 800, memory: 4096 })
import { defineConfig } from 'nitro'

export default defineConfig({
  vercel: { functionRules: { '/api/concierge': { maxDuration: 60 } } },
})
```

Nitro's page does not say whether a route rule splits one route into its own function, and does not show a default duration. Check that your Vercel plan allows 60 seconds, and check in a preview deployment that a slow turn is not cut off.

The staff assistant is in Strapi, not in the app. See [the limits on Strapi Cloud](#strapi-on-strapi-cloud).

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
- **The CSRF limit in [Running with LINE](line-setup.md)** is specific to `vite preview` behind a tunnel, where Start sees `http://<domain>`. Whether Start on Nitro sees the https origin on Vercel was not tested.

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
- **`NODE_ENV`.** Strapi Cloud sets it to `production`.
- **`LINE_VERIFY_URL`, `MAISON_LINE_API_BASE_URL` and `AI_BASE_URL`.** On a laptop they point at the verify mock, the LINE stand-in and an Ollama host. Strapi ignores `LINE_VERIFY_URL` in production.
- **`DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `MAISON_SETUP_APP_ENV` and `MAISON_SETUP_OPS_TOKEN_FILE`.** They are inputs for `npm run setup`, which never runs against Strapi Cloud. Strapi does not read them.

Redeploy after changing a variable: press **Save & deploy** in the **Variables** tab, or **Trigger deployment** on the project dashboard (Strapi's [Cloud deployments management](https://docs.strapi.io/cloud/projects/deploys)).

**Time limits.** The staff assistant may stream for up to 90 seconds. Check that Strapi Cloud's proxy allows a request that long. This was not checked.

## First-time setup on Strapi Cloud

Never run `npm run setup` against Strapi Cloud. On a new Strapi Cloud project, these steps do by hand what it does locally.

1. **Node version.** Strapi needs Node 22.12 or later (`engines` in `strapi/package.json`). Set it under the environment's **Configuration**, **Basic information** (Strapi's [Cloud project settings](https://docs.strapi.io/cloud/projects/settings)).
2. **The install step.** Strapi Cloud installs in the Base directory, `strapi`. `strapi/package.json`'s `postinstall` installs and builds the Maison plugin, then runs `node scripts/share-strapi-utils.mjs`. That script removes the plugin's own copy of `@strapi/utils`, so the plugin shares Strapi's, which keeps Maison's validation errors at 400 where the Content Manager would otherwise answer 500. Check the first build's log for "Removed the Maison plugin's own @strapi/utils" or "Strapi core's @strapi/utils is shared by". If the install runs without scripts, the plugin has no build and does not load. Also add `pg` ([What is not ready yet](#what-is-not-ready-yet)).
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
