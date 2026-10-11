import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootStrapi, defaultAppDir } from '../integration/harness.mjs';
import serverConfig from '../../../../../config/server';

/**
 * A stand-in for the `@strapi/strapi` package of the app the harness boots. It keeps the AI environment variables as
 * they were when Strapi loaded (the app's `.env` is read then), the plugin config the harness set, and the order of
 * what the harness did, so no Strapi app is needed.
 */
const STUB = `
const events = [];
const config = new Map();
exports.events = events;
exports.config = config;
exports.compileStrapi = async () => ({});
exports.createStrapi = () => ({
  config: { set: (key, value) => config.set(key, value) },
  cron: { stop: () => events.push({ cron: 'stopped' }) },
  async load() {
    events.push({
      loaded: Object.fromEntries(['AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY', 'AI_BASE_URL', 'LINE_CHANNEL_ACCESS_TOKEN', 'MAISON_PUBLIC_DIR'].map((name) => [name, process.env[name]])),
    });
  },
});
`;

const ENVIRONMENT = ['MAISON_PUBLIC_DIR', 'STRAPI_APP_DIR', 'DATABASE_FILENAME', 'LINE_CHANNEL_ACCESS_TOKEN', 'AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY', 'AI_BASE_URL'];

describe('the integration harness', () => {
  const keptEnvironment = Object.fromEntries(ENVIRONMENT.map((name) => [name, process.env[name]]));
  let appDir: string;

  beforeEach(() => {
    // The harness moves into the app's directory: not here, where the other tests run.
    vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
    appDir = mkdtempSync(path.join(tmpdir(), 'maison-harness-'));
    const stub = path.join(appDir, 'node_modules', '@strapi', 'strapi');
    mkdirSync(stub, { recursive: true });
    writeFileSync(path.join(appDir, 'package.json'), '{ "name": "a-strapi-app" }');
    writeFileSync(path.join(stub, 'package.json'), '{ "name": "@strapi/strapi", "main": "index.js" }');
    writeFileSync(path.join(stub, 'index.js'), STUB);
    process.env.STRAPI_APP_DIR = appDir;
    // What an app's .env holds on the machine of someone who runs the suites: a real key among them.
    Object.assign(process.env, {
      LINE_CHANNEL_ACCESS_TOKEN: 'a-line-token',
      AI_PROVIDER: 'anthropic',
      AI_MODEL: 'a-model',
      AI_API_KEY: 'sk-a-real-key',
      AI_BASE_URL: 'https://models.example.test/v1',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, value] of Object.entries(keptEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(appDir, { recursive: true, force: true });
  });

  /** What the harness did to the stand-in Strapi app. */
  const appOf = () => createRequire(path.join(appDir, 'package.json'))('@strapi/strapi') as { events: any[]; config: Map<string, unknown> };

  it("blanks the AI settings in the environment before Strapi loads, so the app's .env can never hand it a key", async () => {
    await bootStrapi('harness');

    expect(appOf().events[0]).toEqual({
      loaded: { AI_PROVIDER: '', AI_MODEL: '', AI_API_KEY: '', AI_BASE_URL: '', LINE_CHANNEL_ACCESS_TOKEN: '', MAISON_PUBLIC_DIR: '.tmp/maison-test-harness-public' },
    });
  });

  it('leaves the plugin with no key and no base URL once Strapi has loaded, whatever the app configured', async () => {
    await bootStrapi('harness');

    const { config } = appOf();
    expect(config.get('plugin::maison.aiApiKey')).toBeNull();
    expect(config.get('plugin::maison.aiBaseUrl')).toBeNull();
    expect(config.get('plugin::maison.lineChannelAccessToken')).toBeNull();
  });

  it('gives a suite the settings it asks for, over those defaults', async () => {
    await bootStrapi('harness', {
      maisonConfig: { aiProvider: 'ollama', aiModel: 'stand-in', aiApiKey: 'a-stand-in-key', aiBaseUrl: 'http://127.0.0.1:4011' },
    });

    const { config } = appOf();
    expect(config.get('plugin::maison.aiProvider')).toBe('ollama');
    expect(config.get('plugin::maison.aiModel')).toBe('stand-in');
    expect(config.get('plugin::maison.aiApiKey')).toBe('a-stand-in-key');
    expect(config.get('plugin::maison.aiBaseUrl')).toBe('http://127.0.0.1:4011');
  });

  it("stops Strapi's cron right after it loaded, for every suite: a job that fires mid-suite would race its own sweeps", async () => {
    const strapi = await bootStrapi('harness');

    expect(strapi).toBeDefined();
    expect(appOf().events.map((event) => Object.keys(event)[0])).toEqual(['loaded', 'cron']);
  });

  it("keeps a suite's uploads in .tmp/maison-test-<name>-public, away from strapi/public/uploads, and starts each boot with that folder empty", async () => {
    const leftover = path.join(appDir, '.tmp', 'maison-test-harness-public', 'uploads', 'old-image.jpg');
    mkdirSync(path.dirname(leftover), { recursive: true });
    writeFileSync(leftover, 'an image from an earlier run');
    writeFileSync(path.join(appDir, '.tmp', 'maison-test-harness.db'), 'a database from an earlier run');
    const other = path.join(appDir, '.tmp', 'maison-test-other-public', 'uploads', 'keep.jpg');
    mkdirSync(path.dirname(other), { recursive: true });
    writeFileSync(other, 'another suite');

    await bootStrapi('harness');

    expect(process.env.MAISON_PUBLIC_DIR).toBe('.tmp/maison-test-harness-public');
    expect(process.env.DATABASE_FILENAME).toBe('.tmp/maison-test-harness.db');
    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(path.join(appDir, '.tmp', 'maison-test-harness.db'))).toBe(false);
    expect(existsSync(other)).toBe(true);
    // The local upload provider refuses to start without its uploads folder.
    expect(existsSync(path.join(appDir, '.tmp', 'maison-test-harness-public', 'uploads'))).toBe(true);
  });

  it("is what Strapi's server config reads: dirs.public follows MAISON_PUBLIC_DIR and is ./public without it", () => {
    const env = (values: Record<string, string>) => Object.assign((key: string, fallback?: string) => values[key] ?? fallback, { int: (key: string, fallback: number) => Number(values[key] ?? fallback), bool: (key: string, fallback: boolean) => fallback, array: () => ['a'] });
    expect((serverConfig({ env: env({}) } as never) as { dirs?: { public?: string } }).dirs?.public).toBe('./public');
    expect((serverConfig({ env: env({ MAISON_PUBLIC_DIR: '.tmp/x-public' }) } as never) as { dirs?: { public?: string } }).dirs?.public).toBe('.tmp/x-public');
  });

  it('boots the app that holds the plugin when STRAPI_APP_DIR is not set', () => {
    expect(path.basename(defaultAppDir)).toBe('strapi');
    expect(existsSync(path.join(defaultAppDir, 'src', 'plugins', 'maison', 'package.json'))).toBe(true);
  });
});
