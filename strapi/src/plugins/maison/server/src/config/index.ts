import type { Core } from '@strapi/strapi';

import { AI_PROVIDERS, type AiProvider } from '../ai/provider';
import { LOCALES, PLUGIN_ID, TOOL_NAMES, type Locale, type ToolName } from '../constants';

export interface MaisonConfig {
  /** Base of links into the customer app, e.g. https://liff.line.me/<LIFF ID>. Needed for confirmations. */
  liffUrl: string | null;
  timezone: string;
  defaultLocale: Locale;
  maxOpenRequestsPerCustomer: number;
  houseName: { ja: string; en: string };
  disabledTools: ToolName[];
  /** The LINE Messaging API channel access token Strapi sends confirmations with. Without one, Strapi sends none. */
  lineChannelAccessToken: string | null;
  /** Where the LINE Messaging API answers. Tests point it at a stand-in on this machine. */
  lineApiBaseUrl: string;
  /**
   * The model that labels inquiries: anthropic (the default) or ollama. These come from AI_PROVIDER, AI_MODEL,
   * AI_API_KEY and AI_BASE_URL. Without a key (or, for ollama, a base URL), labelling is off and new inquiries wait
   * under Not labelled.
   */
  aiProvider: AiProvider;
  /** The provider's default model when null. */
  aiModel: string | null;
  /**
   * The model the Ask tab chats with (AI_CHAT_MODEL). Not `aiModel`: that one labels inquiries, and is chosen for
   * classification. The chat is Anthropic only, so this is an Anthropic model ID.
   */
  aiChatModel: string;
  aiApiKey: string | null;
  /** The Ollama host, e.g. http://127.0.0.1:11434. Only the ollama provider uses it. */
  aiBaseUrl: string | null;
  /**
   * The LINE user ID (U and 32 lowercase hex characters) of the presenter's own LINE account. When it's set, Load demo
   * activity gives that account one waiting request, one open question and one open complaint, so confirming and
   * replying on stage send real LINE messages to it. Never logged or shown in full.
   */
  demoLineUserId: string | null;
}

export const defaultConfig: MaisonConfig = {
  liffUrl: null,
  timezone: 'Asia/Tokyo',
  defaultLocale: 'ja',
  maxOpenRequestsPerCustomer: 3,
  houseName: { ja: 'メゾン', en: 'Maison' },
  disabledTools: [],
  lineChannelAccessToken: null,
  lineApiBaseUrl: 'https://api.line.me',
  aiProvider: 'anthropic',
  aiModel: null,
  aiChatModel: 'claude-sonnet-5-5',
  aiApiKey: null,
  aiBaseUrl: null,
  demoLineUserId: null,
};

const fail = (message: string): never => {
  throw new Error(`[${PLUGIN_ID}] ${message}`);
};

/** https anywhere, or plain http on this machine for local development. */
const APP_URL = /^(https:\/\/\S+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?)$/;
/** LINE's API over https, or a stand-in on a port of this machine, for tests. */
const LINE_API_URL = /^(https:\/\/\S+|http:\/\/(localhost|127\.0\.0\.1):\d+(\/\S*)?)$/;

/** An http or https URL: the Ollama host may be on this machine, or hosted. */
const AI_BASE_URL = /^https?:\/\/\S+$/;

/** A LINE user ID: U and 32 lowercase hex characters. */
const LINE_USER_ID = /^U[0-9a-f]{32}$/;

/** null, undefined and '' all mean not set: `NAME=` in an env file gives '', and that must never stop Strapi from starting. */
const isSet = (value: unknown) => value !== null && value !== undefined && value !== '';

