import { afterEach, describe, expect, it, vi } from 'vitest';
import { tunnelHeaders } from './tunnel';

describe('tunnelHeaders', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("skips ngrok's warning page when the browser calls Strapi's paths on the app's own origin (LINE mode)", () => {
    vi.stubGlobal('window', { location: { origin: 'https://maison.example' } });
    expect(tunnelHeaders('https://maison.example')).toEqual({ 'ngrok-skip-browser-warning': '1' });
  });

  it('sends nothing cross-origin, where Strapi would refuse an unknown header (local mode), or on the server', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3004' } });
    expect(tunnelHeaders('http://localhost:1339')).toEqual({});
    vi.unstubAllGlobals();
    expect(tunnelHeaders('https://maison.example')).toEqual({});
  });
});
