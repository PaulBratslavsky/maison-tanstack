import { describe, expect, it } from 'vitest'

import { previewAllowedHosts } from './preview-hosts'

describe('previewAllowedHosts (the Host header `vite preview` accepts besides localhost)', () => {
  it('is LINE_MODE_DOMAIN, your ngrok domain, alone', () => {
    expect(previewAllowedHosts({ LINE_MODE_DOMAIN: 'maison-test.ngrok-free.dev' })).toEqual(['maison-test.ngrok-free.dev'])
  })

  it('is empty without it, and for anything that is not a bare host name: no scheme, slash, port, space or wildcard', () => {
    expect(previewAllowedHosts({})).toEqual([])
    for (const domain of ['', 'localhost', 'https://maison-test.ngrok-free.dev', 'maison-test.ngrok-free.dev/', 'maison-test.ngrok-free.dev:443', 'a b.example', '.example.com', '*.example.com']) {
      expect(previewAllowedHosts({ LINE_MODE_DOMAIN: domain }), JSON.stringify(domain)).toEqual([])
    }
  })
})