export function validateConfig(config: Partial<MaisonConfig>): void {
  const merged = { ...defaultConfig, ...config };

  // `MAISON_LIFF_URL=` in an env file gives '', which means not set: it must never stop Strapi from starting.
  if (merged.liffUrl !== null && merged.liffUrl !== '') {
    if (typeof merged.liffUrl !== 'string' || !APP_URL.test(merged.liffUrl) || merged.liffUrl.endsWith('/')) {
      fail(
        'config.liffUrl must be an https URL (or http://localhost for local development) without a trailing slash, e.g. https://liff.line.me/<LIFF ID>'
      );
    }
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: merged.timezone });
  } catch {
    fail(`config.timezone "${merged.timezone}" is not a valid IANA time zone`);
  }
  if (!(LOCALES as readonly string[]).includes(merged.defaultLocale)) {
    fail(`config.defaultLocale must be one of ${LOCALES.join(', ')}`);
  }
  if (!Number.isInteger(merged.maxOpenRequestsPerCustomer) || merged.maxOpenRequestsPerCustomer < 1) {
    fail('config.maxOpenRequestsPerCustomer must be an integer of at least 1');
  }
  if (
    typeof merged.houseName?.ja !== 'string' ||
    merged.houseName.ja.trim() === '' ||
    typeof merged.houseName?.en !== 'string' ||
    merged.houseName.en.trim() === ''
  ) {
    fail('config.houseName needs non-empty ja and en strings');
  }
  if (!Array.isArray(merged.disabledTools) || merged.disabledTools.some((name) => !(TOOL_NAMES as readonly string[]).includes(name))) {
    fail(`config.disabledTools may only contain: ${TOOL_NAMES.join(', ')}`);
  }
  // The message never repeats the token.
  const token: unknown = merged.lineChannelAccessToken;
  if (isSet(token) && (typeof token !== 'string' || /\s/.test(token))) {
    fail('config.lineChannelAccessToken must be a LINE channel access token, a string without spaces, or null to send no confirmations from Strapi');
  }
  const lineApi: unknown = merged.lineApiBaseUrl;
  if (isSet(lineApi) && (typeof lineApi !== 'string' || !LINE_API_URL.test(lineApi) || lineApi.endsWith('/'))) {
    fail(
      'config.lineApiBaseUrl must be an https URL without a trailing slash, e.g. https://api.line.me, or http://127.0.0.1:<port> for a stand-in on this machine'
    );
  }
  // `AI_PROVIDER=` and the like in an env file give '', which means not set.
  const provider: unknown = merged.aiProvider;
  if (isSet(provider) && !(AI_PROVIDERS as readonly unknown[]).includes(provider)) {
    fail(`config.aiProvider must be one of ${AI_PROVIDERS.join(', ')}`);
  }
  const model: unknown = merged.aiModel;
  if (isSet(model) && (typeof model !== 'string' || /\s/.test(model))) {
    fail("config.aiModel must be a model ID, a string without spaces, or null for the provider's default model");
  }
  // The message never repeats the value.
  const chatModel: unknown = merged.aiChatModel;
  if (isSet(chatModel) && (typeof chatModel !== 'string' || /\s/.test(chatModel))) {
    fail('config.aiChatModel must be a model ID, a string without spaces, or null for the default chat model');
  }
  // The message never repeats the key.
  const key: unknown = merged.aiApiKey;
  if (isSet(key) && (typeof key !== 'string' || /\s/.test(key))) {
    fail('config.aiApiKey must be an API key for the model provider, a string without spaces, or null to label no inquiries');
  }
  const aiBase: unknown = merged.aiBaseUrl;
  if (isSet(aiBase) && (typeof aiBase !== 'string' || !AI_BASE_URL.test(aiBase) || aiBase.endsWith('/'))) {
    fail('config.aiBaseUrl must be an http or https URL without a trailing slash, e.g. http://127.0.0.1:11434');
  }
  // demoLineUserId is checked by demoLineUserIdProblem instead: a bad value only warns, so it never stops Strapi starting.
}

/**
 * What's wrong with a demoLineUserId, for a warning at boot, or null when it's a LINE user ID or not set
 * (`MAISON_DEMO_LINE_USER_ID=` in an env file gives '', which means not set). A bad value is ignored, and the demo
 * activity goes to made-up customers only: an optional demo setting never stops Strapi starting. The message never
 * repeats the value.
 */
export const demoLineUserIdProblem = (value: unknown): string | null =>
  !isSet(value) || (typeof value === 'string' && LINE_USER_ID.test(value))
    ? null
    : '[maison] config.demoLineUserId (MAISON_DEMO_LINE_USER_ID) is not a LINE user ID, U followed by 32 lowercase hex characters, so it is ignored, and Load demo activity gives every item to made-up customers.';

export const getConfig = (strapi: Core.Strapi): MaisonConfig => {
  const config = { ...defaultConfig, ...(strapi.config.get(`plugin::${PLUGIN_ID}`) as Partial<MaisonConfig>) };
  // An empty value is the same as none: no liffUrl, no token, LINE's own API, Anthropic as the provider, no model, key or
  // base URL, the default chat model, and no demo LINE account.
  return {
    ...config,
    liffUrl: config.liffUrl || null,
    lineChannelAccessToken: config.lineChannelAccessToken || null,
    lineApiBaseUrl: config.lineApiBaseUrl || defaultConfig.lineApiBaseUrl,
    aiProvider: config.aiProvider || defaultConfig.aiProvider,
    aiModel: config.aiModel || null,
    aiChatModel: config.aiChatModel || defaultConfig.aiChatModel,
    aiApiKey: config.aiApiKey || null,
    aiBaseUrl: config.aiBaseUrl || null,
    demoLineUserId: config.demoLineUserId && demoLineUserIdProblem(config.demoLineUserId) === null ? config.demoLineUserId : null,
  };
};

export default {
  default: defaultConfig,
  validator: validateConfig,
};
