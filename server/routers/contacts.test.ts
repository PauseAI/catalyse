import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { connect, createAdmin, createProject, createTask, createVolunteer } from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { emails } from '@/test/fakes/email'
import { contactRelations, canReach } from '@/lib/contact'
import { isActiveRecently, touchLastActive } from '@/lib/activity'

const helps = (volunteerId: number, workItemId: number, status = 'accepted' as const) =>
  prisma.workItemInterest.create({
    data: { workItemId, volunteerId, interestType: 'want_to_contribute', status },
  })

describe('who may reach whom', () => {
  it('opens contact between a project’s owner and its people, and between its people', async () => {
    const owner = await createVolunteer()
    const helperA = await createVolunteer()
    const helperB = await createVolunteer()
    const taskHolder = await createVolunteer()
    const applicant = await createVolunteer()
    const stranger = await createVolunteer()
    const admin = await createAdmin()
    const p = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    await helps(helperA.id, p.id)
    await helps(helperB.id, p.id)
    await prisma.workItemInterest.create({
      data: { workItemId: p.id, volunteerId: applicant.id, interestType: 'want_to_contribute' },
    })
    await createTask(p.id, { assigneeId: taskHolder.id, status: 'in_progress' })

    expect(await canReach(owner, helperA.id)).toBe(true)
    expect(await canReach(helperA, owner.id)).toBe(true)
    expect(await canReach(helperA, helperB.id)).toBe(true)
    expect(await canReach(owner, taskHolder.id)).toBe(true)
    expect(await canReach(taskHolder, helperB.id)).toBe(true)
    // Asking to join is not yet working together.
    expect(await canReach(owner, applicant.id)).toBe(false)
    expect(await canReach(stranger, owner.id)).toBe(false)
    expect(await canReach(admin, stranger.id)).toBe(true)

    const all = await contactRelations(owner, [owner.id, helperA.id, stranger.id])
    expect([...all.reachable].sort()).toEqual([owner.id, helperA.id].sort())
    expect(await contactRelations(owner, [owner.id])).toMatchObject({
      reachable: new Set([owner.id]),
    })

    // An accepted request connects two people either way; a waiting one is only "requested".
    await connect(stranger, owner)
    expect(await canReach(owner, stranger.id)).toBe(true)
    const other = await createVolunteer()
    await prisma.contactRequest.create({
      data: { fromVolunteerId: other.id, toVolunteerId: owner.id, message: 'x'.repeat(20) },
    })
    expect(await contactRelations(other, [owner.id])).toMatchObject({
      reachable: new Set(),
      requested: new Set([owner.id]),
    })
    expect((await contactRelations(owner, [other.id])).requested.size).toBe(0)
  })
})

