/**
 * A QR code of `text` for an <img>: an SVG data URL, black on white, with error correction M and a two-module quiet
 * zone. It's shown as an image, never inserted as markup. The `qrcode` package loads only when a code is drawn, so the
 * screens that never show one, every screen on the stage, don't download it.
 */
export const qrImageSource = async (text: string): Promise<string> => {
  const qrcode = await import('qrcode');
  const svg = await qrcode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};
