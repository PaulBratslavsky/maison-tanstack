// @vitest-environment jsdom
// The "Open in LINE" page in a LINE build, outside the LINE app. The LIFF ID is made up: never a real one in this repo.
// lib/liff.test.ts holds how start-up ends in it; this holds what the page shows for the link that start-up builds.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./maison-provider', () => ({ useMaison: () => ({ locale: 'en' }) }));

import { COPY } from '../lib/copy';
import { lineAppUrl } from '../lib/line-app-url.mjs';
import { OpenInLine } from './open-in-line';

const LIFF_ID = '1234567890-AbcdEfgh';
const url = lineAppUrl(LIFF_ID, '/visits');

afterEach(cleanup);

describe('OpenInLine in a LINE build', () => {
  it('on a phone: the title, the button to the LINE link, and a QR code of the same link', async () => {
    render(<OpenInLine url={url} os="ios" />);
    expect(screen.getByRole('heading', { name: COPY.en.openInLine.title })).toBeTruthy();
    expect(screen.getByText(COPY.en.openInLine.bodyPhone)).toBeTruthy();
    expect(screen.getByRole('link', { name: COPY.en.openInLine.button }).getAttribute('href')).toBe(`https://liff.line.me/${LIFF_ID}/visits`);
    const image = await waitFor(() => screen.getByAltText(COPY.en.openInLine.alt));
    expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml;utf8,/);
  });

  it('on a desktop browser: the QR code and its words, and no button', async () => {
    render(<OpenInLine url={url} os="web" />);
    expect(screen.getByText(COPY.en.openInLine.body)).toBeTruthy();
    await waitFor(() => screen.getByAltText(COPY.en.openInLine.alt));
    expect(screen.queryByRole('link')).toBeNull();
  });
});
