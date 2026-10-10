import { describe, expect, it } from 'vitest';

import pluginsConfig from '../../../../../config/plugins';

/** Strapi's `env` helper, reduced to what the config reads: a value, or the default when the key is missing. */
const envOf =
  (values: Record<string, string>) =>
  (key: string, fallback?: string): string | undefined =>
    key in values ? values[key] : fallback;

const oauthConfig = (values: Record<string, string>) => {
  const plugins = (pluginsConfig as (params: { env: unknown }) => Record<string, any>)({ env: envOf(values) });
  return plugins['strapi-oauth-mcp-manager'];
};

describe('the strapi-oauth-mcp-manager config', () => {
  it('is enabled', () => {
    expect(oauthConfig({}).enabled).toBe(true);
  });

  it('gives LINE a channel ID and a verify URL outside production', () => {
    const config = oauthConfig({ LINE_LOGIN_CHANNEL_ID: '2001234567', LINE_VERIFY_URL: 'http://127.0.0.1:4546/oauth2/v2.1/verify' });
    expect(config.config.identityProviders).toEqual({
      line: { channelId: '2001234567', verifyUrl: 'http://127.0.0.1:4546/oauth2/v2.1/verify' },
    });
  });

  it('leaves the verify URL out when none is set', () => {
    const config = oauthConfig({ LINE_LOGIN_CHANNEL_ID: '2001234567', LINE_VERIFY_URL: '' });
    expect(config.config.identityProviders).toEqual({ line: { channelId: '2001234567' } });
  });

  it('drops the verify URL in production, so LINE verifies every ID token', () => {
    const config = oauthConfig({
      NODE_ENV: 'production',
      LINE_LOGIN_CHANNEL_ID: '2001234567',
      LINE_VERIFY_URL: 'http://127.0.0.1:4546/oauth2/v2.1/verify',
    });
    expect(config.config.identityProviders).toEqual({ line: { channelId: '2001234567' } });
  });

  it('gives no identity providers when the channel ID is empty or missing', () => {
    expect(oauthConfig({ LINE_LOGIN_CHANNEL_ID: '', LINE_VERIFY_URL: 'http://127.0.0.1:4546' }).config.identityProviders).toEqual({});
    expect(oauthConfig({}).config.identityProviders).toEqual({});
  });
});
