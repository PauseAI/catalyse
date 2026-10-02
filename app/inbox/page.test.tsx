import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { connect, createProject, createTeam, createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import { clientAs } from '@/test/rpc'
import InboxPage from './page'

const day = (d: number) => new Date(Date.UTC(2026, 0, d))
const note = (id: number) => prisma.notification.findUniqueOrThrow({ where: { id } })

describe('inbox', () => {
  it('opens on what needs action, and shows every category under its own heading in All', async () => {
    const me = await createVolunteer()
    await prisma.notification.createMany({
      data: [
        { volunteerId: me.id, type: 'mention', title: 'Sam mentioned you', createdAt: day(3) },
        {
          volunteerId: me.id,
          type: 'message_received',
          title: 'Message from Ann',
          createdAt: day(2),
        },
        { volunteerId: me.id, type: 'project_approved', title: 'Approved: X', createdAt: day(1) },
      ],
    })
    await renderApp(<InboxPage />, { as: me, url: '/inbox' })
    await screen.findByText('Sam mentioned you')
    const pressed = () =>
      within(screen.getByRole('group', { name: 'Show' }))
        .getAllByRole('button')
        .find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent
    expect(pressed()).toBe('Needs action1')
    expect(screen.queryByText('Approved: X')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^All/ }))
    const updates = await screen.findByRole('region', { name: 'Updates' })
    const needs = screen.getByRole('region', { name: 'Needs action' })
    const messages = screen.getByRole('region', { name: 'Messages' })
    expect(within(needs).getByText('Sam mentioned you')).toBeInTheDocument()
    expect(within(updates).getByText('Approved: X')).toBeInTheDocument()
    expect(within(messages).getByText('Message from Ann')).toBeInTheDocument()

    // Seeing updates reads them; the rest stay unread.
    await waitFor(async () =>
      expect(await prisma.notification.count({ where: { volunteerId: me.id, readAt: null } })).toBe(
        2,
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: /^Needs action/ }))
    await waitFor(() => expect(screen.queryByText('Message from Ann')).toBeNull())
    expect(screen.getByText('Sam mentioned you')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(async () =>
      expect(await prisma.notification.count({ where: { volunteerId: me.id, readAt: null } })).toBe(
        1,
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: /^Updates/ }))
    expect(await screen.findByText('Approved: X')).toBeInTheDocument()
  })

  it('opens on All when nothing needs action, and says when a filter is empty', async () => {
    const me = await createVolunteer()
    await renderApp(<InboxPage />, { as: me, url: '/inbox' })
    expect(await screen.findByText('Your inbox is empty.')).toBeInTheDocument()
    for (const [label, empty] of [
      ['Needs action', 'Nothing is waiting on you.'],
      ['Updates', 'No updates.'],
      ['Messages', /No messages yet/],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: label }))
      expect(await screen.findByText(empty)).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull()
  })

  it('accepts an applicant and declines a join request in place', async () => {
    const me = await createVolunteer()
    const applicant = await createVolunteer({ name: 'Sam' })
    const project = await createProject({ assigneeId: me.id, title: 'Westminster' })
    const interest = await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: applicant.id,
        interestType: 'want_to_contribute',
      },
    })
    const team = await createTeam()
    await prisma.teamMembership.create({
      data: { teamId: team.id, volunteerId: me.id, role: 'leader' },
    })
    const request = await prisma.teamJoinRequest.create({
      data: { teamId: team.id, volunteerId: applicant.id },
    })
    await prisma.notification.createMany({
      data: [
        {
          volunteerId: me.id,
          type: 'new_interest',
          title: 'Sam wants to help',
          entityId: interest.id,
          link: `/projects/${project.id}`,
        },
        {
          volunteerId: me.id,
          type: 'team_join_request',
          title: 'Sam applied to join',
          entityId: request.id,
        },
      ],
    })
    await renderApp(<InboxPage />, { as: me, url: '/inbox' })
    const row = async (title: string) =>
      (await screen.findByText(title)).closest('li') as HTMLElement

    await userEvent.click(
      within(await row('Sam wants to help')).getByRole('button', { name: 'Accept' }),
    )
    await waitFor(async () =>
      expect(
        (await prisma.workItemInterest.findUniqueOrThrow({ where: { id: interest.id } })).status,
      ).toBe('accepted'),
    )
    await waitFor(() => expect(screen.queryByText('Sam wants to help')).toBeNull())

    await userEvent.click(
      within(await row('Sam applied to join')).getByRole('button', { name: 'Decline' }),
    )
    await waitFor(async () =>
      expect(
        (await prisma.teamJoinRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
      ).toBe('declined'),
    )
    await waitFor(() => expect(screen.queryByText('Sam applied to join')).toBeNull())
  })

  it('accepts an invite in place', async () => {
    const me = await createVolunteer()
    const project = await createProject({ assigneeId: (await createVolunteer()).id })
    const invite = await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: me.id,
        interestType: 'want_to_contribute',
        status: 'invited',
        origin: 'invited',
      },
    })
    await prisma.notification.create({
      data: {
        volunteerId: me.id,
        type: 'project_invite',
        title: 'Invited: help',
        entityId: invite.id,
      },
    })
    await renderApp(<InboxPage />, { as: me, url: '/inbox' })
    const row = (await screen.findByText('Invited: help')).closest('li') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Accept' }))
    await waitFor(async () =>
      expect(
        (await prisma.workItemInterest.findUniqueOrThrow({ where: { id: invite.id } })).status,
      ).toBe('accepted'),
    )
    await waitFor(() => expect(screen.queryByText('Invited: help')).toBeNull())
  })

  it('answers a contact request in place', async () => {
    const me = await createVolunteer()
    const asker = await createVolunteer({ name: 'Ada Asker' })
    await clientAs(asker).contacts.request({
      toVolunteerId: me.id,
      message: 'Hello, could we talk about the Leeds stall?',
    })
    await renderApp(<InboxPage />, { as: me, url: '/inbox' })
    const row = (await screen.findByText(/Ada Asker would like to connect/)).closest(
      'li',
    ) as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Accept' }))
    await waitFor(async () =>
      expect(
        (await prisma.contactRequest.findFirstOrThrow({ where: { fromVolunteerId: asker.id } }))
          .status,
      ).toBe('accepted'),
    )
  })

  it('reports an answer the server refuses', async () => {
    const me = await createVolunteer()
    const project = await createProject({ assigneeId: me.id })
    const interest = await prisma.workItemInterest.create({
      data: {
        workItemId: project.id,
        volunteerId: (await createVolunteer()).id,
        interestType: 'want_to_contribute',
      },
    })
    const team = await createTeam()
    await prisma.teamMembership.create({
      data: { teamId: team.id, volunteerId: me.id, role: 'leader' },
    })
    const request = await prisma.teamJoinRequest.create({
      data: { teamId: team.id, volunteerId: (await createVolunteer()).id },
    })
    await prisma.notification.createMany({
      data: [
        { volunteerId: me.id, type: 'new_interest', title: 'Applicant', entityId: interest.id },
        { volunteerId: me.id, type: 'team_join_request', title: 'Joiner', entityId: request.id },
      ],
    })
    await renderApp(<InboxPage />, { as: me, url: '/inbox' })
    const row = async (title: string) =>
      (await screen.findByText(title)).closest('li') as HTMLElement
    const applicantRow = await row('Applicant')
    const joinerRow = await row('Joiner')
    // The applicant withdrew, and someone else answered the join request, while the page
    // was open.
    await prisma.workItemInterest.delete({ where: { id: interest.id } })
    await prisma.teamJoinRequest.update({ where: { id: request.id }, data: { status: 'accepted' } })
    await userEvent.click(within(applicantRow).getByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('Interest not found')).toBeInTheDocument()
    await userEvent.click(within(joinerRow).getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('Request already reviewed')).toBeInTheDocument()
  })

  it('folds notifications about the same thing behind the newest', async () => {
    const me = await createVolunteer()
    const project = await createProject({ assigneeId: me.id })
    for (const [title, d] of [
      ['Comment 2', 5],
      ['Comment 1', 4],
    ] as const) {
      await prisma.notification.create({
        data: {
          volunteerId: me.id,
          type: 'mention',
          title,
          link: `/projects/${project.id}`,
          createdAt: day(d),
        },
      })
    }
    await prisma.notification.create({
      data: { volunteerId: me.id, type: 'mention', title: 'Elsewhere', link: '/projects/0' },
    })
    await renderApp(<InboxPage />, { as: me, url: '/inbox' })
    await screen.findByText('Comment 2')
    expect(screen.getByText('Elsewhere')).toBeInTheDocument()
    expect(screen.queryByText('Comment 1')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '1 earlier' }))
    expect(screen.getByText('Comment 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hide earlier' }))
    expect(screen.queryByText('Comment 1')).toBeNull()
  })

  it('marks read, unread, and read on opening', async () => {
    const me = await createVolunteer()
    const one = await prisma.notification.create({
      data: { volunteerId: me.id, type: 'mention', title: 'Only one', link: '/projects/1' },
    })
    await renderApp(<InboxPage />, { as: me, url: '/inbox' })
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as read' }))
    await waitFor(async () => expect((await note(one.id)).readAt).not.toBeNull())
    // Opening one already read leaves it as it was. Wait until the row shows it read, or the
    // page still thinks it is unread and marks it again.
    await screen.findByRole('button', { name: 'Mark as unread' })
    const readAt = (await note(one.id)).readAt
    await userEvent.click(await screen.findByRole('link', { name: 'Open' }))
    expect((await note(one.id)).readAt).toEqual(readAt)
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as unread' }))
    await waitFor(async () => expect((await note(one.id)).readAt).toBeNull())
    await screen.findByRole('button', { name: 'Mark as read' })
    await userEvent.click(screen.getByRole('link', { name: 'Open' }))
    await waitFor(async () => expect((await note(one.id)).readAt).not.toBeNull())
  })

  it('pages a long inbox', async () => {
    const me = await createVolunteer()
    await prisma.notification.createMany({
      data: Array.from({ length: 21 }, (_, i) => ({
        volunteerId: me.id,
        type: 'x',
        title: `Note ${i}`,
        readAt: day(20),
        createdAt: day(1 + i),
      })),
    })
    await renderApp(<InboxPage />, { as: me, url: '/inbox' })
    await screen.findByText('Note 20')
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Note 0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument()
  })
})

