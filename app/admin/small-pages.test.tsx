import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  chapterFor,
  createAdmin,
  createChapterLead,
  createSuperAdmin,
  createProject,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import PlatformSettingsPage from './platform-settings/page'
import AdminCronRunsPage from './cron-runs/page'
import EmailPreviewPage from './email-preview/page'
import AdminProjectsPage from './projects/page'
import AdminRolesPage from './roles/page'

import { cronJobs } from '@/test/fakes/cron-jobs'

describe('platform settings', () => {
  it('toggles application approval and reports a failed save', async () => {
    const sa = await createSuperAdmin()
    await renderApp(<PlatformSettingsPage />, { as: sa })
    const toggle = await screen.findByRole('checkbox', { name: 'Require application approval' })
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await screen.findByText('Settings saved')
    await waitFor(async () =>
      expect((await prisma.platformSettings.findFirstOrThrow()).requireApplicationApproval).toBe(
        false,
      ),
    )
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(toggle)
    await screen.findByText('Failed to save settings')
  })

  it('toggles maintenance mode', async () => {
    const sa = await createSuperAdmin()
    await renderApp(<PlatformSettingsPage />, { as: sa })
    const toggle = await screen.findByRole('checkbox', { name: 'Maintenance mode' })
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect((await prisma.platformSettings.findFirstOrThrow()).maintenanceMode).toBe(true)
    // Leave the shared database open for the rest of the file.
    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect((await prisma.platformSettings.findFirstOrThrow()).maintenanceMode).toBe(false)
  })

  it('enables and disables countries, marking the ones with a chapter', async () => {
    await chapterFor('UK')
    const sa = await createSuperAdmin()
    await renderApp(<PlatformSettingsPage />, { as: sa })
    const countries = await screen.findByRole('region', { name: 'Countries' })
    expect(within(countries).getByText('United Kingdom').parentElement).toHaveTextContent(
      'has a chapter',
    )
    expect(within(countries).getByText('Austria').parentElement).not.toHaveTextContent('chapter')

    const austria = within(countries).getByRole('checkbox', { name: 'Austria' })
    expect(austria).not.toBeChecked()
    await userEvent.click(austria)
    await screen.findByText('Austria enabled')
    await waitFor(() => expect(austria).toBeChecked())
    expect((await prisma.country.findUniqueOrThrow({ where: { code: 'Austria' } })).enabled).toBe(
      true,
    )
    await userEvent.click(austria)
    await screen.findByText('Austria disabled')
    await waitFor(() => expect(austria).not.toBeChecked())

    localStorage.setItem('authToken', 'stale')
    await userEvent.click(austria)
    await screen.findByText('Failed to save settings')
    expect((await prisma.country.findUniqueOrThrow({ where: { code: 'Austria' } })).enabled).toBe(
      false,
    )
  })
})

describe('cron runs', () => {
  it('lists runs with durations, opens the detail dialog, and runs jobs', async () => {
    const sa = await createSuperAdmin()
    const started = new Date('2026-05-01T10:00:00Z')
    await prisma.cronJobRun.createMany({
      data: [
        {
          jobName: 'nudges',
          triggeredBy: 'cron',
          status: 'success',
          startedAt: started,
          finishedAt: new Date(started.getTime() + 250),
          summary: 'nudged 3',
        },
        {
          jobName: 'backup',
          triggeredBy: 'admin',
          status: 'error',
          startedAt: started,
          finishedAt: new Date(started.getTime() + 2500),
          summary: null,
        },
        {
          jobName: 'digest',
          triggeredBy: 'cron',
          status: 'running',
          startedAt: started,
          finishedAt: null,
          summary: null,
        },
      ],
    })
    await renderApp(<AdminCronRunsPage />, { as: sa })
    const rows = await screen.findAllByRole('row')
    expect(rows.map((r) => r.textContent)).toEqual([
      'JobTriggered byStatusStartedFinishedDurationSummary',
      expect.stringMatching(/^nudgescronsuccess.*250msnudged 3$/),
      expect.stringMatching(/^backupadminerror.*2\.5s—$/),
      expect.stringMatching(/^digestcronrunning.*———$/),
    ])

    await userEvent.click(rows[3])
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('digest: running')
    expect(dialog).toHaveTextContent('Finished: still running')
    expect(dialog).toHaveTextContent('No summary recorded.')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(rows[1])
    expect(await screen.findByRole('dialog')).toHaveTextContent('nudged 3')
    await userEvent.keyboard('{Escape}')

    cronJobs.fails('digest', 'digest exploded')
    await userEvent.click(screen.getAllByRole('button', { name: 'Run now' })[0])
    await screen.findByText('backup finished')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(5))
    await userEvent.click(screen.getAllByRole('button', { name: 'Run now' })[1])
    await screen.findByText('digest failed')
  })

  it('shows the empty state', async () => {
    const sa = await createSuperAdmin()
    await prisma.cronJobRun.deleteMany()
    await renderApp(<AdminCronRunsPage />, { as: sa })
    await screen.findByText('No cron job runs recorded yet.')
  })
})

