import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createProject, createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import ChangesRequestedBanner, { type ReviewRequest } from './ChangesRequestedBanner'

const at = new Date('2026-09-20T10:00:00Z')
const open: ReviewRequest = {
  id: 2,
  message: 'Add a deadline',
  requestedByName: 'Ada',
  createdAt: at,
  resolvedAt: null,
}
const earlier: ReviewRequest = {
  id: 1,
  message: 'Add tasks',
  requestedByName: null,
  createdAt: at,
  resolvedAt: at,
}

describe('ChangesRequestedBanner', () => {
  it('renders nothing without an open request', async () => {
    await renderApp(
      <>
        <ChangesRequestedBanner projectId={1} requests={[]} canResubmit />
        <ChangesRequestedBanner projectId={1} requests={[earlier]} canResubmit />
      </>,
    )
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.queryByText(/Changes requested/)).toBeNull()
  })

  it('shows the request and earlier rounds; only the proposer gets the buttons', async () => {
    await renderApp(
      <ChangesRequestedBanner
        projectId={1}
        requests={[{ ...open, requestedByName: null }, earlier]}
        canResubmit={false}
      />,
    )
    const banner = screen.getByRole('region', { name: 'Changes requested' })
    expect(banner).toHaveTextContent('Add a deadline')
    expect(within(banner).queryByRole('button')).toBeNull()
    await userEvent.click(screen.getByText('Earlier requests (1)'))
    expect(screen.getByText('Add tasks')).toBeVisible()
    expect(screen.getByText(/A team lead ·/)).toBeInTheDocument()
  })

  it('resubmits through the API, and shows a refusal', async () => {
    const creator = await createVolunteer()
    const project = await createProject({ status: 'needs_discussion', creatorId: creator.id })
    await renderApp(
      <ChangesRequestedBanner
        projectId={project.id}
        requests={[open]}
        canResubmit
        editHref={`/projects/${project.id}/edit`}
      />,
      { as: creator },
    )
    expect(screen.getByRole('region', { name: 'Changes requested by Ada' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit project' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/edit`,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Resubmit for review' }))
    expect(await screen.findByText('Project resubmitted for review.')).toBeInTheDocument()
    await waitFor(async () =>
      expect((await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })).status).toBe(
        'pending_review',
      ),
    )
    // A second press finds nothing left to resubmit.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resubmit for review' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Resubmit for review' }))
    expect(await screen.findByText('No changes have been requested')).toBeInTheDocument()
  })
})
