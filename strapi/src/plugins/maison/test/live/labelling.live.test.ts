import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, aiEnabled, type AiProvider, type AiSettings } from '../../server/src/ai/provider';
import labelling from '../../server/src/services/labelling';
import { fakeStrapi } from '../unit/fake-strapi';

/**
 * Labelling with a real model, through TanStack AI, set up as the plugin's config is: AI_PROVIDER (anthropic when unset),
 * AI_MODEL, AI_API_KEY and AI_BASE_URL, from the environment. The tests are skipped unless those settings can label (a key for
 * Anthropic, or a host for Ollama), so `npm run test:live` is safe to run without any. Nothing here prints the key.
 *
 *   AI_API_KEY=... npm run test:live
 *   AI_PROVIDER=ollama AI_BASE_URL=http://127.0.0.1:11434 AI_MODEL=qwen3-14b-32k npm run test:live
 */
const provider = process.env.AI_PROVIDER || 'anthropic';
if (!(AI_PROVIDERS as readonly string[]).includes(provider)) {
  throw new Error(`AI_PROVIDER must be one of ${AI_PROVIDERS.join(', ')}`);
}
const settings: AiSettings = {
  aiProvider: provider as AiProvider,
  aiModel: process.env.AI_MODEL || null,
  aiApiKey: process.env.AI_API_KEY || null,
  aiBaseUrl: process.env.AI_BASE_URL || null,
};

/** Japanese letters: hiragana, katakana, and the CJK ideographs kanji are written in. */
const JAPANESE = /[぀-ヿ一-鿿]/;

describe.skipIf(!aiEnabled(settings))('labelling with a real model', () => {
  const { label } = labelling({ strapi: fakeStrapi({ config: settings }) });

  it('labels a strap that broke as a complaint, with a negative sentiment', async () => {
    const labels = await label({
      message: 'The strap on my bag broke after a week.',
      reply: 'I am sorry to hear that. Please bring the bag to any boutique, and our team will look at it.',
      knowledgeFound: true,
      handedOff: false,
    });

    expect(labels).toMatchObject({ kind: 'complaint', sentimentLabel: 'negative' });
  });

  it('labels thanks as praise, with a positive sentiment', async () => {
    const labels = await label({
      message: 'Thank you, the weekender is beautiful.',
      reply: 'Thank you, we are delighted that you like it.',
      knowledgeFound: false,
      handedOff: false,
    });

    expect(labels).toMatchObject({ kind: 'praise', sentimentLabel: 'positive' });
  });

  it('labels a care question the reply answered as a question, answered', async () => {
    const labels = await label({
      message: 'How do I care for the leather of my weekender?',
      reply: 'Wipe it with a soft, dry cloth, and keep it out of direct sunlight. For a deeper clean, bring it to a boutique.',
      knowledgeFound: true,
      handedOff: false,
    });

    expect(labels).toMatchObject({ kind: 'question', answered: true });
  });

  it('labels a delivery question that went to staff as a question, not answered', async () => {
    const labels = await label({
      message: 'Can you deliver the weekender to Osaka by Friday?',
      reply: "I can't confirm delivery dates. A member of our team will answer you here on LINE.",
      knowledgeFound: false,
      handedOff: true,
    });

    expect(labels).toMatchObject({ kind: 'question', answered: false });
  });

  it('labels a complaint in Japanese, and writes its reason and topic in English', async () => {
    const labels = await label({
      message: 'バッグのストラップが一週間で壊れました。',
      reply: 'ご不便をおかけし、申し訳ございません。スタッフが確認してご連絡いたします。',
      knowledgeFound: false,
      handedOff: false,
    });

    expect(labels.kind).toBe('complaint');
    expect(labels.reason).not.toMatch(JAPANESE);
    expect(labels.topic).not.toMatch(JAPANESE);
  });
});
