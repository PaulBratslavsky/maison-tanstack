import { describe, expect, it } from 'vitest';

import { COPY } from './copy';
import { type LineOs, onPhone, openInLineBody } from './open-in-line';

describe('onPhone', () => {
  it.each<[LineOs, boolean]>([
    ['ios', true],
    ['android', true],
    ['web', false], // a desktop browser: the QR code only, to scan with a phone
    [undefined, false],
  ])("getOS() %s: the Open in LINE button %s", (os, shown) => {
    expect(onPhone(os)).toBe(shown);
  });
});

describe('openInLineBody', () => {
  it('leads a phone to the button: its own screen is no QR code it can scan', () => {
    for (const os of ['ios', 'android'] as const) {
      expect(openInLineBody(COPY.en.openInLine, os), os).toBe('Maison runs inside LINE. Tap Open in LINE below.');
      expect(openInLineBody(COPY.ja.openInLine, os), os).toBe('MaisonはLINEの中で動きます。下の「LINEで開く」をタップしてください。');
    }
  });

  it("keeps the QR code's words for a desktop browser, and before LIFF says which it is", () => {
    for (const os of ['web', undefined] as const) {
      expect(openInLineBody(COPY.en.openInLine, os), String(os)).toBe(COPY.en.openInLine.body);
      expect(openInLineBody(COPY.ja.openInLine, os), String(os)).toBe(COPY.ja.openInLine.body);
    }
    expect(COPY.en.openInLine.body).toMatch(/Scan this code with LINE's QR reader/);
  });

  it("names the button by its own label, in each language", () => {
    for (const locale of ['en', 'ja'] as const) {
      expect(openInLineBody(COPY[locale].openInLine, 'ios'), locale).toContain(COPY[locale].openInLine.button);
    }
  });
});
