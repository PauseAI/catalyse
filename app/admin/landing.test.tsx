import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createSuperAdmin,
  createProject,
  createChapter,
  createChapterDeputy,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import AdminLandingPage from './page'
import ComponentPreviewPage from '../component-preview/page'
import { ThemeProvider } from '@/components/ThemeProvider'

describe('admin landing', () => {
  it('shows stats, counts, notifications and role-appropriate links', async () => {
    const sa = await createSuperAdmin()
    await createProject({ status: 'pending_review' })
    await createVolunteer({ approvalStatus: 'pending' })
    await prisma.bugReport.create({ data: { title: 'b', description: 'ten chars..' } })
    await prisma.notification.createMany({
      data: [
        { volunteerId: sa.id, type: 'new_bug_report', title: 'Bug came in', link: '/admin/bugs' },
        { volunteerId: sa.id, type: 'new_project_proposal', title: 'Proposal came in' },
        { volunteerId: sa.id, type: 'new_project_proposal', title: 'Old one', readAt: new Date() },
      ],
    })
    await renderApp(<AdminLandingPage />, { as: sa })
    await screen.findByRole('heading', { name: 'Global admin' })
    await screen.findByText('Bug came in')
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/admin/bugs')
    expect(screen.getByRole('link', { name: /Manage applications/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cron job runs/ })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Triage queue/ })).toHaveTextContent('1'),
    )
    await screen.findByText('Approved')
    await userEvent.click(screen.getAllByRole('button', { name: 'Mark as read' })[0])
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Mark as read' })).toHaveLength(1),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull())

    cleanup()
    const chapter = await createChapter()
    const deputy = await createChapterDeputy(chapter)
    await renderApp(<AdminLandingPage />, { as: deputy })
    await screen.findByRole('heading', { name: `${chapter.name} chapter admin` })
    expect(screen.getByRole('link', { name: /Manage applications/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: `${chapter.name} chapter` })).toHaveAttribute(
      'href',
      `/admin/chapters/${chapter.id}`,
    )
    // The global admins' pages are not offered.
    expect(screen.queryByText('Platform')).toBeNull()
    expect(screen.queryByRole('link', { name: /Bug reports/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'National chapters' })).toBeNull()
    await screen.findByText(/No notifications|no new notifications/i)
    cleanup()
    const vol = await createVolunteer()
    await renderApp(<AdminLandingPage />, { as: vol })
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/projects?notice=no-access'),
    )
  })
})

describe('component preview', () => {
  it('renders and its demo state toggles work', async () => {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as never
    render(
      <ThemeProvider>
        <ComponentPreviewPage />
      </ThemeProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Tab two' }))
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    await userEvent.click(screen.getByLabelText('Dismiss'))
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await userEvent.click(screen.getAllByLabelText('Remove task')[0])
    expect(screen.queryAllByLabelText('Remove task')).toHaveLength(0)
  })
})
