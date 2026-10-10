import { describe, expect, it } from 'vitest';

import { COPY } from './copy';
import { lineChatUrl, lineChatWords, lineMessageUrl } from './line-chat';

describe("the button's copy", () => {
  it('names the chat with Maison, says where the confirmation arrives, and asks to add Maison, in English', () => {
    expect(COPY.en.lineChat).toEqual({
      button: 'Chat with Maison on LINE',
      line: 'Your confirmation arrives in the Maison chat.',
      addButton: 'Add Maison on LINE',
      addLine: 'Add Maison on LINE to get your confirmation there.',
    });
  });

  it('and in Japanese', () => {
    expect(COPY.ja.lineChat).toEqual({
      button: 'LINEでMaisonにメッセージ',
      line: '確定のご連絡はMaisonのLINEトークにお届けします。',
      addButton: 'Maisonを友だち追加',
      addLine: '確定のご連絡をLINEで受け取るには、Maisonを友だち追加してください。',
    });
  });
});

describe("the hand-off's copy", () => {
  it('keeps the plain note, and words the recorded one: thanks, an advisor will message them here, and the reference, in English', () => {
    const copy = COPY.en.handOff;
    expect(copy.fallback).toBe("Our team answers questions like this in Maison's LINE chat.");
    expect(copy.note('Q-4821')).toBe('Thanks for asking! Give us a few minutes: one of our client advisors will message you here with the answer. (Q-4821)');
    expect(copy.send).toBe('Send it in the LINE chat');
    expect(copy.typed('Q-4821', 'Can it hold a watch?')).toBe('Question for a Maison advisor (Q-4821): Can it hold a watch?');
  });

  it('and in Japanese', () => {
    const copy = COPY.ja.handOff;
    expect(copy.fallback).toBe('このようなご質問には、MaisonのLINEトークで担当者がお答えします。');
    expect(copy.note('Q-4821')).toBe('ご質問ありがとうございます。少々お待ちください。クライアントアドバイザーがお調べのうえ、このLINEトークでご返信いたします（Q-4821）。');
    expect(copy.send).toBe('LINEトークで送る');
    expect(copy.typed('Q-4821', '腕時計は入りますか？')).toBe('アドバイザーへの質問（Q-4821）：腕時計は入りますか？');
  });
});

describe('lineChatWords: the nudge, from what liff.getFriendship() said', () => {
  it('asks a customer who has not added Maison yet (friendFlag false) to add it', () => {
    expect(lineChatWords(COPY.en.lineChat, false)).toEqual({
      button: 'Add Maison on LINE',
      line: 'Add Maison on LINE to get your confirmation there.',
    });
    expect(lineChatWords(COPY.ja.lineChat, false)).toEqual({
      button: 'Maisonを友だち追加',
      line: '確定のご連絡をLINEで受け取るには、Maisonを友だち追加してください。',
    });
  });

  it('offers a friend (friendFlag true) the chat', () => {
    expect(lineChatWords(COPY.en.lineChat, true)).toEqual({
      button: 'Chat with Maison on LINE',
      line: 'Your confirmation arrives in the Maison chat.',
    });
    expect(lineChatWords(COPY.ja.lineChat, true)).toEqual({
      button: 'LINEでMaisonにメッセージ',
      line: '確定のご連絡はMaisonのLINEトークにお届けします。',
    });
  });

  it("shows the plain button when the call failed, or hasn't answered yet (null): LINE opens the right screen either way", () => {
    for (const locale of ['en', 'ja'] as const) {
      expect(lineChatWords(COPY[locale].lineChat, null), locale).toEqual(lineChatWords(COPY[locale].lineChat, true));
    }
  });
});

// Made-up IDs in the forms LINE gives: never Maison's real basic ID in this repo.
describe('lineChatUrl', () => {
  it("opens the chat with Maison's Official Account: LINE's link, with the basic ID percent-encoded", () => {
    expect(lineChatUrl('@123abcde')).toBe('https://line.me/R/ti/p/%40123abcde');
  });

  it("takes a premium ID too, as in LINE's own example, and one with a dot, a hyphen and an underscore", () => {
    expect(lineChatUrl('@linedevelopers')).toBe('https://line.me/R/ti/p/%40linedevelopers');
    expect(lineChatUrl('@maison.ginza_jp-1')).toBe('https://line.me/R/ti/p/%40maison.ginza_jp-1');
  });

  it('leaves out spaces around the ID, which a hand-edited .env can keep', () => {
    expect(lineChatUrl(' @123abcde\n')).toBe('https://line.me/R/ti/p/%40123abcde');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['without its @', '123abcde'],
    ['only the @', '@'],
    ['encoded already', '%40123abcde'],
    ['with a space inside', '@123 abcde'],
    ['with a path after it', '@123abcde/x'],
    ['a whole link', 'https://line.me/R/ti/p/%40123abcde'],
  ])('gives no link, so no button anywhere, for a setting %s', (_, value) => {
    expect(lineChatUrl(value)).toBeNull();
  });
});

