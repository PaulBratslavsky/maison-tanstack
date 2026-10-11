# Ops tools for an agent

Strapi sends the LINE confirmations itself, so Maison needs no agent for them. Maison also has two ops tools, for an agent that retries the confirmations that weren't sent:

- **`pending_confirmations`** lists each upcoming confirmed visit with its customer's LINE user ID and its ready-made message.
- **`record_confirmation`** records a delivery.
- **The prompt `send_pending_confirmations`,** titled "Send pending appointment confirmations", tells an agent how to use both, with [LINE Bot MCP](https://github.com/line/line-bot-mcp-server).

`npm run setup` mints their token, "Maison ops", and writes it to `strapi/.tmp/maison-ops-token`. The token holds one permission, "MCP: send appointment confirmations", so it can't confirm, publish or edit content.

## Connect Claude Desktop on macOS

To try the tools as a developer in Claude Desktop:

1. Quit Claude Desktop (⌘Q). It rewrites its config file while it runs.
2. From the repo root, run this command. It adds the `maison-ops` server to `~/Library/Application Support/Claude/claude_desktop_config.json` without printing the token, and keeps the rest of the file:

   ```bash
   node -e '
   const fs = require("fs"), os = require("os"), path = require("path");
   const file = path.join(os.homedir(), "Library/Application Support/Claude/claude_desktop_config.json");
   const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
   const token = fs.readFileSync("strapi/.tmp/maison-ops-token", "utf8").trim();
   const bin = path.dirname(process.execPath); // the folder of this node, and of its npx
   config.mcpServers = { ...config.mcpServers, "maison-ops": { command: path.join(bin, "npx"), args: ["-y", "mcp-remote", "http://localhost:1339/mcp", "--header", "Authorization:${MAISON_OPS_AUTH}"], env: { PATH: `${bin}:/usr/bin:/bin`, MAISON_OPS_AUTH: `Bearer ${token}` } } };
   fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
   console.log("Added maison-ops to", file);
   '
   ```

3. Start Strapi, then open Claude Desktop.

Notes:

- **Start Strapi before you open Claude Desktop.** `mcp-remote` connects to Strapi when Claude Desktop starts it, and exits for good if Strapi doesn't answer. If that happens, quit and reopen Claude Desktop.
- **Run the command again** (with Claude Desktop quit) after each `npm run setup`, which mints a new ops token, and after you change Node versions.
- **`npx` by its absolute path.** Claude Desktop doesn't start servers with your shell's `PATH`, so when Node comes from nvm or another version manager, a bare `npx` isn't found. The command writes the path of the `npx` beside the `node` that runs it (the one `which npx` prints in that terminal), and a `PATH` in `env` that starts with its folder, because `npx` runs on `node` from the `PATH`.
- **What the connector offers:** the two ops tools and the prompt. Strapi's own `log` tool also appears while Strapi runs in development.
- **Strapi Cloud.** Use the Strapi Cloud URL followed by `/mcp` in place of `http://localhost:1339/mcp`, and the ops token you made by hand ([Production](production.md#first-time-setup-on-strapi-cloud), step 9).
