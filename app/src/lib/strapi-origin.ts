// Server only: it reads STRAPI_URL, which the browser never has. The marker import makes TanStack Start's import
// protection fail the build when the client bundle reaches this file.
import '@tanstack/react-start/server-only';

/**
 * Where the app's server reaches Strapi: STRAPI_URL, else Strapi's default address. Never VITE_STRAPI_URL, which in
 * LINE mode is the app's own public address, so a call to it would reach the app itself.
 */
export const strapiOrigin = (env: Record<string, string | undefined> = process.env) => (env.STRAPI_URL || 'http://127.0.0.1:1339').replace(/\/+$/, '');