describe('lineMessageUrl', () => {
  /** What follows the "?": the text LINE types into the chat. */
  const typedIn = (text: string) => lineMessageUrl('@maison', text)?.split('/?')[1];

  it("opens the chat with Maison with the text already typed in: LINE's oaMessage link, with the ID and the text percent-encoded", () => {
    expect(lineMessageUrl('@maison', 'Question for a Maison advisor (Q-4821): Can it hold a watch?')).toBe(
      'https://line.me/R/oaMessage/%40maison/?Question%20for%20a%20Maison%20advisor%20(Q-4821)%3A%20Can%20it%20hold%20a%20watch%3F'
    );
  });

  it("is what the hand-off's button opens, from its own words in both languages", () => {
    expect(lineMessageUrl('@maison', COPY.en.handOff.typed('Q-4821', 'Can it hold a watch?'))).toBe(
      'https://line.me/R/oaMessage/%40maison/?Question%20for%20a%20Maison%20advisor%20(Q-4821)%3A%20Can%20it%20hold%20a%20watch%3F'
    );
    expect(lineMessageUrl('@maison', COPY.ja.handOff.typed('Q-4821', '腕時計は入りますか？'))).toBe(
      `https://line.me/R/oaMessage/%40maison/?${encodeURIComponent('アドバイザーへの質問（Q-4821）：腕時計は入りますか？')}`
    );
  });

  it('encodes what would end or change the link: & # ? + and a new line', () => {
    expect(lineMessageUrl('@maison', 'a&b#c?d+e\nf')).toBe('https://line.me/R/oaMessage/%40maison/?a%26b%23c%3Fd%2Be%0Af');
  });

  it('takes the IDs lineChatUrl takes, with the spaces around one left out', () => {
    expect(lineMessageUrl('@123abcde', 'Hi')).toBe('https://line.me/R/oaMessage/%40123abcde/?Hi');
    expect(lineMessageUrl('@maison.ginza_jp-1', 'Hi')).toBe('https://line.me/R/oaMessage/%40maison.ginza_jp-1/?Hi');
    expect(lineMessageUrl(' @maison\n', 'Hi')).toBe('https://line.me/R/oaMessage/%40maison/?Hi');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['without its @', 'maison'],
    ['only the @', '@'],
    ['encoded already', '%40maison'],
    ['with a space inside', '@mai son'],
    ['with a path after it', '@maison/x'],
    ['a whole link', 'https://line.me/R/oaMessage/%40maison/'],
  ])('gives no link, so no button, for a setting %s, as lineChatUrl gives none', (_, value) => {
    expect(lineMessageUrl(value, 'Hi')).toBeNull();
    expect(lineChatUrl(value)).toBeNull();
  });

  it('cuts text over 500 characters to 500 before it encodes it, and keeps 500 or fewer whole', () => {
    expect(typedIn('a'.repeat(499))).toBe('a'.repeat(499));
    expect(typedIn('a'.repeat(500))).toBe('a'.repeat(500));
    expect(typedIn('a'.repeat(501))).toBe('a'.repeat(500));
    expect(typedIn('a'.repeat(5000))).toBe('a'.repeat(500));
    // 500 characters, not 500 of the encoded text: Japanese is cut at the same count.
    expect(typedIn('あ'.repeat(600))).toBe(encodeURIComponent('あ'.repeat(500)));
  });

  // A string can hold half of a surrogate pair on its own (a model can write one), and encodeURIComponent throws on it.
  it('turns a lone half of a surrogate pair into U+FFFD, and keeps every real emoji', () => {
    const replacement = encodeURIComponent('\uFFFD'); // %EF%BF%BD
    expect(() => lineMessageUrl('@maison', 'a\ud83db')).not.toThrow();
    expect(typedIn('a\ud83db')).toBe(`a${replacement}b`); // a lone high half
    expect(typedIn('a\ude00b')).toBe(`a${replacement}b`); // a lone low half
    expect(typedIn('\ude00\ud83d')).toBe(`${replacement}${replacement}`); // two halves the wrong way round are two lone halves
    expect(typedIn('\ud83d😀')).toBe(`${replacement}${encodeURIComponent('😀')}`); // a lone half in front of a whole emoji
    expect(typedIn('😀\ude00')).toBe(`${encodeURIComponent('😀')}${replacement}`);
    // Real emoji survive: a pair, a flag, a family joined by zero-width joiners, a skin tone, and a rare Han character.
    for (const emoji of ['😀', '🇯🇵', '👨‍👩‍👧', '👍🏽', '𠮷']) {
      expect(typedIn(`Q ${emoji} ok`), emoji).toBe(encodeURIComponent(`Q ${emoji} ok`));
      expect(typedIn(`Q ${emoji} ok`), emoji).not.toContain(replacement);
    }
  });

  it('replaces a lone half the cut leaves at the limit, and drops one the cut takes off', () => {
    expect(typedIn('a'.repeat(499) + '\ud83d' + 'b')).toBe('a'.repeat(499) + encodeURIComponent('\uFFFD'));
    expect(typedIn('a'.repeat(500) + '\ud83d')).toBe('a'.repeat(500));
  });

  it('never cuts a character in two: one at the limit goes whole or not at all', () => {
    // 😀 is two UTF-16 units. Cut between them, encodeURIComponent would throw.
    expect(typedIn('a'.repeat(499) + '😀' + 'b')).toBe('a'.repeat(499) + encodeURIComponent('😀'));
    expect(typedIn('a'.repeat(500) + '😀')).toBe('a'.repeat(500));
    expect(typedIn('😀'.repeat(600))).toBe(encodeURIComponent('😀'.repeat(500)));
  });
});
