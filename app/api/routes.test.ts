import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createVolunteer } from '@/test/factories'
import { createSession } from '@/lib/auth'

import { cronJobs } from '@/test/fakes/cron-jobs'

beforeEach(() => {
  cronJobs.returns('backup', 'backup-ok')
  cronJobs.returns('digest', 'digest-ok')
  cronJobs.returns('nudges', { nudged: 1 })
  cronJobs.returns('applications-summary', 'summary-ok')
  cronJobs.fails('applications-anonymisation', 'anon failed')
})

const cron = (path: string, auth = 'Bearer cron-secret') =>
  new NextRequest(`http://localhost/api/cron/${path}`, {
    method: 'POST',
    headers: { authorization: auth },
  })

describe('cron routes', () => {
  it('each refuses a bad secret and otherwise runs its job', async () => {
    const routes = {
      backup: { key: 'backup', expected: 'backup-ok' },
      digest: { key: 'digest', expected: 'digest-ok' },
      'applications-summary': { key: 'applications', expected: 'summary-ok' },
    }
    for (const [path, { key, expected }] of Object.entries(routes)) {
      const { POST } = await import(`./cron/${path}/route`)
      expect((await POST(cron(path, 'Bearer nope'))).status).toBe(401)
      expect(await (await POST(cron(path))).json()).toEqual({ [key]: expected })
    }
    const nudges = await import('./cron/nudges/route')
    expect((await nudges.POST(cron('nudges', 'x'))).status).toBe(401)
    expect(await (await nudges.POST(cron('nudges'))).json()).toEqual({ nudged: 1 })
    cronJobs.returns('deadline-reminders', { emails: 2 })
    const reminders = await import('./cron/deadline-reminders/route')
    expect((await reminders.POST(cron('deadline-reminders', 'x'))).status).toBe(401)
    expect(await (await reminders.POST(cron('deadline-reminders'))).json()).toEqual({ emails: 2 })
    const anon = await import('./cron/applications-anonymisation/route')
    expect((await anon.POST(cron('applications-anonymisation', 'x'))).status).toBe(401)
    await expect(anon.POST(cron('applications-anonymisation'))).rejects.toThrow('anon failed')
    cronJobs.returns('applications-anonymisation', 'anon-ok')
    expect(await (await anon.POST(cron('applications-anonymisation'))).json()).toEqual({
      anonymisation: 'anon-ok',
    })
  })

  it('daily runs every job and reports failures inline', async () => {
    const { POST } = await import('./cron/daily/route')
    expect((await POST(cron('daily', 'Bearer nope'))).status).toBe(401)
    const body = await (await POST(cron('daily'))).json()
    expect(body).toMatchObject({
      backup: 'backup-ok',
      digest: 'digest-ok',
      nudges: { nudged: 1 },
      'applications-summary': 'summary-ok',
      'applications-anonymisation': { error: 'Error: anon failed' },
    })
  })
})

describe('other routes', () => {
  it('health checks the database', async () => {
    const { GET } = await import('./health/route')
    expect(await (await GET()).json()).toEqual({ ok: true })
  })

  it('serves the import JSON schema with caching', async () => {
    const { GET } = await import('./project-import/schema/route')
    const res = GET()
    expect(res.headers.get('Cache-Control')).toContain('max-age')
    expect(await res.json()).toMatchObject({ type: 'object' })
  })

  it("the RPC handler serves every method with the caller's session", async () => {
    const route = await import('./rpc/[...orpc]/route')
    const vol = await createVolunteer()
    const token = await createSession(vol.id)
    const req = (
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      new Request(`http://localhost/api/rpc/${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const me = await route.POST(req('POST', 'auth/me', { json: {} }))
    expect(me.status).toBe(200)
    expect(JSON.stringify(await me.json())).toContain(vol.email)
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await route[method](new Request('http://localhost/api/nope', { method }))
      expect(res.status).toBe(404)
    }
  })
})
