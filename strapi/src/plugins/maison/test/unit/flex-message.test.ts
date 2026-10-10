import { describe, expect, it } from 'vitest';
import { buildConfirmationMessage } from '../../server/src/domain/flex-message';

const input = {
  houseName: 'メゾン',
  reference: 'APT-4821',
  boutiqueName: '銀座本店',
  boutiqueAddress: '東京都中央区銀座1-2-3（デモ）',
  requestedForText: '10月10日(土) 14:00',
  productNames: ['ウィークエンダー50', 'パスポートカバー'],
  appLink: 'https://liff.line.me/1234567890-AbCdEfGh/visits/APT-4821',
};

const collectTexts = (node: unknown, texts: string[] = []): string[] => {
  if (Array.isArray(node)) node.forEach((child) => collectTexts(child, texts));
  else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record.type === 'text') texts.push(String(record.text));
    Object.values(record).forEach((value) => collectTexts(value, texts));
  }
  return texts;
};

describe('buildConfirmationMessage', () => {
  it('builds a bubble whose footer button opens the app link', () => {
    const message = buildConfirmationMessage(input);
    expect(message.altText).toBe('ご来店予約が確定しました（APT-4821）');
    expect(message.contents.type).toBe('bubble');
    const footer = message.contents.footer as { contents: Array<{ action: { type: string; uri: string; label: string } }> };
    expect(footer.contents[0].action).toEqual({ type: 'uri', label: '予約を確認する', uri: input.appLink });
  });

  it('includes every detail and never an empty text node', () => {
    const texts = collectTexts(buildConfirmationMessage(input).contents);
    for (const expected of ['メゾン', 'APT-4821', '銀座本店', '10月10日(土) 14:00', 'ウィークエンダー50、パスポートカバー']) {
      expect(texts).toContain(expected);
    }
    expect(texts.every((text) => text.length > 0)).toBe(true);
  });

  it('replaces an empty address with a dash, because LINE rejects empty text', () => {
    const texts = collectTexts(buildConfirmationMessage({ ...input, boutiqueAddress: '' }).contents);
    expect(texts).toContain('-');
  });
});

/** The Japanese bubble for `input`, as the builder made it before it had a language, key for key and in that order. */
const JAPANESE_BUBBLE = {
  altText: 'ご来店予約が確定しました（APT-4821）',
  contents: {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0a0a0a',
      paddingAll: '16px',
      contents: [{ type: 'text', text: 'メゾン', color: '#ffffff', align: 'center', weight: 'bold' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: 'ご来店予約が確定しました', weight: 'bold', size: 'lg', wrap: true },
        {
          type: 'box',
          layout: 'baseline',
          spacing: 'sm',
          contents: [
            { type: 'text', text: '予約番号', size: 'sm', color: '#737373', flex: 2 },
            { type: 'text', text: 'APT-4821', size: 'sm', color: '#0a0a0a', flex: 5, wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'baseline',
          spacing: 'sm',
          contents: [
            { type: 'text', text: 'ブティック', size: 'sm', color: '#737373', flex: 2 },
            { type: 'text', text: '銀座本店', size: 'sm', color: '#0a0a0a', flex: 5, wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'baseline',
          spacing: 'sm',
          contents: [
            { type: 'text', text: '住所', size: 'sm', color: '#737373', flex: 2 },
            { type: 'text', text: '東京都中央区銀座1-2-3（デモ）', size: 'sm', color: '#0a0a0a', flex: 5, wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'baseline',
          spacing: 'sm',
          contents: [
            { type: 'text', text: '日時', size: 'sm', color: '#737373', flex: 2 },
            { type: 'text', text: '10月10日(土) 14:00', size: 'sm', color: '#0a0a0a', flex: 5, wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'baseline',
          spacing: 'sm',
          contents: [
            { type: 'text', text: 'お品物', size: 'sm', color: '#737373', flex: 2 },
            { type: 'text', text: 'ウィークエンダー50、パスポートカバー', size: 'sm', color: '#0a0a0a', flex: 5, wrap: true },
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#0a0a0a',
          action: { type: 'uri', label: '予約を確認する', uri: 'https://liff.line.me/1234567890-AbCdEfGh/visits/APT-4821' },
        },
      ],
    },
  },
};

describe('buildConfirmationMessage in Japanese', () => {
  it('builds the bubble it always has, byte for byte', () => {
    expect(JSON.stringify(buildConfirmationMessage(input))).toBe(JSON.stringify(JAPANESE_BUBBLE));
  });

  it("builds that same bubble when it's told the language is ja", () => {
    expect(JSON.stringify(buildConfirmationMessage({ ...input, language: 'ja' }))).toBe(JSON.stringify(JAPANESE_BUBBLE));
  });
});

describe('buildConfirmationMessage in English', () => {
  const english = {
    ...input,
    language: 'en' as const,
    houseName: 'Maison',
    boutiqueName: 'Ginza Flagship',
    boutiqueAddress: '1-2-3 Ginza, Chuo-ku, Tokyo (demo)',
    requestedForText: 'Sat 10 Oct, 14:00',
    productNames: ['Weekender 50', 'Passport Cover'],
  };
  type Node = { type: string; text?: string; contents?: Node[]; action?: { type: string; label: string; uri: string } };
  const partsOf = (message: { contents: Record<string, unknown> }) => {
    const header = message.contents.header as Node;
    const body = message.contents.body as Node;
    const footer = message.contents.footer as Node;
    const [title, ...rows] = body.contents!;
    return {
      houseName: header.contents![0].text,
      title: title.text,
      rows: rows.map((row) => [row.contents![0].text, row.contents![1].text]),
      button: footer.contents![0].action,
    };
  };
  /** The bubble with every text and label left out: its layout. */
  const layoutOf = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(layoutOf);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, key === 'text' || key === 'label' ? '' : layoutOf(value)])
    );
  };

  it('says the visit is confirmed, with its reference, in the alt text', () => {
    expect(buildConfirmationMessage(english).altText).toBe('Your visit is confirmed (APT-4821)');
  });

  it('has the house name in the header and an English title', () => {
    const { houseName, title } = partsOf(buildConfirmationMessage(english));
    expect(houseName).toBe('Maison');
    expect(title).toBe('Your visit is confirmed');
  });

  it('labels every detail in English, and joins the pieces with commas', () => {
    expect(partsOf(buildConfirmationMessage(english)).rows).toEqual([
      ['Reference', 'APT-4821'],
      ['Boutique', 'Ginza Flagship'],
      ['Address', '1-2-3 Ginza, Chuo-ku, Tokyo (demo)'],
      ['Date', 'Sat 10 Oct, 14:00'],
      ['Pieces', 'Weekender 50, Passport Cover'],
    ]);
  });

  it('has a button that opens the visit in the app', () => {
    expect(partsOf(buildConfirmationMessage(english)).button).toEqual({ type: 'uri', label: 'View your visit', uri: input.appLink });
  });

  it('lays the bubble out exactly as the Japanese one', () => {
    expect(layoutOf(buildConfirmationMessage(english).contents)).toEqual(layoutOf(buildConfirmationMessage(input).contents));
  });

  it('replaces an empty address with a dash, as in Japanese', () => {
    expect(partsOf(buildConfirmationMessage({ ...english, boutiqueAddress: ' ' })).rows[2]).toEqual(['Address', '-']);
  });

  it('writes Japanese for a language that only names an inherited key, such as constructor', () => {
    expect(buildConfirmationMessage({ ...input, language: 'constructor' as never }).altText).toBe('ご来店予約が確定しました（APT-4821）');
  });
});
