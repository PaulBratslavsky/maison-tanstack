# Maison on TanStack

A rebuild of the Maison demo with TanStack Start, TanStack AI and Strapi 5. The spec is `docs/spec.md`. The handoff is `HANDOFF.md`. The progress ledger is `docs/progress.md`.

## Rules

- Never change `~/work/maison-demo`. Read it and port from it only.
- Never print, paste or commit a secret (any `.env` value, token, password or key). Read variable names only.
- No git remote, push or deploy without Paul's explicit OK.
- Model calls only through TanStack AI. No Vercel AI SDK, no raw `fetch` to a provider.
- Product models: `claude-sonnet-5-5` for the concierge and the staff assistant, `claude-haiku-4-5-20251001` for inquiry labelling.
- Subagents that implement or review run on Sonnet.
- Writing rules for UI strings, comments, docs and commit messages: plain English, short sentences, no em dashes, no en dashes, no metaphors.
- Commits: pathspec commits, `area: what changed`, ending with `Co-Authored-By: <the model you run as> <noreply@anthropic.com>`.
- Verify Strapi, TanStack and LINE facts against installed source or official docs before relying on them.
- Write each test first and see it fail.
- SQLite only. No Docker, no local Postgres.
- Ports: Strapi 1339, app 3004, LINE verify mock 4546, LINE stand-in 4011. The original uses 1338, 3003, 4545 and 4010; leave those free.
