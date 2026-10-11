// Draws the Maison channel icon to LINE's MINI App icon spec
// (https://developers.line.biz/en/docs/line-mini-app/design/line-mini-app-icon/): a 130 by 130 px PNG background with a
// stand-alone logo, a white "M" in the app's Jost 500 on the app's ink, sized within LINE's recommended 54 to 76 px. Upload
// line/channel-icon.png as the Channel icon of a LINE Login or LINE MINI App channel (Basic settings).
// Run from app/: node scripts/render-channel-icon.mjs
// It uses the Google Chrome installed on this machine, so there is no browser to download.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SIZE = 130; // LINE's background size (BG SIZE)
const LOGO = 70; // the logo's longer side, in px
const INK = [0x0a, 0x0a, 0x0a]; // the background: the app's ink, #0a0a0a
const font = readFileSync(new URL('../node_modules/@fontsource/jost/files/jost-latin-500-normal.woff2', import.meta.url)).toString('base64');
const output = new URL('../line/channel-icon.png', import.meta.url); // app/line/, from wherever it runs

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  const { png, logo } = await page.evaluate(
    async ({ font, SIZE, LOGO, INK }) => {
      const face = new FontFace('Jost', `url(data:font/woff2;base64,${font})`, { weight: '500' });
      document.fonts.add(await face.load());
      const canvas = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = `rgb(${INK.join(',')})`;
      ctx.fillRect(0, 0, SIZE, SIZE);
      // Size the font so the M's ink is LOGO px on its longer side, then center the ink rather than the em box.
      ctx.font = '500 100px "Jost"';
      const probe = ctx.measureText('M');
      const probeSide = Math.max(
        probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight,
        probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent
      );
      ctx.font = `500 ${(100 * LOGO) / probeSide}px "Jost"`;
      const m = ctx.measureText('M');
      const inkWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      const inkHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('M', (SIZE - inkWidth) / 2 + m.actualBoundingBoxLeft, (SIZE - inkHeight) / 2 + m.actualBoundingBoxAscent);
      // Measure what was drawn: the box around every pixel that isn't the background.
      const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
      let [left, top, right, bottom] = [SIZE, SIZE, -1, -1];
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const i = (y * SIZE + x) * 4;
          if (Math.abs(data[i] - INK[0]) + Math.abs(data[i + 1] - INK[1]) + Math.abs(data[i + 2] - INK[2]) > 24) {
            [left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)];
          }
        }
      }
      return {
        png: canvas.toDataURL('image/png').split(',')[1],
        logo: { width: right - left + 1, height: bottom - top + 1, left, top, right: SIZE - 1 - right, bottom: SIZE - 1 - bottom },
      };
    },
    { font, SIZE, LOGO, INK }
  );
  const outside = [logo.width, logo.height].some((side) => side < 54 || side > 76);
  if (outside) throw new Error(`The logo is ${logo.width} by ${logo.height} px; LINE recommends 54 to 76 px. Change LOGO.`);
  mkdirSync(new URL('.', output), { recursive: true });
  writeFileSync(output, Buffer.from(png, 'base64'));
  console.log(
    `Wrote line/channel-icon.png: ${SIZE} by ${SIZE} px, logo ${logo.width} by ${logo.height} px, margins ${logo.left}/${logo.top}/${logo.right}/${logo.bottom} px (LINE: 54 to 90 px, 54 to 76 recommended).`
  );
} finally {
  await browser.close();
}
