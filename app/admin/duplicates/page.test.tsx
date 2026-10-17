import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createAdmin, createChapter, createChapterLead, createVolunteer } from '@/test/factories'
import { navigation } from '@/test/next-navigation'
import { renderApp } from '@/test/render'
import AdminDuplicatesPage from './page'

const account = (email: string) => screen.getByRole('group', { name: email })
const pairOf = (email: string) => account(email).closest('li') as HTMLElement

describe('possible duplicates', () => {
  it('lets a global admin keep one account of a pair, or say they are two people', async () => {
    const admin = await createAdmin()
    const chapter = await createChapter({ name: 'Grand Fenwick' })
    const lead = await createChapterLead(chapter, {
      name: 'Lou Lead',
      email: 'lou-lead@example.com',
    })
    const leadTwin = await createVolunteer({ name: 'lou lead', email: 'lou-2@example.com' })
    const sam = await createVolunteer({
      name: 'Sam Same',
      email: 'sam-1@example.com',
      discordHandle: 'sam',
    })
    const samTwin = await createVolunteer({
      name: 'Sam Same',
      email: 'sam-2@example.com',
      discordHandle: 'SAM',
      createdAt: null,
    })
    const pat = await createVolunteer({ name: 'Pat Two', email: 'pat-1@example.com' })
    await createVolunteer({ name: 'Pat Two', email: null, signalNumber: '07700 900456' })
    await renderApp(<AdminDuplicatesPage />, { as: admin })

    await screen.findByRole('heading', { name: 'Possible duplicates' })
    await screen.findByRole('group', { name: 'lou-lead@example.com' })
    expect(
      within(pairOf('sam-1@example.com')).getByText('Same Discord handle · Same name'),
    ).toBeInTheDocument()
    expect(account('lou-lead@example.com')).toHaveTextContent(
      'Grand Fenwick · Lead of Grand Fenwick',
    )
    expect(account('lou-2@example.com')).toHaveTextContent(/Holding pool · joined/)
    // No join date to show.
    expect(within(account('sam-2@example.com')).getByText('Holding pool')).toBeInTheDocument()
    // An account with no email is named instead.
    expect(
      within(pairOf('pat-1@example.com')).getByRole('group', { name: 'Pat Two' }),
    ).toBeInTheDocument()

    // The lead's account cannot be the one retired.
    await userEvent.click(
      within(account('lou-2@example.com')).getByRole('button', { name: 'Keep this account' }),
    )
    await screen.findByText(
      'Lou Lead leads the Grand Fenwick chapter. Give the role to the account you are keeping first.',
    )
    await userEvent.click(
      within(account('lou-lead@example.com')).getByRole('button', { name: 'Keep this account' }),
    )
    await screen.findByText('lou lead is marked as a duplicate of Lou Lead')
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'lou-lead@example.com' })).toBeNull(),
    )
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: leadTwin.id } })).duplicateOfId,
    ).toBe(lead.id)

    await userEvent.click(
      within(pairOf('sam-1@example.com')).getByRole('button', { name: 'Not the same person' }),
    )
    await screen.findByText('Marked as different people')
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'sam-1@example.com' })).toBeNull(),
    )
    expect(
      await prisma.distinctAccountPair.count({
        where: { volunteerAId: sam.id, volunteerBId: samTwin.id },
      }),
    ).toBe(1)
    void pat
  })

  it('says when there is nothing to settle', async () => {
    const admin = await createAdmin()
    // Every other account in this file's database has left.
    await prisma.volunteer.updateMany({
      where: { id: { not: admin.id } },
      data: { deletedAt: new Date() },
    })
    await renderApp(<AdminDuplicatesPage />, { as: admin })
    await screen.findByText('No possible duplicates.')
  })

  it('turns away anyone but a global admin', async () => {
    await renderApp(<AdminDuplicatesPage />, { as: await createChapterLead(await createChapter()) })
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/projects?notice=global-admin-only'),
    )
  })
})
