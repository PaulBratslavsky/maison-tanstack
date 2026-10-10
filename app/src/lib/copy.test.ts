import { describe, expect, it } from 'vitest';

import { COPY } from './copy';

// The visit picker's words, as the spec's table has them, in both languages.
describe("the visit picker's copy", () => {
  it('has Not now and the two lines that take a picker\'s place', () => {
    expect([COPY.en.notNow, COPY.en.pickerClosed, COPY.en.pickerUnsent]).toEqual(['Not now', 'Closed without a request.', 'No request sent.']);
    expect([COPY.ja.notNow, COPY.ja.pickerClosed, COPY.ja.pickerUnsent]).toEqual(['今回は見送る', 'リクエストせずに閉じました。', 'リクエストは送信されていません。']);
  });

  it('suggests asking for a visit where "Yes, please." was, and keeps the first suggestion and the piece chips', () => {
    expect(COPY.en.suggestions).toEqual(["I'm looking for a gift under ¥400,000 for a friend who travels. Could I see it in Ginza on Saturday at 2 pm?", 'Can I book a visit?']);
    expect(COPY.ja.suggestions).toEqual(['旅好きの友人へのギフトを40万円以内で探しています。土曜日の14時に銀座で見られますか？', '来店を予約できますか？']);
    expect(COPY.en.pieceSuggestions).toEqual(['Can I have it personalized?', 'How do I care for it?', 'Which boutique has it in stock?']);
    expect(COPY.ja.pieceSuggestions).toEqual(['名入れはできますか？', 'お手入れ方法を教えてください。', 'どのブティックに在庫がありますか？']);
  });
});
