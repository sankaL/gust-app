import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('PWA config', () => {
  it('launches installed and remembered app entries at the public landing page', () => {
    const viteConfigSource = readFileSync(
      path.resolve(import.meta.dirname, '../../vite.config.ts'),
      'utf8'
    )

    expect(viteConfigSource).toContain("start_url: '/',")
  })
})
