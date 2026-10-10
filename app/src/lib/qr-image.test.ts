import { describe, expect, it } from 'vitest';

import { qrImageSource } from './qr-image';

const PREFIX = 'data:image/svg+xml;utf8,';
const URL_A = 'https://liff.line.me/1234567890-AbcdEfgh/visits'; // a made-up LIFF ID

describe('qrImageSource', () => {
  it('draws the link as an SVG image for an <img>: black on white, with a two-module quiet zone', async () => {
    const source = await qrImageSource(URL_A);
    expect(source.startsWith(PREFIX)).toBe(true);
    // Fully percent-encoded: the SVG's own colours (#ffffff) would otherwise end the data URL at their `#`.
    expect(source.slice(PREFIX.length)).not.toMatch(/[<>"'#\s]/);
    const svg = decodeURIComponent(source.slice(PREFIX.length));
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
    expect(svg).toContain('<path fill="#ffffff" d="M0 0h'); // white under the whole code
    expect(svg).toContain('<path stroke="#000000" d="M2 2'); // black modules, from two modules in
  });

  it('gives the same image for the same link, and another for another page', async () => {
    expect(await qrImageSource(URL_A)).toBe(await qrImageSource(URL_A));
    expect(await qrImageSource(URL_A)).not.toBe(await qrImageSource('https://liff.line.me/1234567890-AbcdEfgh'));
  });
});
