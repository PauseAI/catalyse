import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import {
  ProjectCard,
  ProjectList,
  statusBadgeClasses,
  projectStatusVariant,
  type Project,
} from './ProjectCard'
import BugReportDialog from './BugReportDialog'

const base: Project = {
  id: 1,
  title: 'Rally',
  status: 'in_progress',
  description: 'x'.repeat(200),
  owner: { name: 'Owen' },
  skills: [
    { id: 1, name: 'A', isRequired: true },
    { id: 2, name: 'B', isRequired: true },
    { id: 3, name: 'C', isRequired: false },
    { id: 4, name: 'D', isRequired: false },
    { id: 5, name: 'E', isRequired: false },
  ],
}

describe('ProjectCard', () => {
  it('renders the owned, populated card with badges, meta line and skill overflow', () => {
    render(
      <ProjectCard
        project={{
          ...base,
          isSeekingHelp: true,
          needsTasks: true,
          daysLate: 2,
          country: 'UK',
          localGroup: 'Leeds',
          remoteEligibility: 'GLOBAL',
          team: { id: 1, name: 'Ops' },
          isMyTeam: true,
          projectType: 'sprint',
          timeCommitmentHoursPerWeek: 3,
          urgency: 'high',
          match: {
            requiredMatchPercent: 100,
            matchedRequiredCount: 2,
            totalRequired: 2,
            overallScore: 100,
          },
        }}
        userSkillIds={new Set([1, 2, 3, 4, 5])}
      />,
    )
    expect(screen.getByRole('link', { name: 'Rally' })).toHaveAttribute('href', '/projects/1')
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Seeking Help')).toBeInTheDocument()
    expect(screen.getByText('Needs Tasks')).toBeInTheDocument()
    expect(screen.getByText('2 days late')).toBeInTheDocument()
    expect(screen.getByText('👤 Owen')).toBeInTheDocument()
    expect(screen.getByText('📍 Remote · Global · United Kingdom · Leeds')).toBeInTheDocument()
    expect(screen.getByText('🧑‍🤝‍🧑 Ops')).toBeInTheDocument()
    expect(screen.getByText('📋 Sprint')).toBeInTheDocument()
    expect(screen.getByText('🕐 3h/week')).toBeInTheDocument()
    expect(screen.getByText('⚡ high priority')).toBeInTheDocument()
    expect(screen.getByText('and 1 more')).toBeInTheDocument()
    expect(screen.getByText('Good match')).toBeInTheDocument()
    expect(screen.getByText('Matches: A, B')).toBeInTheDocument()
    expect(screen.getByText('👤 Owen')).toHaveAttribute('title', 'Owner')
    expect(screen.getByText('⚡ high priority')).toHaveAttribute('title', 'Priority')
    expect(screen.getByText(/x{150}…/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Details' })).toBeInTheDocument()
  })

  it('handles the ownerless card, proposer display, custom action, and unknown status/type', () => {
    const { rerender } = render(
      <ProjectCard
        project={{
          ...base,
          status: 'weird_state',
          owner: null,
          isSeekingOwner: true,
          description: null,
          skills: [],
          projectType: 'other',
          proposedBy: 'Pat',
        }}
        action={<button>Act</button>}
      />,
    )
    expect(screen.getByText('weird state')).toBeInTheDocument()
    expect(screen.getByText('Seeking Owner')).toBeInTheDocument()
    expect(screen.getByText('👤 Seeking owner')).toBeInTheDocument()
    expect(screen.getByText('📋 other')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument()
    // Who proposed a project is never shown on the card, whoever the viewer is.
    rerender(<ProjectCard project={{ ...base, owner: null, proposedBy: { id: 4, name: 'Pat' } }} />)
    expect(screen.queryByText(/Proposed by/)).toBeNull()
    expect(screen.getByText('👤 Seeking owner')).toBeInTheDocument()
    rerender(<ProjectCard project={{ ...base, isOrgProposed: true, owner: { name: 'Ola' } }} />)
    expect(screen.queryByText(/Proposed by|Will be owner/)).toBeNull()
    expect(screen.getByText('👤 Ola')).toBeInTheDocument()
    // Skills the viewer lacks are hidden when they have any skills at all.
    rerender(<ProjectCard project={base} userSkillIds={new Set([99])} />)
    expect(screen.queryByText('A')).toBeNull()
    expect(statusBadgeClasses('completed')).toContain('bg-emerald-100')
    expect(projectStatusVariant('nope')).toBe('neutral')
  })

  it('ProjectList lays cards out in a grid or a single column', () => {
    const { container, rerender } = render(<ProjectList projects={[base, { ...base, id: 2 }]} />)
    expect(container.firstChild).toHaveClass('grid-cols-2')
    expect(screen.getAllByRole('link', { name: 'Rally' })).toHaveLength(2)
    rerender(<ProjectList projects={[base]} single />)
    expect(container.firstChild).toHaveClass('flex-col')
  })
})

describe('BugReportDialog', () => {
  it('validates, submits a report and shows the success state', async () => {
    const me = await createVolunteer()
    const onClose = vi.fn()
    const { rerender } = await renderApp(<BugReportDialog isOpen={false} onClose={onClose} />, {
      as: me,
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<BugReportDialog isOpen onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Feature' }))
    expect(screen.getByLabelText('Details')).toHaveAttribute(
      'placeholder',
      'What would you like to be able to do?',
    )
    await userEvent.click(screen.getByRole('button', { name: 'UX Issue' }))
    await userEvent.type(screen.getByLabelText('Title'), 'Confusing')
    await userEvent.type(screen.getByLabelText('Details'), 'short')
    fireEvent.submit(screen.getByLabelText('Details').closest('form')!)
    expect(screen.getByLabelText('Details')).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(screen.getByLabelText('Details'), ' but now long enough')
    expect(screen.getByLabelText('Details')).not.toHaveAttribute('aria-invalid')
    await userEvent.click(screen.getByRole('button', { name: 'How urgent is this?' }))
    await userEvent.click(screen.getByRole('option', { name: 'High: blocking' }))
    await waitFor(() => expect(localStorage.getItem('authToken')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Submit Report' }))
    expect(await screen.findByText('Thank you!')).toBeInTheDocument()
    const report = await prisma.bugReport.findFirstOrThrow({ where: { reporterId: me.id } })
    expect(report).toMatchObject({ category: 'ux', severity: 'high', title: 'Confusing' })
    expect(screen.getByRole('link', { name: 'View your report' })).toHaveAttribute(
      'href',
      `/bugs/${report.id}`,
    )
    await userEvent.click(screen.getByRole('link', { name: 'View your report' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error when the API refuses, and closes via cancel / ×', async () => {
    const onClose = vi.fn()
    await renderApp(<BugReportDialog isOpen onClose={onClose} />)
    await userEvent.type(screen.getByLabelText('Title'), 'T')
    await userEvent.type(screen.getByLabelText('Details'), 'Long enough description')
    await userEvent.click(screen.getByRole('button', { name: 'Submit Report' }))
    expect(await screen.findByText('Unauthorized')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByLabelText('Close'))
    // The backdrop is inert: a stray click outside must not discard a half-written report.
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
