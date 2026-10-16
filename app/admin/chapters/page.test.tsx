import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createAdmin,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createMember,
  createVolunteer,
} from '@/test/factories'
import { emails } from '@/test/fakes/email'
import { navigation } from '@/test/next-navigation'
import { renderApp } from '@/test/render'
import AdminChaptersPage from './page'
import AdminChapterPage from './[id]/page'

const pick = async (button: string, option: string) => {
  await userEvent.click(screen.getByRole('button', { name: button }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}
const chapterPage = (id: number) => (
  <AdminChapterPage params={Promise.resolve({ id: String(id) })} />
)

describe('national chapters list', () => {
  it('opens a chapter and places someone from the holding pool', async () => {
    const admin = await createAdmin()
    const existing = await createChapter()
    await createChapterLead(existing, { name: 'Lea Lead' })
    const waiting = await createVolunteer({ name: 'Wendy Waiting', country: 'Other' })
    await renderApp(<AdminChaptersPage />, { as: admin })

    expect(await screen.findByRole('link', { name: existing.name })).toHaveAttribute(
      'href',
      `/admin/chapters/${existing.id}`,
    )
    expect(screen.getByText(/Led by Lea Lead · 0 deputies · 1 member$/)).toBeInTheDocument()
    expect(screen.getByText('Other', { exact: false })).toBeInTheDocument()

    await pick('Country', 'Kenya')
    await userEvent.click(screen.getByRole('button', { name: 'Open chapter' }))
    await screen.findByText('Kenya chapter opened')
    const kenya = await screen.findByRole('link', { name: 'Kenya' })
    expect(kenya).toBeInTheDocument()

    await pick(`Move ${waiting.name} to`, existing.name)
    await screen.findByText('Moved')
    await waitFor(async () =>
      expect(
        (await prisma.volunteer.findUniqueOrThrow({ where: { id: waiting.id } })).nationalChapterId,
      ).toBe(existing.id),
    )
  })

  it('turns away anyone but a global admin', async () => {
    await renderApp(<AdminChaptersPage />, { as: await createChapterLead(await createChapter()) })
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/projects?notice=global-admin-only'),
    )
  })
})

describe('one chapter', () => {
  it('lets a global admin appoint a lead, move a member and invite a lead', async () => {
    const admin = await createAdmin()
    const chapter = await createChapter()
    const other = await createChapter()
    const ann = await createMember(chapter, { name: 'Ann' })
    const bob = await createMember(chapter, { name: 'Bob' })
    await renderApp(chapterPage(chapter.id), { as: admin })

    expect(
      await screen.findByRole('heading', { name: `${chapter.name} chapter` }),
    ).toBeInTheDocument()
    expect(screen.getByText('No lead yet.')).toBeInTheDocument()
    await pick('Appoint a lead', 'Ann')
    await screen.findByText('Ann now leads the chapter')
    await screen.findByRole('button', { name: 'Remove as lead' })
    await userEvent.click(screen.getByRole('button', { name: 'Remove as lead' }))
    await screen.findByText('The chapter has no lead now')

    await pick(`Move ${bob.name} to`, other.name)
    await screen.findByText('Moved')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Bob' })).toBeNull())

    await userEvent.type(screen.getByLabelText('Email address'), 'boss@example.com')
    await pick('Role', 'Lead')
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await screen.findByText('Invite sent for boss@example.com')
    expect(await screen.findByText(/boss@example.com · Lead/)).toBeInTheDocument()
    expect(emails.lastTo('boss@example.com')).toBeTruthy()
    void ann

    const history = screen.getByRole('heading', { name: 'History' }).parentElement!
    await waitFor(() =>
      expect(within(history).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3),
    )
    expect(within(history).getByText(/made the lead: Ann/)).toBeInTheDocument()
  })

  it('lets the lead run deputies and invites, and shows a deputy the chapter read-only', async () => {
    const chapter = await createChapter()
    const lead = await createChapterLead(chapter, { name: 'Lea' })
    const mo = await createMember(chapter, { name: 'Mo' })
    const deputy = await createChapterDeputy(chapter, { name: 'Dee' })
    await renderApp(chapterPage(chapter.id), { as: lead })

    await screen.findByRole('heading', { name: `${chapter.name} chapter` })
    expect(screen.queryByRole('button', { name: 'Appoint a lead' })).toBeNull()
    expect(screen.queryByRole('button', { name: `Move ${mo.name} to` })).toBeNull()
    await pick('Appoint a deputy', 'Mo')
    await screen.findByText('Mo is now a deputy')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Dee as deputy' }))
    await screen.findByText('Deputy removed')

    await userEvent.type(screen.getByLabelText('Email address'), 'helper@example.com')
    expect(screen.queryByRole('button', { name: 'Role' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel invite to helper@example.com' }),
    )
    await screen.findByText('Invite revoked')
    void deputy
  })

  it('shows a deputy the chapter without the staff controls', async () => {
    const chapter = await createChapter()
    const deputy = await createChapterDeputy(chapter, { name: 'Dee' })
    await createMember(chapter, { name: 'Mo' })
    await renderApp(chapterPage(chapter.id), { as: deputy })
    await screen.findByRole('link', { name: 'Mo' })
    expect(screen.queryByRole('button', { name: 'Appoint a deputy' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Invite by email' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
  })

  it('says so when the chapter is not one the viewer runs', async () => {
    const lead = await createChapterLead(await createChapter())
    await renderApp(chapterPage((await createChapter()).id), { as: lead })
    expect(await screen.findByRole('heading', { name: 'Chapter not found' })).toBeInTheDocument()
  })
})