describe('inbox messages', () => {
  it('lists conversations under Messages, and a link can open there', async () => {
    const me = await createVolunteer()
    const ann = await createVolunteer({ name: 'Ann' })
    const bob = await createVolunteer({ name: 'Bob' })
    const project = await createProject({ title: 'Stall' })
    await connect(ann, me)
    await connect(me, bob)
    await clientAs(ann).messages.send({
      recipientId: me.id,
      subject: 'Banners',
      message: 'Bring them?',
      relatedProjectId: project.id,
    })
    const { threadId } = await clientAs(me).messages.send({
      recipientId: bob.id,
      subject: 'Leaflets',
      message: 'I have 200',
    })
    await renderApp(<InboxPage />, { as: me, url: '/inbox?filter=message' })
    const annRow = (await screen.findByText('Banners')).closest('a') as HTMLElement
    expect(within(annRow).getByText('Ann')).toBeInTheDocument()
    expect(within(annRow).getByText('1')).toBeInTheDocument()
    expect(within(annRow).getByText('Stall')).toBeInTheDocument()
    const bobRow = screen.getByText('Leaflets').closest('a') as HTMLElement
    expect(bobRow).toHaveAttribute('href', `/inbox/messages/${threadId}`)
    expect(bobRow).toHaveTextContent('You: I have 200')
    // Conversations are read by opening them, so there is nothing to mark here.
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull()
  })
})