describe('contacts.request / respond', () => {
  const note = 'Hello, I organise the Leeds group and would like to talk.'

  it('asks, answers in the Inbox, and opens a conversation on accept', async () => {
    const me = await createVolunteer({ name: 'Mo Asker' })
    const them = await createVolunteer({ name: 'Tia Target' })
    const c = clientAs(me)

    await expect(c.contacts.request({ toVolunteerId: me.id, message: note })).rejects.toMatchObject(
      { message: 'That is you' },
    )
    await expect(
      c.contacts.request({ toVolunteerId: 999_999, message: note }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const hidden = await createVolunteer({ consentMakeProfileVisibleInDirectory: false })
    await expect(
      c.contacts.request({ toVolunteerId: hidden.id, message: note }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      c.contacts.request({ toVolunteerId: them.id, message: 'too short' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    expect(await c.contacts.request({ toVolunteerId: them.id, message: note })).toEqual({
      message: 'Request sent',
    })
    const request = await prisma.contactRequest.findFirstOrThrow({
      where: { fromVolunteerId: me.id },
    })
    expect(
      await prisma.notification.findFirst({
        where: { volunteerId: them.id, type: 'contact_request' },
      }),
    ).toMatchObject({
      title: 'Contact request: Mo Asker would like to connect',
      entityId: request.id,
    })
    await vi.waitFor(() => expect(emails.lastTo(them.email!)?.html).toContain(note))
    await expect(
      c.contacts.request({ toVolunteerId: them.id, message: note }),
    ).rejects.toMatchObject({ message: 'Your request is still waiting for an answer' })
    await expect(
      clientAs(them).contacts.request({ toVolunteerId: me.id, message: note }),
    ).rejects.toMatchObject({ message: expect.stringContaining('answer it in your Inbox') })

    // Seen from the profile, by both sides.
    expect(await c.volunteers.getById({ id: them.id })).toMatchObject({ contactRequested: true })
    expect(await clientAs(them).volunteers.getById({ id: me.id })).toMatchObject({
      incomingContactRequest: { id: request.id, message: note },
    })
    const home = await clientAs(them).dashboard.get()
    expect(home.attention.find((a) => a.kind === 'contact_request')).toMatchObject({
      title: 'Mo Asker would like to connect',
      href: `/volunteers/${me.id}`,
    })

    await expect(c.contacts.respond({ id: request.id, accept: true })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const answer = await clientAs(them).contacts.respond({ id: request.id, accept: true })
    expect(answer.message).toBe('Connected')
    expect(await canReach(me, them.id)).toBe(true)
    const thread = await prisma.message.findUniqueOrThrow({ where: { id: answer.threadId! } })
    expect(thread).toMatchObject({ fromVolunteerId: me.id, toVolunteerId: them.id, message: note })
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.findFirst({
          where: { volunteerId: me.id, type: 'contact_request_accepted' },
        }),
      ).toMatchObject({ link: `/inbox/messages/${thread.id}` }),
    )
    expect(
      await prisma.notification.count({ where: { volunteerId: them.id, type: 'contact_request' } }),
    ).toBe(0)
    await expect(
      c.contacts.request({ toVolunteerId: them.id, message: note }),
    ).rejects.toMatchObject({ message: 'You can already message them' })
  })

  it('declines quietly, holds off a repeat, and caps requests a day', async () => {
    const me = await createVolunteer()
    const them = await createVolunteer()
    const c = clientAs(me)
    await c.contacts.request({ toVolunteerId: them.id, message: note })
    const request = await prisma.contactRequest.findFirstOrThrow({
      where: { fromVolunteerId: me.id },
    })
    expect(await clientAs(them).contacts.respond({ id: request.id, accept: false })).toEqual({
      message: 'Request declined',
      threadId: null,
    })
    expect(
      await prisma.notification.count({
        where: { volunteerId: me.id, type: { startsWith: 'contact_request' } },
      }),
    ).toBe(0)
    await expect(
      c.contacts.request({ toVolunteerId: them.id, message: note }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('did not accept your last request'),
    })

    const busy = await createVolunteer()
    for (let i = 0; i < 4; i++) {
      await clientAs(busy).contacts.request({
        toVolunteerId: (await createVolunteer()).id,
        message: note,
      })
    }
    await clientAs(busy).contacts.request({ toVolunteerId: them.id, message: note })
    await expect(
      clientAs(busy).contacts.request({ toVolunteerId: me.id, message: note }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })

  it('offers Accept and Decline in the Inbox to the person asked', async () => {
    const me = await createVolunteer()
    const them = await createVolunteer()
    await clientAs(me).contacts.request({ toVolunteerId: them.id, message: note })
    const list = await clientAs(them).notifications.list({})
    const request = await prisma.contactRequest.findFirstOrThrow({
      where: { fromVolunteerId: me.id },
    })
    expect(list.notifications.find((n) => n.type === 'contact_request')?.action).toEqual({
      kind: 'contact_request',
      requestId: request.id,
    })
  })
})

describe('recent activity', () => {
  it('records use of the site at most once a day, and reads it as recent for 14 days', async () => {
    const vol = await createVolunteer({ lastActiveAt: null })
    await clientAs(vol).auth.me()
    const first = (await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).lastActiveAt
    expect(first).not.toBeNull()
    await touchLastActive({ id: vol.id, lastActiveAt: first })
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: vol.id } })).lastActiveAt,
    ).toEqual(first)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await touchLastActive({ id: 999_999, lastActiveAt: null })
    expect(error).toHaveBeenCalledWith('[ACTIVITY ERROR]', expect.anything())
    error.mockRestore()

    const now = new Date('2026-09-24T00:00:00Z')
    expect(isActiveRecently(null, now)).toBe(false)
    expect(isActiveRecently(new Date('2026-09-20T00:00:00Z'), now)).toBe(true)
    expect(isActiveRecently(new Date('2026-09-01T00:00:00Z'), now)).toBe(false)
    expect(isActiveRecently(new Date())).toBe(true)
  })

  it('shows the dot and the contact action on directory rows', async () => {
    const me = await createVolunteer()
    const active = await createVolunteer({ name: 'Zz Active', lastActiveAt: new Date() })
    await connect(me, active)
    const list = await clientAs(me).volunteers.list({ search: 'Zz Active' })
    expect(list.volunteers[0]).toMatchObject({
      activeRecently: true,
      canMessage: true,
      contactRequested: false,
    })
  })
})
