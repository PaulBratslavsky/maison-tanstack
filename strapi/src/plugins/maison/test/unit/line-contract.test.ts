import { describe, expect, it } from 'vitest';
import { buildConfirmationMessage } from '../../server/src/domain/flex-message';
import { flexMessageSchema } from '../fixtures/line-flex-message-schema.mjs';

describe('LINE Bot MCP contract', () => {
  it('builds a message that push_flex_message accepts', () => {
    const message = buildConfirmationMessage({
      houseName: 'メゾン',
      reference: 'APT-4821',
      boutiqueName: '銀座本店',
      boutiqueAddress: '',
      requestedForText: '10月10日(土) 14:00',
      productNames: ['ウィークエンダー 50', 'パスポートカバー', 'ラゲッジタグ・デュオ', 'カルネ・ウォレット', 'ウォッチロール・トロワ'],
      appLink: 'https://liff.line.me/1234567890-AbCdEfGh/visits/APT-4821',
    });
    const result = flexMessageSchema.safeParse(message);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it('builds an English message that push_flex_message accepts', () => {
    const message = buildConfirmationMessage({
      language: 'en',
      houseName: 'Maison',
      reference: 'APT-4821',
      boutiqueName: 'Ginza Flagship',
      boutiqueAddress: '',
      requestedForText: 'Sat 10 Oct, 14:00',
      productNames: ['Weekender 50', 'Passport Cover', 'Luggage Tag Duo', 'Carnet Wallet', 'Watch Roll Trois'],
      appLink: 'https://liff.line.me/1234567890-AbCdEfGh/visits/APT-4821',
    });
    const result = flexMessageSchema.safeParse(message);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });
});