describe('email preview', () => {
  it('renders every template with its parameters and opens one in a new tab', async () => {
    const admin = await createAdmin()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await renderApp(<EmailPreviewPage />, { as: admin })
    await screen.findByRole('heading', { name: 'Email previews' })
    expect(
      screen.getByRole('heading', { name: 'Digest (skill match)' }).closest('section'),
    ).toHaveTextContent('is_matchtrue')
    expect(
      screen.getByRole('heading', { name: 'Digest (general)' }).closest('section'),
    ).toHaveTextContent('is_matchfalse')
    // Every type the page lists must exist server-side, or its row never leaves "Loading…".
    await waitFor(() => expect(screen.queryAllByText('Loading…')).toHaveLength(0))
    const frames = screen.getAllByTitle('Email preview')
    expect(frames).toHaveLength(screen.getAllByRole('button', { name: /Open in new tab/ }).length)
    expect(screen.getAllByText(/Subject:/)).toHaveLength(frames.length)
    fireEvent.load(frames[0])
    await userEvent.click(screen.getAllByRole('button', { name: /Open in new tab/ })[0])
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^blob:/), '_blank')
  })
})

describe('admin projects', () => {
  it("lists the admin's drafts, untitled or not, above the new-project button", async () => {
    const admin = await createAdmin()
    await renderApp(<AdminProjectsPage />, { as: admin })
    await screen.findByRole('link', { name: 'New project' })
    expect(screen.queryByText('My drafts')).toBeNull()
    cleanup()
    const draft = await createProject({
      creatorId: admin.id,
      status: 'draft',
      title: 'Half done',
      isOrgProposed: true,
    })
    await createProject({ creatorId: admin.id, status: 'draft', title: '', isOrgProposed: true })
    await renderApp(<AdminProjectsPage />, { as: admin })
    await screen.findByText('My drafts')
    expect(screen.getByText('Untitled draft')).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: 'Manage' }).map((l) => l.getAttribute('href')),
    ).toContain(`/projects/${draft.id}/edit`)
  })
})

describe('roles and permissions', () => {
  it('shows a chapter lead what each role may do, and who may do each thing', async () => {
    const lead = await createChapterLead(await chapterFor('UK'))
    await renderApp(<AdminRolesPage />, { as: lead })
    const deputy = await screen.findByRole('region', { name: 'Project deputy' })
    expect(within(deputy).getByText('Add a task')).toBeInTheDocument()
    expect(within(deputy).queryByText('Delete it outright')).toBeNull()

    const work = screen.getByRole('rowheader', { name: /task\.work/ })
    const cells = within(work.closest('tr')!).getAllByRole('cell')
    const allowed = cells.map((c) => c.textContent?.includes('Yes'))
    expect(allowed.filter(Boolean)).toHaveLength(1)
    // Each mark says where the role holds it.
    expect(
      within(screen.getByRole('rowheader', { name: /project\.delete/ }).closest('tr')!).getByText(
        'Yes: Chapter lead, their chapter',
      ),
    ).toBeInTheDocument()
  })
})
