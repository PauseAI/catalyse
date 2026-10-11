import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createProject, createSkill } from '@/test/factories'

import { emails } from '@/test/fakes/email'
import { notifyMatchingVolunteers } from './project-match-notify'

afterEach(() => {
  vi.restoreAllMocks()
})

async function skills(n: number) {
  const out = []
  for (let i = 0; i < n; i++) out.push(await createSkill())
  return out
}

describe('notifyMatchingVolunteers', () => {
  it('does nothing when email is off, the project is missing, or it has no required skills', async () => {
    emails.setConfigured(false)
    await notifyMatchingVolunteers(1)
    emails.setConfigured(true)
    await notifyMatchingVolunteers(999_999)
    const [s] = await skills(1)
    const p = await createProject({ skills: { create: [{ skillId: s.id, isRequired: false }] } })
    await notifyMatchingVolunteers(p.id)
    expect(emails.sent).toEqual([])
  })

  it('emails opted-in, geo-eligible volunteers at a notifiable grade', async () => {
    const [a, b, c] = await skills(3)
    const p = await createProject({
      country: 'UK',
      remoteEligibility: 'NONE',
      description: null,
      skills: { create: [a, b, c].map((s) => ({ skillId: s.id, isRequired: true })) },
    })
    const mk = (over: Parameters<typeof createVolunteer>[0], ids: number[]) =>
      createVolunteer({
        emailDigest: 'match',
        country: 'UK',
        skills: { create: ids.map((skillId) => ({ skillId })) },
        ...over,
      })
    const good = await mk({}, [a.id, b.id])
    await mk({}, [a.id]) // partial: not notifiable
    await mk({ country: 'US' }, [a.id, b.id]) // wrong country, no remote
    await mk({ emailDigest: 'none' }, [a.id, b.id]) // not opted in
    await notifyMatchingVolunteers(p.id)
    expect(emails.sent).toHaveLength(1)
    expect(emails.last.to).toBe(good.email)
    expect(emails.last.html).toContain('match your skills')
    expect(emails.last.html).toContain('67% match')
    expect(emails.last.html).toContain(`/projects/${p.id}`)
  })

  it('alerts an out-of-country volunteer to a global project only if they opted in', async () => {
    const [a, b] = await skills(2)
    const mk = (over: Parameters<typeof createVolunteer>[0]) =>
      createVolunteer({
        emailDigest: 'match',
        country: 'UK',
        skills: { create: [a, b].map((s) => ({ skillId: s.id })) },
        ...over,
      })
    const optedIn = await mk({ notifyRemoteProjects: true })
    await mk({ notifyRemoteProjects: false })

    const global = await createProject({
      country: 'US',
      remoteEligibility: 'GLOBAL',
      skills: { create: [a, b].map((s) => ({ skillId: s.id, isRequired: true })) },
    })
    await notifyMatchingVolunteers(global.id)
    expect(emails.sent.map((e) => e.to)).toEqual([optedIn.email])

    // A project open to nobody outside its country alerts neither, opted in or not.
    emails.reset()
    const local = await createProject({
      country: 'US',
      remoteEligibility: 'NONE',
      skills: { create: [a, b].map((s) => ({ skillId: s.id, isRequired: true })) },
    })
    await notifyMatchingVolunteers(local.id)
    expect(emails.sent).toEqual([])
  })

  it('is a no-op with no candidate volunteers, and logs a failed send', async () => {
    const [a] = await skills(1)
    const p = await createProject({ skills: { create: [{ skillId: a.id, isRequired: true }] } })
    await notifyMatchingVolunteers(p.id)
    expect(emails.sent).toEqual([])

    const [b, c] = await skills(2)
    const p2 = await createProject({
      skills: { create: [b, c].map((s) => ({ skillId: s.id, isRequired: true })) },
    })
    await createVolunteer({
      emailDigest: 'match',
      skills: { create: [{ skillId: b.id }, { skillId: c.id }] },
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    emails.failNext()
    await notifyMatchingVolunteers(p2.id)
    expect(error).toHaveBeenCalledWith('[MATCH NOTIFY ERROR]', expect.any(Error))
    expect(await prisma.workItem.count({ where: { id: p2.id } })).toBe(1)
  })
})
