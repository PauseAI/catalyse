import { describe, it, expect } from 'vitest'
import { screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createChapter,
  createChapterDeputy,
  createAdmin,
  createVolunteer,
  createTeam,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import TemplatesLibraryPage from './page'

const structure = (title: string) =>
  JSON.stringify({ sourceType: 'PROJECT', title, tasks: [{ ref: 'a', title: 'A' }] })

describe('templates library', () => {
  it('lists templates with their provenance and lets an admin use one', async () => {
    const admin = await createAdmin({ name: 'Ada Admin' })
    const team = await createTeam({ name: 'Origin Team' })
    const full = await prisma.template.create({
      data: {
        title: 'Full template',
        description: 'Well described',
        structure: structure('Full'),
        createdById: admin.id,
        sourceCountry: 'UK',
        sourceLocalGroup: 'Leeds',
        sourceTeamId: team.id,
      },
    })
    await prisma.template.create({
      data: { title: 'Bare template', structure: structure('Bare'), createdAt: null },
    })
    await prisma.template.create({
      data: {
        title: 'Quick one',
        sourceType: 'QUICK_TASK',
        structure: '{"sourceType":"QUICK_TASK"}',
      },
    })
    await renderApp(<TemplatesLibraryPage />, { as: admin, url: '/templates' })
    expect(await screen.findByRole('link', { name: 'New template' })).toHaveAttribute(
      'href',
      '/templates/new',
    )
    const card = (name: string) =>
      screen.getByRole('heading', { name }).closest<HTMLElement>('.shadow')!
    await screen.findByRole('heading', { name: 'Full template' })
    expect(card('Full template')).toHaveTextContent('Well described')
    expect(card('Full template')).toHaveTextContent('Used 0 times · Created by Ada Admin ·')
    expect(card('Full template')).toHaveTextContent('Previously: UK / Leeds / Origin Team')
    expect(card('Bare template').textContent).toMatch(/Used 0 times(Use template)?$/)
    expect(card('Bare template')).not.toHaveTextContent('Previously')
    // Quick-task templates have no instantiate path yet.
    await waitFor(() =>
      expect(
        within(card('Full template')).getByRole('button', { name: 'Use template' }),
      ).toBeInTheDocument(),
    )
    expect(within(card('Quick one')).queryByRole('button', { name: 'Use template' })).toBeNull()

    await userEvent.click(
      within(card('Full template')).getByRole('button', { name: 'Use template' }),
    )
    await screen.findByText(/Draft created/)
    const draft = await prisma.workItem.findFirstOrThrow({ where: { templateOriginId: full.id } })
    expect(navigation.push).toHaveBeenCalledWith(`/projects/${draft.id}/edit`)
  })

  it("turns away a member, and lets a chapter's staff copy a template", async () => {
    await renderApp(<TemplatesLibraryPage />, { as: await createVolunteer(), url: '/templates' })
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/projects?notice=no-access'),
    )
    cleanup()
    await prisma.template.create({ data: { title: 'Later', structure: structure('Later') } })
    const deputy = await createChapterDeputy(await createChapter())
    await renderApp(<TemplatesLibraryPage />, { as: deputy, url: '/templates' })
    expect(await screen.findByRole('link', { name: 'New template' })).toBeInTheDocument()
    const use = (await screen.findAllByRole('button', { name: 'Use template' }))[0]
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(use)
    await screen.findByText('Unauthorized')
  })

  it('tells an admin how to make the first template', async () => {
    await prisma.template.deleteMany()
    const admin = await createAdmin()
    await renderApp(<TemplatesLibraryPage />, { as: admin, url: '/templates' })
    await screen.findByText(/Build one from scratch/)
  })
})
