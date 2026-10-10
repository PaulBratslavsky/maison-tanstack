import type { Core } from '@strapi/strapi';

/**
 * Production server options, merged over `config/server.ts`, which listens on 127.0.0.1 for the laptop.
 *
 * Strapi Cloud runs Strapi in a container behind a TLS proxy:
 * - `host` listens on every interface, so the proxy can reach Strapi, and `port` is the one Cloud gives.
 * - `proxy: true` trusts the forwarded headers, so Strapi knows requests arrive over https.
 * - `url` is the public https address Strapi builds absolute links from. Set PUBLIC_URL to the Strapi Cloud URL.
 */
const config = ({ env }: Core.Config.Shared.ConfigParams): Partial<Core.Config.Server> => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL'),
  proxy: true,
});

export default config;
