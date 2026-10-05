import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createProject, createTeam, connect } from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { rateLimit } from '@/test/fakes/rate-limit'
import { env } from '@/lib/env'
import { emails } from '@/test/fakes/email'

describe('messages.send', () => {
  it('starts a conversation, tells the recipient in the Inbox, and emails a copy', async () => {
    const sender = await createVolunteer()
    const recipient = await createVolunteer()
    await connect(sender, recipient)
    const project = await createProject()
    const c = clientAs(sender)
    const res = await c.messages.send({
      recipientId: recipient.id,
      subject: 'Hi',
      message: 'Hello',
      relatedProjectId: project.id,
    })
    expect(res.message).toBe('Message sent')
    // The sender's address stays private unless they share it.
    expect(emails.last).toMatchObject({ to: recipient.email, replyTo: undefined })
    expect(emails.last.html).toContain(project.title)
    expect(emails.last.html).toContain(`${env.APP_URL}/inbox/messages/${res.threadId}`)
    expect(
      await prisma.notification.findFirstOrThrow({ where: { volunteerId: recipient.id } }),
    ).toMatchObject({
      type: 'message_received',
      link: `/inbox/messages/${res.threadId}`,
      entityId: res.threadId,
    })

    await c.messages.send({
      recipientId: recipient.id,
      subject: 'Two',
      message: 'x',
      shareEmail: true,
    })
    expect(emails.last).toMatchObject({ replyTo: sender.email })
    expect(emails.last.html).not.toContain('about the project')

    // An unknown related project is refused (it would otherwise break the foreign key).
    await expect(
      c.messages.send({
        recipientId: recipient.id,
        subject: 'Three',
        message: 'x',
        relatedProjectId: 999_999,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Project not found' })

    // So is a project the sender cannot see: its title would otherwise reach both parties.
    const team = await createTeam()
    const hidden = await createProject({ title: 'Team secret', teamId: team.id })
    await expect(
      c.messages.send({
        recipientId: recipient.id,
        subject: 'Four',
        message: 'x',
        relatedProjectId: hidden.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Project not found' })
    expect(emails.sent.some((e) => e.html.includes('Team secret'))).toBe(false)
    expect(
      (await c.messages.threads()).map((t) => t.relatedProject?.title).filter(Boolean),
    ).toEqual([project.title])
  })

  it('refuses self, unknown recipients and people the sender does not work with, and rate limits', async () => {
    const sender = await createVolunteer()
    const c = clientAs(sender)
    await expect(
      c.messages.send({ recipientId: sender.id, subject: 's', message: 'm' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      c.messages.send({ recipientId: 999_999, subject: 's', message: 'm' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const stranger = await createVolunteer()
    await expect(
      c.messages.send({ recipientId: stranger.id, subject: 's', message: 'm' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('contact request'),
    })
    rateLimit.denyNext(5)
    await expect(
      c.messages.send({ recipientId: stranger.id, subject: 's', message: 'm' }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })

  it('reaches someone without an email in the Inbox alone, and logs a failed relay', async () => {
    const sender = await createVolunteer()
    const noEmail = await createVolunteer({ email: null })
    await connect(sender, noEmail)
    await clientAs(sender).messages.send({ recipientId: noEmail.id, subject: 's', message: 'm' })
    expect(emails.sent).toEqual([])
    expect(await prisma.notification.count({ where: { volunteerId: noEmail.id } })).toBe(1)

    const recipient = await createVolunteer()
    await connect(recipient, sender)
    emails.setConfigured(false)
    await clientAs(sender).messages.send({ recipientId: recipient.id, subject: 's', message: 'm' })
    expect(emails.sent).toEqual([])
    emails.setConfigured(true)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    emails.failNext()
    await clientAs(sender).messages.send({ recipientId: recipient.id, subject: 's', message: 'm' })
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('[EMAIL ERROR]', expect.any(Error)))
  })
})

describe('message threads', () => {
  it('lists conversations, shows a thread, and reading it clears the unread', async () => {
    const ann = await createVolunteer({ name: 'Ann' })
    const bob = await createVolunteer({ name: 'Bob' })
    await connect(ann, bob)
    const project = await createProject({ title: 'Stall' })
    const { threadId } = await clientAs(ann).messages.send({
      recipientId: bob.id,
      subject: 'Banners',
      message: 'Can you bring them?',
      relatedProjectId: project.id,
    })
    await clientAs(bob).messages.reply({ threadId, message: '  Yes  ' })
    await clientAs(ann).messages.reply({ threadId, message: 'Thanks', shareEmail: true })
    expect(emails.lastTo(bob.email!)).toMatchObject({
      subject: '[Catalyse] Banners',
      replyTo: ann.email,
    })

    const bobsThreads = await clientAs(bob).messages.threads()
    expect(bobsThreads).toEqual([
      expect.objectContaining({
        id: threadId,
        subject: 'Banners',
        with: { id: ann.id, name: 'Ann' },
        last: expect.objectContaining({ body: 'Thanks', fromMe: false }),
        unread: 2,
        relatedProject: { id: project.id, title: 'Stall' },
      }),
    ])
    expect((await clientAs(ann).messages.threads())[0]).toMatchObject({
      with: { id: bob.id, name: 'Bob' },
      unread: 1,
    })

    const thread = await clientAs(bob).messages.thread({ id: threadId })
    expect(thread).toMatchObject({
      subject: 'Banners',
      with: { id: ann.id, name: 'Ann' },
      canReply: true,
      relatedProject: { id: project.id, title: 'Stall' },
    })
    expect(thread.messages.map((m) => [m.fromName, m.body, m.fromMe])).toEqual([
      ['Ann', 'Can you bring them?', false],
      ['Bob', 'Yes', true],
      ['Ann', 'Thanks', false],
    ])
    expect((await clientAs(bob).messages.threads())[0].unread).toBe(0)
    expect(
      await prisma.notification.count({
        where: { volunteerId: bob.id, type: 'message_received', readAt: null },
      }),
    ).toBe(0)
    // Reading is per person: Ann has not opened Bob's reply yet.
    expect((await clientAs(ann).messages.threads())[0].unread).toBe(1)
  })

  it('keeps a conversation to its two people, and stops replies to someone who left', async () => {
    const ann = await createVolunteer()
    const bob = await createVolunteer()
    const eve = await createVolunteer()
    await connect(ann, bob)
    const { threadId } = await clientAs(ann).messages.send({
      recipientId: bob.id,
      subject: 's',
      message: 'm',
    })
    await expect(clientAs(eve).messages.thread({ id: threadId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(clientAs(eve).messages.reply({ threadId, message: 'hi' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    // A reply's id is not a thread.
    await clientAs(bob).messages.reply({ threadId, message: 'r' })
    const replyRow = await prisma.message.findFirstOrThrow({ where: { threadId } })
    await expect(clientAs(bob).messages.thread({ id: replyRow.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    await prisma.volunteer.update({ where: { id: ann.id }, data: { deletedAt: new Date() } })
    expect((await clientAs(bob).messages.thread({ id: threadId })).canReply).toBe(false)
    await expect(
      clientAs(bob).messages.reply({ threadId, message: 'still there?' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    rateLimit.denyNext(5)
    await expect(clientAs(bob).messages.reply({ threadId, message: 'x' })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    })
  })
})
