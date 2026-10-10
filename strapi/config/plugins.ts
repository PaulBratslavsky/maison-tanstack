import type { Core } from '@strapi/strapi';

const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedTypes = [
  'image/svg+xml',
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  // env() returns '' for a key that is in .env but empty, so empty counts as unset below. Each value is trimmed first,
  // like the Maison values, so a stray space or newline never reaches LINE.
  const lineChannelId = env('LINE_LOGIN_CHANNEL_ID', '').trim();
  // Never in production (Strapi Cloud runs NODE_ENV=production): there LINE verifies ID tokens, whatever
  // LINE_VERIFY_URL says, because with the verify mock anyone could sign in as any customer.
  const lineVerifyUrl = env('NODE_ENV') === 'production' ? '' : env('LINE_VERIFY_URL', '').trim();

  return {
    'users-permissions': {
      config: {
        jwtManagement: 'refresh',
        sessions: {
          httpOnly: true,
        },
      },
    },
    upload: {
      config: {
        security: {
          allowedTypes: allowedMediaTypes,
          deniedTypes,
        },
      },
    },
    // Maison: the catalog, appointments and inquiries, as MCP tools. A local plugin with its own package.json, built by
    // `npm install` (this package's postinstall). Each value is trimmed, and an empty value counts as unset. A key pasted
    // with a trailing newline or space would otherwise stop Strapi from starting, because the plugin refuses a value with
    // whitespace in it, for an optional feature.
    maison: {
      enabled: true,
      resolve: 'src/plugins/maison',
      config: {
        // The base of links in LINE confirmations. Unset: pending_confirmations answers not_configured.
        liffUrl: env('MAISON_LIFF_URL', '').trim() || null,
        // The Official Account's Messaging API channel access token. With it, confirming a visit sends the customer's LINE
        // confirmation from Strapi. Unset: nothing is sent, and the board shows "not sent".
        lineChannelAccessToken: env('LINE_CHANNEL_ACCESS_TOKEN', '').trim() || null,
        // Where Strapi reaches LINE's Messaging API. Unset everywhere but local checks, which point it at a stand-in on
        // this machine (http://127.0.0.1:<port>) so nothing reaches a real phone.
        lineApiBaseUrl: env('MAISON_LINE_API_BASE_URL', '').trim() || null,
        // The model that labels each customer inquiry. AI_PROVIDER is anthropic (the default) or ollama. AI_MODEL defaults
        // per provider. AI_BASE_URL is the Ollama host, such as http://127.0.0.1:11434. Unset, labelling is off, and new
        // inquiries wait under Not labelled.
        aiProvider: env('AI_PROVIDER', '').trim() || null,
        aiModel: env('AI_MODEL', '').trim() || null,
        // The model of the staff assistant on the Maison page. It is an Anthropic model ID, and the assistant uses
        // AI_API_KEY. Unset: claude-sonnet-5-5. It is not AI_MODEL, which labels inquiries.
        aiChatModel: env('AI_CHAT_MODEL', '').trim() || null,
        aiApiKey: env('AI_API_KEY', '').trim() || null,
        aiBaseUrl: env('AI_BASE_URL', '').trim() || null,
        // Optional: your own LINE user ID (U and 32 lowercase hex characters). With it, Load demo activity gives your LINE
        // account one waiting request, one open question and one open complaint. Unset: every demo item goes to the five
        // made-up customers, who get no LINE message.
        demoLineUserId: env('MAISON_DEMO_LINE_USER_ID', '').trim() || null,
      },
    },
    'strapi-oauth-mcp-manager': {
      enabled: true,
      config: {
        // Customer sign-in with LINE. channelId is the LINE Login channel's ID, digits only (not the LIFF ID).
        // LINE_VERIFY_URL points at the Maison app's mock of LINE's verify endpoint: local only, never production.
        identityProviders: lineChannelId
          ? {
              line: {
                channelId: lineChannelId,
                ...(lineVerifyUrl ? { verifyUrl: lineVerifyUrl } : {}),
              },
            }
          : {},
      },
    },
  };
};

export default config;
