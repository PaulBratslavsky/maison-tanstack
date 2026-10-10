import { defineConfig } from '@playwright/test';

/**
 * Needs Strapi on port 1339 (`npm run dev:strapi` at the repo root) with the demo data from `npm run setup`. Uses the app
 * on 3004 when it is already running, and otherwise starts the root `npm run dev` (Strapi, the app and the LINE verify
 * mock) for the run and stops it after. Open the app as localhost, not 127.0.0.1: Strapi's CORS allows localhost only.
 * It runs on the installed Google Chrome, so no browser download is needed.
 */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3004',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    // A failed test keeps a trace of its actions and screenshots, but not the network log or the DOM snapshots: those
    // would store the customer's session token (every /mcp request carries it, and the token exchange answers with it).
    // Running with `--trace on` records everything again, so don't share a trace made that way.
    trace: { mode: 'retain-on-failure', snapshots: { dom: false, aria: true, screen: true }, screenshots: true, sources: false, attachments: false },
  },
  webServer: { command: 'npm run dev', cwd: '..', url: 'http://localhost:3004', reuseExistingServer: true, timeout: 180_000 },
});
