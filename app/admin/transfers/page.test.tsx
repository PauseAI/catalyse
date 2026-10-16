import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createAdmin, createChapter, createChapterLead, createMember } from '@/test/factories'
import { renderApp } from '@/test/render'
import ChapterMove from '@/components/ChapterMove'
import AdminTransfersPage from './page'

describe('moving chapter', () => {
  it('lets a member ask to move, see the request waiting, and cancel it', async () => {
    const [from, to] = [await createChapter(), await createChapter()]
    const member = await createMember(from)
    await renderApp(<ChapterMove country={from.country} />, { as: member })
    await userEvent.click(await screen.findByRole('button', { name: 'Moving to another country?' }))
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Moving to another country?' }))
    await userEvent.click(screen.getByRole('button', { name: 'Country you are moving to' }))
    await userEvent.click(await screen.findByRole('option', { name: to.name }))
    await userEvent.type(screen.getByLabelText(/Anything they should know/), 'New job')
    await userEvent.click(screen.getByRole('button', { name: 'Ask to move' }))
    expect(await screen.findByRole('status')).toHaveTextContent(`You asked to move to ${to.name}`)
    expect(
      await prisma.chapterTransferRequest.findFirst({ where: { volunteerId: member.id } }),
    ).toMatchObject({ toChapterId: to.id, reason: 'New job' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
    await screen.findByText('Request cancelled')
    expect(
      await screen.findByRole('button', { name: 'Moving to another country?' }),
    ).toBeInTheDocument()
  })

  it("shows the destination chapter's staff who asks, to approve or decline", async () => {
    const [from, to] = [await createChapter(), await createChapter()]
    const lead = await createChapterLead(to)
    const mover = await createMember(from, { name: 'Mo Mover' })
    const stayer = await createMember(from, { name: 'Sal Stayer' })
    for (const v of [mover, stayer]) {
      await prisma.chapterTransferRequest.create({
        data: {
          volunteerId: v.id,
          fromChapterId: from.id,
          toChapterId: to.id,
          toCountry: to.country,
          reason: v === mover ? 'Moving for work' : null,
        },
      })
    }
    await renderApp(<AdminTransfersPage />, { as: lead })
    expect(await screen.findByText('Moving for work')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve move for Mo Mover' }))
    await screen.findByText('Moved')
    await waitFor(async () =>
      expect(
        (await prisma.volunteer.findUniqueOrThrow({ where: { id: mover.id } })).nationalChapterId,
      ).toBe(to.id),
    )
    await waitFor(() => expect(screen.queryByText('Moving for work')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await screen.findByText('Declined')
    await screen.findByText('Nobody is waiting to move.')
  })

  it('lets a global admin narrow the moves to a chapter', async () => {
    await renderApp(<AdminTransfersPage />, { as: await createAdmin() })
    expect(await screen.findByRole('button', { name: 'Chapter filter' })).toBeInTheDocument()
  })
})
