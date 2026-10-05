import { describe, it, expect } from 'vitest'
import { screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { connect, createProject, createVolunteer } from '@/test/factories'
import { clientAs } from '@/test/rpc'
import { renderApp } from '@/test/render'
import { emails } from '@/test/fakes/email'
import ConversationPage from './page'

const mount = (id: number | string, as: Awaited<ReturnType<typeof createVolunteer>>) =>
  renderApp(<ConversationPage params={Promise.resolve({ id: String(id) })} />, {
    as,
    url: `/inbox/messages/${id}`,
  })

describe('conversation page', () => {
  it('shows the conversation, reads it, and sends a reply', async () => {
    const ann = await createVolunteer({ name: 'Ann' })
    const bob = await createVolunteer({ name: 'Bob' })
    const project = await createProject({ title: 'Stall' })
    await connect(ann, bob)
    const { threadId } = await clientAs(ann).messages.send({
      recipientId: bob.id,
      subject: 'Banners',
      message: 'Can you bring them? https://example.org/list',
      relatedProjectId: project.id,
    })
    await mount(threadId, bob)
    await screen.findByRole('heading', { name: 'Banners' })
    expect(screen.getByRole('link', { name: 'Ann' })).toHaveAttribute(
      'href',
      `/volunteers/${ann.id}`,
    )
    expect(screen.getByRole('link', { name: 'Stall' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    )
    expect(screen.getByRole('link', { name: 'https://example.org/list' })).toBeInTheDocument()
    await waitFor(async () =>
      expect(await prisma.message.count({ where: { toVolunteerId: bob.id, readAt: null } })).toBe(
        0,
      ),
    )

    const box = screen.getByLabelText('Write a reply')
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled()
    // Enter on an empty box sends nothing.
    fireEvent.submit(box.closest('form')!)
    expect(await prisma.message.count({ where: { fromVolunteerId: bob.id } })).toBe(0)
    expect(screen.getByText(/Your email address stays private/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/Let Ann reply by email/))
    expect(screen.getByText(/Your email address is included/)).toBeInTheDocument()
    await userEvent.type(box, 'Yes, both')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(await screen.findByText('Reply sent')).toBeInTheDocument()
    expect(await screen.findByText('Yes, both')).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(emails.lastTo(ann.email!)).toMatchObject({ replyTo: bob.email })
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('says when the other person has left, and reports a refused reply', async () => {
    const ann = await createVolunteer({ name: 'Ann' })
    const bob = await createVolunteer()
    await connect(ann, bob)
    const { threadId } = await clientAs(ann).messages.send({
      recipientId: bob.id,
      subject: 'S',
      message: 'M',
    })
    await mount(threadId, bob)
    const box = await screen.findByLabelText('Write a reply')
    // Ann leaves while the page is open, so the reply is refused.
    await prisma.volunteer.update({ where: { id: ann.id }, data: { deletedAt: new Date() } })
    await userEvent.type(box, 'hello?')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(await screen.findByText('This volunteer has left Catalyse')).toBeInTheDocument()
    cleanup()

    await mount(threadId, bob)
    expect(await screen.findByText(/Ann has left Catalyse/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Write a reply')).toBeNull()
  })

  it('shows not found for someone else’s conversation or a bad address', async () => {
    const ann = await createVolunteer()
    const bob = await createVolunteer()
    const eve = await createVolunteer()
    await connect(ann, bob)
    const { threadId } = await clientAs(ann).messages.send({
      recipientId: bob.id,
      subject: 'Private',
      message: 'M',
    })
    await mount(threadId, eve)
    expect(await screen.findByText('Conversation not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to messages' })).toHaveAttribute(
      'href',
      '/inbox?filter=message',
    )
    cleanup()
    await mount('nope', eve)
    expect(await screen.findByText('Conversation not found')).toBeInTheDocument()
  })
})
