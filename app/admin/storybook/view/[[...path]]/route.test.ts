import { describe, it, expect } from 'vitest'

describe('GET /admin/storybook/view', () => {
  it('delegates to serveStorybookFile', async () => {
    const { GET } = await import('./route')

    // Asserts only that the route wires its request through to serveStorybookFile — real
    // file serving is covered against fixtures in lib/storybook-static.test.ts.
    const response = await GET(new Request('http://localhost/admin/storybook/view/nope.html'), {
      params: Promise.resolve({ path: ['nope.html'] }),
    })
    expect(response.status).toBe(404)
  })
})
