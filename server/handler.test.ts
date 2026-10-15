import { describe, it, expect } from 'vitest'
import { rpcFetch } from '@/test/rpc-fetch'

async function call(path: string, body: unknown): Promise<{ status: number; message: string }> {
  const response = await rpcFetch(`http://localhost/api/rpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: body }),
  })
  const payload = (await response.json()) as { json?: { message?: string } }
  return { status: response.status, message: payload.json?.message ?? '' }
}

describe('handler', () => {
  it('reports a schema rejection with the failing field’s own message', async () => {
    const { status, message } = await call('auth/signup', {
      name: 'Ada',
      email: 'ada@example.com',
      password: 'testpassword1',
      bio: 'e2e test bio, at least twenty characters long',
      country: 'UK',
      availabilityHoursPerWeek: 100,
      applicationMessage: 'e2e test application message',
      consentMakeProfileVisibleInDirectory: true,
      consentContactableByProjectOwners: true,
    })
    expect(status).toBe(400)
    expect(message).toBe('Availability must be no more than 40 hours per week')
  })

  it('leaves an error that is not a schema rejection alone', async () => {
    const { status, message } = await call('my/quickTasks', {})
    expect(status).toBe(401)
    expect(message).not.toMatch(/validation/i)
  })
})
