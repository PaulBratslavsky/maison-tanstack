# Running the talk demo

The runbook for the 3-minute demo in "Building the AI-Powered Connected Experience" (QBurst and LY Corporation, Tokyo, 7 October 2026). The demo runs in local mode on one laptop, with the LIFF mock. This is the TanStack edition: Strapi is on port 1339 and the app on port 3004.

## One-time setup

1. **The quick start:** `npm install`, `npm run dev`, `npm run setup`, and restart (see the [Quick start](../README.md#quick-start)).
2. **The concierge's model:** `ANTHROPIC_API_KEY` in `app/.env` for Claude Sonnet 5.5, then restart the app. Without it, start Ollama with `qwen3-14b-32k`.
3. **The LINE confirmation on your phone:** [option A](line-setup.md#option-a-a-real-line-message-on-your-phone). Without it, the board shows each confirmed visit as "not sent".
4. **Optional, demo items on your own LINE account:** set `MAISON_DEMO_LINE_USER_ID` in `strapi/.env` to your LINE user ID (`U` and 32 lowercase hex characters, the same ID as option A's), and restart Strapi. **Load demo activity** then gives your account one waiting request, one open question and one open complaint, so confirming, **Let them know**, **Answer** and **Reply on LINE** reach your phone. Your three items carry a "Your LINE" label next to the customer: the request on the board, the question under **Questions**, and the complaint and the question's hand-off under **Inquiries**. The made-up customers get no LINE message: their rows say "demo customer", in grey.

## Before going on stage

- [ ] The day before: start over with a clean database ([Start over with a clean database](../README.md#start-over-with-a-clean-database)). Then no test customer or rehearsal visit is left. After that, don't run `npm run test:e2e` or `npm run test:live`: they leave visits, questions or inquiries behind. `npm run test:integration` uses its own databases, so it does not touch the demo's.
- [ ] On the Maison page, press **Load demo catalog** once after updating: a catalog loaded before gets the Japanese versions of Maison's 16 product knowledge entries, and the English ones if it has none. The notice says what it added.
- [ ] `npm run mode` says local. After option B, stop ngrok first (Ctrl-C in its terminal), then run `npm run mode:local` and restart Strapi and the app.
- [ ] Put the laptop on a phone hotspot. Only the concierge's model (with a key), the LINE confirmation, labelling with a key, the staff assistant and **Reply on LINE** need the internet.
- [ ] `npm run dev`. `http://localhost:1339/_health` answers 204.
- [ ] In the Strapi admin: **Maison** → **Reset demo activity** (it asks first), then **Load demo activity**, which needs the catalog from **Load demo catalog** above. It answers at once ("Loading demo activity: the lists fill in over the next few seconds.") and adds five made-up customers' requests, questions and inquiries, received over the last three days, so each tab has rows to show. With `MAISON_DEMO_LINE_USER_ID` set, three of them are yours. Set the board's filter to **All requests**.
- [ ] Open `http://localhost:3004`, or reload it after the reset. Sign-in is automatic, and the collections appear. Set the language to **EN**: each browser remembers the last choice.
- [ ] Run through every screen once, so each one is compiled before the audience sees it: home, a collection, a product, the booking sheet (close it without sending), **My visits**, and the concierge. Ask the concierge one question: on the local model, the first answer also loads the model.
- [ ] With option A: your phone at hand, with LINE's notifications on. The confirmation arrives there.
- [ ] Windows: the app (phone frame) beside the Strapi admin on the Maison board.
- [ ] Turn on Do Not Disturb on the laptop (with option A, not on the phone).

## The 3-minute run

| Time | Step | Do |
|---|---|---|
| 0:00-0:30 | UX | The app opens signed in with LINE. Browse Voyage, then the Weekender 50. Turn on **Agent view**: every screen is an MCP tool call, the same tools an agent uses. |
| 0:30-1:10 | AX for the customer | **Ask the concierge**, and tap the first suggestion. A line above the answer names each tool call. The `Local · resolve_date` line shows the Saturday it worked out. Under the concierge's words, cards show the pieces it found, and the **Book a visit** form appears under them, filled in with Ginza, that Saturday and 14:00. The chat scrolls to the form's heading. |
| 1:10-1:30 | Booking | Tap **Send request**. The visit's card replaces the form, the lines read `Local · choose_visit ✓ requested` and `MCP · request_appointment ✓`, and the concierge says the visit is requested and the boutique will confirm it on LINE. |
| 1:30-1:50 | The request arrives | On the board, the request appears at the top of **All requests**, above the demo activity, created via `app`, with the customer masked. |
| 1:50-2:20 | Staff confirm | Press **Confirm**. The row turns confirmed, and the notice says the customer's LINE confirmation was sent. |
| 2:20-2:45 | The answer on LINE | The phone buzzes (option A): Strapi sent the confirmation the moment staff confirmed, with no agent in between. Show the message, in the language the customer booked in, and the board's LINE column: LINE sent. |
| 2:45-3:00 | The integration slide | "Everything is ready for a LINE MINI App: sign-in, tools, and the message." QBurst continues from here (see [Running Maison as a LINE MINI App](line-setup.md#running-maison-as-a-line-mini-app)). |

**Optional, 20 seconds, after the booking:** ask "How do I care for the leather?". A line above the answer reads `MCP · search_knowledge ✓ …`, and the answer comes from Maison's own product knowledge in Strapi. Or ask "Can I pay in bitcoin?": the search finds nothing (`MCP · search_knowledge ✓ 0 results`), the app records the question for staff itself, and the note with the question's `Q-` reference and **Send it in the LINE chat** appears under that line. If recording fails, the note says only where the team answers, with **Chat with Maison on LINE**. On the Maison page's **Inquiries** tab, the bitcoin question shows under **Needs an answer**, the default filter. Turns the concierge answered, such as the gift question, show under **All**.

**Optional, the staff assistant:** needs `AI_API_KEY` in `strapi/.env` and an admin window 1080px wide or more. Press the round button at the bottom right of any admin page, then a quick question such as "Which visits are waiting for staff?". The answer is a table, and each lookup shows as a box. The assistant only reads: staff still press **Confirm** themselves.

**In Japanese (JA),** the same run uses the same tools, with Japanese labels: the form's button is リクエストを送る, the second suggestion is 来店を予約できますか？, and the product page's button is 来店を予約. The optional questions are 「革のお手入れ方法を教えてください」, answered from the Japanese product knowledge, and 「ビットコインで支払えますか？」, which it has nothing on.

**Fallbacks:**
- **The concierge stalls, or the network drops:** use **Book a visit** on the product page. It calls the same `request_appointment` tool.
- **No form appears after the first suggestion:** tap the second suggestion, **Can I book a visit?**.
- **The concierge's turn ends with no words** (the local model, now and then): tap **Try again** under it, with a line ready while it answers again.
- **The form says the limit of visit requests is reached:** the demo customer has 3 requests waiting. Confirm one on the board, or reset demo activity. With `MAISON_DEMO_LINE_USER_ID` set to the same ID as the app's demo customer, Load demo activity's waiting request is one of the 3.
- **The note under a question has no `Q-` reference:** nothing was recorded. One reason is that the demo customer already has five questions open or taken, the most Strapi allows. **Reset demo activity**, or answer some under **Questions**.
- **The concierge shows an error:** in local mode, a small technical line under the customer's message names the cause and the fix. After `npm run setup` or a clean start, reload the app's page: a session the server has dropped answers 502 until then.
- **The LINE message doesn't arrive:** show the confirmed row on the board, and the message on the slide. If the row says "not sent", **Send again** retries it. A row that says "demo customer" is a made-up customer's, who never gets a message.
- **A demo button says "Strapi took too long to answer":** the work goes on in Strapi. Wait a few seconds: the lists refresh by themselves.
- **Any step stalls for more than 10 seconds:** switch to the backup video.

## Rehearse

Follow "Before going on stage" and "The 3-minute run" three times in local mode, with **Reset demo activity** and **Load demo activity** between runs. Then once more on the local model, and once in Japanese. Product knowledge is in English and Japanese, so a Japanese chat answers care and policy questions from the Japanese entries. A question they don't cover goes to Maison's client advisors, recorded in Strapi: they reply in the LINE chat. Before the talk, do at least one run on Claude, with your key.

Expected:
- **Each step works,** and the whole run fits in 3 minutes. On the local model, only the waits are longer.
- **The concierge never says a visit is confirmed.** Before **Send request** it doesn't say the visit is requested. After it, it says the visit is requested, and that the boutique will confirm it on LINE.
- **Book a visit works with the network off.** Strapi, the app, the mock and the local model all run on the laptop. Only the LINE confirmation fails: its row says "not sent", and **Send again** sends it once the network is back.

Check these once, in the admin:
- **The board.** A request made in the app appears within 5 seconds. **All requests** keeps confirmed rows. **Confirm** appears only on waiting requests whose visit is still ahead. With option A, the LINE column says LINE sent once the confirmation has gone out.
- **The reset.** **Reset demo activity** asks first, and **Cancel** changes nothing.
- **The customer stays hidden.** In the Content Manager, Maison's appointment list and edit view have no customer column or field, and searching the list for part of the demo customer's ID finds nothing. Saving and publishing there still work.

## Record the backup video

**When:**
- after the final rehearsal passes
- on the final build and a freshly seeded database ([Start over with a clean database](../README.md#start-over-with-a-clean-database))
- with the model you'll use on stage: Claude with a key, if you have one by then. Otherwise the local model, which is slower, so cut the waits in editing.

**Setup:**
- macOS screen recording (⌘⇧5, or QuickTime), at 1920×1080
- the app in its phone frame (a browser window at least 500 px wide shows it) beside the Strapi admin, on the Maison board with the filter on "All requests"
- Do Not Disturb on, and a clean browser profile with no bookmarks bar or extensions
- the cursor visible, and the system text size large enough for a projector

**Steps to record,** in the same order as the live run:
1. LINE sign-in
2. The concierge's gift answer, ending in the filled-in form
3. Booking with **Send request**
4. The request appearing on the board
5. Staff confirming it on the board
6. The LINE confirmation arriving on the phone (option A), beside the board's LINE column

**Recording tips:**
- Record each step as its own clip, so a bad take can be redone.
- Keep the final cut at or under 3:00, with no voiceover: you narrate live.

**On stage:**
- **Where it lives:** on the laptop, and embedded or linked in the slide right after "Meet Maison".
- **When to switch:** if any step stalls for more than 10 seconds.
- **Either way,** the talk continues from S7.
