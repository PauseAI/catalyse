import { describe, it, expect } from 'vitest'

describe('GET /admin/storybook/view', () => {
  it('delegates to serveStorybookFile, which refuses a request with no token', async () => {
    const { GET } = await import('./route')

    const response = await GET(new Request('http://localhost/admin/storybook/view/'), {
      params: Promise.resolve({ path: undefined }),
    })
    expect(response.status).toBe(404)
  })
})
