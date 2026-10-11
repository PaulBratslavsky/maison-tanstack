/**
 * The Host header values `vite preview` accepts besides localhost: your ngrok domain (LINE_MODE_DOMAIN in app/.env),
 * which the tunnel sends as the host. Vite refuses any other host name with 403, which keeps a page on another site from
 * reaching the app on this machine by pointing its own name at 127.0.0.1. Only a bare host name counts: the same rule as
 * `npm run mode:line` applies to the value.
 */
export const previewAllowedHosts = (env: Record<string, string | undefined>): string[] => {
  const domain = env.LINE_MODE_DOMAIN ?? ''
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain) ? [domain] : []
}
