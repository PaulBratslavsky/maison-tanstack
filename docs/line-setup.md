# Running with LINE

This page covers three ways to run Maison:

- **Local mode** is the default. Nothing reaches LINE or a phone.
- **Option A** sends the LINE confirmation to your phone, through your own LINE Official Account.
- **Option B** runs the app inside LINE on your phone, signed in by LINE, through one ngrok tunnel.

The last section has notes for running the app as a LINE MINI App.

Your LINE values (LIFF ID, channel IDs, access token, Official Account ID and ngrok domain) go only in the `.env` files. Keep them out of commits, logs and chats. The scripts here never print them.

The ports are these. They differ from the original Maison demo, so both can run on one laptop.

| Process | Port |
| --- | --- |
| Strapi | 1339 |
| The app | 3004 |
| LINE verify mock | 4546 |
| LINE Messaging API stand-in | 4011 |

## Local mode

Local mode needs no LINE account. `npm install` at the repo root creates `strapi/.env` and `app/.env`, and `npm run setup` loads the demo data. Then `npm run dev` starts Strapi, the app and the verify mock.

- **The app signs in with LINE's LIFF mock.** It signs in a demo customer. Add `?demoUser=U` and 32 lowercase hex characters to the address to sign in as another customer in that tab.
- **Strapi checks ID tokens with the verify mock.** `strapi/.env` sets `LINE_VERIFY_URL` to `http://127.0.0.1:4546/verify`, and the mock accepts `valid.` followed by a LINE user ID. Strapi ignores `LINE_VERIFY_URL` when `NODE_ENV` is `production`.
- **Open the app as `http://localhost:3004`,** not `127.0.0.1`. Strapi's CORS allows `localhost` only.
- **The LINE confirmation has no real target.** To see the push, run `npm run line:stand-in`, then set `MAISON_LINE_API_BASE_URL=http://127.0.0.1:4011` in `strapi/.env` and restart Strapi. The stand-in answers like LINE's Messaging API and logs each push to `strapi/.tmp/line-stand-in.jsonl`, without any header. Leave `LINE_CHANNEL_ACCESS_TOKEN` empty.
- **The proxy routes are closed.** `/mcp`, the token endpoint and `/uploads` on the app answer 404 in local mode. See [the proxy](#how-the-app-serves-option-b).

`npm run mode` says which mode `strapi/.env` and `app/.env` are in.

## Option A: a real LINE message on your phone

1. In the [LINE Developers Console](https://developers.line.biz/console/), create a provider and an Official Account with the [Messaging API](https://developers.line.biz/en/docs/messaging-api/overview/). Check first that your account can create one from your region. With option B, use your LINE Login channel's provider: LINE gives each user a different ID in each provider.
2. Add the Official Account as a friend on your phone.
3. Copy **Your user ID** from the Messaging API channel's **Basic settings** into `app/.env` as `VITE_DEMO_LINE_USER_ID`. The mock sign-in then acts as you, as that provider sees you. Restart the app. With option B, skip this step: you sign in as yourself.
4. Issue a channel access token, on the Messaging API channel's **Messaging API** tab. Put it in `strapi/.env` as `LINE_CHANNEL_ACCESS_TOKEN`. Leave `MAISON_LINE_API_BASE_URL` empty, so Strapi calls LINE. Restart Strapi. Keep the token out of commits and chats: it sends messages as your Official Account.
5. Book a visit and confirm it on the board. Strapi pushes the confirmation to you at once, with LINE's push API, and records it:
   - the notice says the customer's LINE confirmation was sent
   - the board shows LINE sent
   - **My visits** shows "Confirmed, LINE sent" (確定 · LINEで送信済み in Japanese)
6. Let customers add Maison themselves, since a confirmation only reaches a customer who has added the Official Account as a friend:
   - **In the app:** put the Official Account's basic ID, with its `@`, in `app/.env` as `VITE_LINE_OA_ID`, and restart the app. **Chat with Maison on LINE** then appears on **My visits**, on a visit's page, after a booking and, in the concierge, under the note for a question nothing recorded. It opens `https://line.me/R/ti/p/%40...`: a friend gets the chat with Maison, anyone else its add-friend screen. Under a hand-off Strapi recorded, **Send it in the LINE chat** opens `https://line.me/R/oaMessage/%40.../?...`, the chat with Maison with the question already typed in. Without the setting there is no button of either kind. LINE's links work in LINE on phones, not in LINE for PC.
   - **At sign-in (option B):** in LINE Developers, open the LINE Login channel's **Basic settings**, set **Linked LINE Official Account** to yours, and turn on the LIFF app's **Add friend option**. LINE then offers to add Maison when a customer first allows the app. With the account linked, the app also asks LINE whether the customer has added Maison, and if not, the button reads **Add Maison on LINE**.

The message's button opens the visit in the app, at `MAISON_LIFF_URL` followed by `/visits/<reference>`. In local mode `MAISON_LIFF_URL` is `http://localhost:3004`, which your phone cannot open. With option B it is your LIFF URL, which opens the app inside LINE.

- **Without option A, leave `LINE_CHANNEL_ACCESS_TOKEN` empty in local mode.** The mock's customer is then a made-up user ID, and nobody would receive what Strapi pushes to it.
- **"LINE sent" means LINE accepted the message.** LINE's push API answers 200 even when it cannot deliver, for example to a customer who has blocked the Official Account, so the board shows LINE sent then too.
- **When LINE refuses it,** or cannot be reached, the row stays "not sent", and Strapi's log says why. Fix the cause, then press **Send again**.

## Option B: the real app inside LINE

Local mode runs on the LIFF mock. Option B runs the same app inside LINE on your phone, signed in by LINE: your own [LINE Login](https://developers.line.biz/en/docs/line-login/overview/) channel and LIFF app, on one public https origin from [ngrok](https://ngrok.com). The mock stays the default.

The same path was tested on a phone inside LINE in the original project: LINE sign-in, the catalog, a booking, and staff confirmation on the board. This rebuild has not been tested inside LINE yet. Its scripts and the proxy are tested against stand-ins only.

### How the app serves option B

- **One origin.** ngrok forwards your domain to the app on 127.0.0.1:3004, a production build. The app passes three of Strapi's paths on to Strapi: `/mcp`, the token endpoint (`/api/strapi-oauth-mcp-manager/oauth/token`) and `/uploads`. Strapi, with its admin, stays on your laptop. `MAISON_APP_ORIGIN` is not needed, because the browser never calls Strapi on another origin.
- **The proxy passes on only what those calls need:** the headers they use, and request bodies up to 1 MB. A longer body gets 413 before any of it reaches Strapi. Answers stream through as Strapi writes them. Any other Strapi path, such as `/admin`, answers 404 from the app. A path that climbs out of `/uploads`, also with percent-encoded dots or slashes, answers 404.
- **And only what the phone sends:** on `/mcp`, a customer session or no `Authorization` at all (anything else gets 401), and at the token endpoint, the token exchange (anything else gets 400).
- **Only LINE mode's build serves those paths.** The proxy reads `VITE_LIFF_MOCK`, which Vite builds into the app. A build for the LIFF mock, and `npm run dev`, answer 404 on them, so a tunnel left open after `npm run mode:local` reaches no Strapi that trusts the verify mock.
- **LINE verifies the ID tokens.** Strapi checks each one with LINE, for your channel, not with the local mock.
- **The server reaches Strapi on this machine.** It uses `STRAPI_URL` from `app/.env`, never `VITE_STRAPI_URL`, which in LINE mode is your public domain.
- **Every answer that Start's middleware makes says which build it is,** in the `X-Maison-Liff` header: `mock`, `line-dev` (a dev server in LINE mode) or `line` (a production build in LINE mode). That covers pages, server routes, server functions and the 403 for a cross-origin server function request. It leaves out Start's 308 and 400 answers made before the middleware, an uncaught 500, and static files that `vite preview` serves itself. `npm run tunnel` reads it.
- **`npm run start:line` serves the build with `vite preview`.** A TanStack Start build without Nitro makes a fetch handler in `app/dist/server`, not a server that listens, so `vite preview` is the built-in way to serve it. Vite checks the `Host` header, so `app/vite.config.ts` allows `localhost` and the domain in `LINE_MODE_DOMAIN`, and nothing else.
- **Your values stay in `app/.env`:** `LINE_MODE_LIFF_ID`, `LINE_MODE_CHANNEL_ID` and `LINE_MODE_DOMAIN`. The app does not read them. Keep them out of commits.

### Once: your LINE Login channel and LIFF app

1. Link your LINE Developers account (Business ID) to your LINE account. Only a linked account can sign in to a channel in **Developing**.
2. In the [LINE Developers Console](https://developers.line.biz/console/), create a provider and a LINE Login channel, with app type **Web app**. Name it Maison, for example: a channel's name cannot contain "LINE". Leave it in **Developing**, so only its admins and testers can sign in.
3. In **Basic settings**, set the **Channel icon**. A 130 by 130 px icon for Maison is at `app/line/channel-icon.png`.
4. In the **LIFF** tab, add an app:
   - Size: Full
   - Endpoint URL: `https://<your ngrok domain>/`
   - Scopes: `openid` and `profile`
   - Add friend option: On (Normal), once the Official Account is linked (option A, step 6)
5. Get a free [ngrok](https://ngrok.com/download) account, install the agent, and add your authtoken (`ngrok config add-authtoken`). Your dev domain (`<name>.ngrok-free.dev`) is on ngrok's dashboard.
6. Add three lines to `app/.env`:

   ```ini
   LINE_MODE_LIFF_ID=<your LIFF ID, from the LIFF tab>
   LINE_MODE_CHANNEL_ID=<your channel ID, digits only, from Basic settings>
   LINE_MODE_DOMAIN=<your ngrok domain, without https://>
   ```

### Each time

Stop `npm run dev` first. Then run these in order, the long-running ones each in its own terminal:

```bash
npm run mode:line     # rewrites strapi/.env and app/.env for LINE mode, and prints no value
npm run dev:strapi    # Strapi reads the LINE channel when it starts
npm run setup         # checks Strapi's channel, and points the app at your domain
npm run start:line    # builds the app for LINE and serves it on 127.0.0.1:3004, without the verify mock
npm run tunnel        # checks it is safe, then runs ngrok on your domain
npm run qr            # prints the app's LINE link, with a QR code to scan in LINE
```

`npm run mode:line` sets these keys, and nothing else:
- in `strapi/.env`: `LINE_LOGIN_CHANNEL_ID`, `LINE_VERIFY_URL` (emptied), `MAISON_LIFF_URL` and `PUBLIC_URL`
- in `app/.env`: `VITE_LIFF_MOCK`, `VITE_LIFF_ID`, `VITE_STRAPI_URL` and `STRAPI_URL`

It makes both files readable by you only. `npm run mode:local` sets them back.

`npm run setup` also makes a new ops token, which it writes to `strapi/.tmp/maison-ops-token`. If you connected an agent with the old one, give it the new one.

**Open the app inside LINE.** Run `npm run qr`, then scan the code with LINE's QR reader: the QR icon next to the search bar on LINE's Home tab. The iPhone Camera app may give the link to Safari instead. The code opens `https://liff.line.me/<your LIFF ID>`, and `npm run qr -- /visits` opens a given screen. It also saves the code in `app/line/qr/`, as a PNG and an SVG.
- **If LINE opens links in Safari or Chrome:** in LINE, go to Settings, then LINE Labs, and turn off "Open links in your default browser". Outside LINE the app never signs in: it shows an "Open in LINE" page, with the QR code and, on a phone, a button.
- **The first time,** ngrok's free plan may show its warning page: tap **Visit Site**. ngrok remembers it for 7 days. If the app then shows an error, close it and open it again.
- **LINE asks you to allow the app,** with your channel's icon and name.
- **The app's language** follows the LINE app's language, until you switch it with **EN** or **JA**.
- **The Strapi admin** stays at http://localhost:1339/admin on the laptop. Strapi prints your public URL as its own, but the admin is not served there.

Who can sign in:
- **While your LINE Login channel is in Developing,** only its Admins and Testers can (LINE Developers Console, your channel, **Roles**).
- **Publishing the channel opens it to anyone with LINE.** Every visit then reaches your laptop through the tunnel, the concierge answers on your model or API key, and each visitor becomes a customer in the demo database:
  - **Each sign-in** stores a session in oauth-mcp-manager: the visitor's full LINE user ID (`line:U...`), a hash of the session token (not the token), the app's client ID, and when the session expires (an hour later) and was last used. Its hourly cleanup deletes expired sessions.
  - **Each visit request** stores a Maison appointment: the same full LINE user ID, the boutique, the products, the date and time, the visitor's note if they wrote one, a reference, and where it was made (`createdVia`: `app`, `concierge` or `web`). It stays until you reset the demo appointments. Each LINE confirmation Strapi sends, or an agent records, adds a log row: the reference, sent or failed, the time and a note, with no LINE user ID. Reset deletes those too.
  - **No other personal data:** no name, picture or email, and not the ID token. Strapi checks the ID token with LINE and keeps only the user ID. Staff see it masked, and the admin API never returns it. Strapi reads the full ID to send the LINE confirmation, and `pending_confirmations` returns it to the ops token.
- **The QR image** holds your LIFF ID and stays out of git: `app/line/qr/` is in `.gitignore`.

`npm run tunnel` refuses to start unless all of these hold:
- `strapi/.env` has no `LINE_VERIFY_URL`, and both `.env` files are in LINE mode
- nothing answers on the verify mock's port, 127.0.0.1:4546. `npm run dev` starts the mock, which is why LINE mode uses `npm run start:line`.
- the app on 127.0.0.1:3004 is the LINE build that `npm run start:line` serves: its `X-Maison-Liff` header says `line`. A build for the LIFF mock says `mock`, and a dev server in LINE mode says `line-dev`.
- the running Strapi, reached through the app, refuses a forged ID token with `invalid_grant`, because LINE checks it. The tunnel does not start either when Strapi cannot be reached, or cannot check the token.

It refuses because, with the local verify mock behind a tunnel, anyone could sign in as any customer.

`npm run tunnel -- --dry-run` runs the checks alone and starts nothing. When they pass, the tunnel runs `ngrok http 127.0.0.1:3004 --url=https://<your domain> --inspect=false`. The `--inspect=false` flag keeps ngrok's local inspector from storing customers' tokens. In ngrok's dashboard, leave Traffic Inspector's full capture off.

### Back to local mode

Stop ngrok first (Ctrl-C in its terminal). Then stop the app and Strapi (Ctrl-C in each terminal), and run:

```bash
npm run mode:local
npm run dev          # Strapi, the app and the verify mock, as in local mode
```

`npm run mode` says which mode you are in. `npm run dev` and `npm run dev:app` refuse to start while the app is in LINE mode. The tests (`npm run test:e2e`, `npm run test:live`) need local mode, and refuse to run in LINE mode.

`npm start` in `app/` serves whatever `app/dist` holds. After `npm run start:line` that is a LINE build, so run `npm run build --prefix app` in local mode before you use `npm start` again.

### Check the proxy without LINE

`node scripts/check-strapi-proxy.mjs`, from `app/`, starts the built app and a stand-in for Strapi on free ports, and checks the proxy end to end. It reaches nothing outside this machine. Build first, in the mode to check: `VITE_LIFF_MOCK=false npm run build` checks LINE mode's side (an MCP answer streams, the token exchange passes back as sent, images come back byte for byte, every other path answers 404, 413 or 400 as it should). A plain `npm run build` checks that the three paths answer 404 and reach nothing. Run `npm run build` again afterwards, so `app/dist` is the mock build again.

## Running Maison as a LINE MINI App

The app follows LINE's [LINE MINI App](https://developers.line.biz/en/docs/line-mini-app/quickstart/) design guidelines, so it can run as a LINE MINI App. A LINE MINI App is a LIFF app on a LINE MINI App channel, so this app runs as one with its LIFF ID and channel ID changed.

### How a MINI App connects

1. The MINI App calls `liff.getIDToken()`.
2. oauth-mcp-manager exchanges it for a short-lived session, after LINE verifies it (RFC 8693).
3. The MINI App, and any agent working for that customer, calls the Maison tools on Strapi `/mcp`.
4. Staff confirm in Strapi, on the Maison board or through a staff agent. Strapi sends the customer's LINE confirmation at once, through the Messaging API. A verified MINI App could send it as a service message instead.

### Create the channels

Who can create a MINI App channel depends on LINE's MINI App Policy and your region. For example, an unverified MINI App can be created by an organization with a Japanese corporate number or a Taiwan or Thailand tax ID, an individual business owner in Japan, or an individual in Japan, Taiwan or Thailand. If your account cannot create one, run the demo on a LINE Login channel (option B).

Create both channels in the same provider. Otherwise user IDs will not match, and confirmations cannot be delivered.
1. **A LINE MINI App channel,** with your region (Japan, Taiwan or Thailand, per the policy):
   - **Channel icon:** `app/line/channel-icon.png`. LINE's icon spec is 130 by 130 px, with a logo between 54 and 76 px.
   - **Channel name:** Maison, with no "LINE" in it, and a Japanese name under **Localization**.
   - **A description,** in English and Japanese, and your **privacy policy URL**.
   - **Web app settings:** endpoint URL `https://<your host>/`, scopes `openid` and `profile`. A MINI App's size is always Full.
2. **A Messaging API channel** (an Official Account), whose channel access token Strapi sends the confirmations with (option A). A verified MINI App can send service messages instead.

### Run it

- **Two values change.** Put the MINI App's LIFF ID and channel ID in `app/.env` as `LINE_MODE_LIFF_ID` and `LINE_MODE_CHANNEL_ID`, put your host in `LINE_MODE_DOMAIN`, and follow [option B](#option-b-the-real-app-inside-line). Nothing else changes. To serve it from your own https host instead of ngrok, leave the tunnel out: run `npm run start:line`, check it first with `npm run tunnel -- --dry-run`, which runs every check and starts nothing, and only then put the app behind that host.
- **Use one pair, from one internal channel.** A MINI App channel has three internal channels, Developing, Review and Published, and each has its own LIFF ID and channel ID. Use Developing's while you test. oauth-mcp-manager accepts one channel at a time, so switch to Published's at launch.
- **Its URL.** An unverified MINI App opens at `https://miniapp.line.me/<LIFF ID>`. `https://liff.line.me/<LIFF ID>` opens it too, so the confirmations' links (`MAISON_LIFF_URL`) keep working. Its header shows the page's title, Maison, and your domain.

### Done for LINE's MINI App guidelines

- **The icon:** as above.
- **The safe area:** the app keeps clear of the screen's safe areas on a phone in portrait and in landscape (`app/src/styles.css`).
- **The loading icon:** LINE's own spinner, 30 by 30 px and centered, wherever the app waits (`app/src/components/spinner.tsx`).
- **LIFF inside LINE:**
  - `liff.init()` runs at or below the endpoint URL.
  - Outside LINE the app never starts LINE Login. It shows an "Open in LINE" page instead, with a QR code of the page's LINE link (`app/src/components/open-in-line.tsx`).
  - When an ID token expires (they last an hour), the app logs out and reloads, LINE's own pattern.

### Before LINE's review

These still need work before LINE's review:
- **People without LINE.** LINE asks that a MINI App work in an external browser without LINE Login. Every screen here needs a LINE session, so an external browser gets the "Open in LINE" page.
- **Performance.** LINE asks for a Lighthouse Performance score of 50 or more, measured on your deployment without LINE Login.
- **The policy and the review request:**
  - the LINE MINI App Policy
  - the channel description, and the privacy policy
  - for a reservation service, test scenarios in the review request

### LINE's pages

- [Get started with LINE MINI App](https://developers.line.biz/en/docs/line-mini-app/quickstart/)
- design: the [icon](https://developers.line.biz/en/docs/line-mini-app/design/line-mini-app-icon/), the [safe area](https://developers.line.biz/en/docs/line-mini-app/design/landscape/) and the [loading icon](https://developers.line.biz/en/docs/line-mini-app/design/loading-icon/)
- [settings shown to users](https://developers.line.biz/en/docs/line-mini-app/develop/configure-console/), and the [console guide](https://developers.line.biz/en/docs/line-mini-app/discover/console-guide/)
- [permanent links](https://developers.line.biz/en/docs/line-mini-app/develop/permanent-links/), and [external browsers](https://developers.line.biz/en/docs/line-mini-app/develop/external-browser/)
- the [performance guidelines](https://developers.line.biz/en/docs/line-mini-app/develop/performance-guidelines/), which set the Lighthouse score
- the [LINE MINI App Policy](https://terms2.line.me/LINE_MINI_App?lang=en)
