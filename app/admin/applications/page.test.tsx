import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { APPLICATION_ANONYMISATION_MS } from '@/lib/applications'
import { createVolunteer, createSuperAdmin, createSkill } from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import ApplicationsPage from './page'

const hashOf = (email: string) =>
  createHash('sha256').update(email.toLowerCase().trim()).digest('hex')
const DAY = 86_400_000

describe('applications list', () => {
  it('groups applications by section, expands the collapsed ones, and starts reviews', async () => {
    const sa = await createSuperAdmin()
    const otherAdmin = await createSuperAdmin()
    const skill = await createSkill({ name: 'Persuading' })
    const fresh = await createVolunteer({
      name: 'Fresh Applicant',
      approvalStatus: 'pending',
      localGroup: 'Leeds',
      country: 'UK',
      bio: 'Keen as mustard',
      availabilityHoursPerWeek: 5,
      signalNumber: '+441',
      whatsappNumber: '+442',
      discordHandle: 'fresh#1',
      contactNotes: 'evenings',
      applicationMessage: 'Let me in',
      applicationAdminNotes: 'seems fine',
      applicationApplicantNotes: 'we will see',
    })
    await prisma.volunteerSkill.create({ data: { volunteerId: fresh.id, skillId: skill.id } })
    await prisma.rejectedApplication.create({
      data: {
        emailHash: hashOf(fresh.email!),
        rejectedAt: new Date('2025-06-01'),
        adminNotes: 'earlier',
        applicantNotes: 'try again',
      },
    })
    await prisma.rejectedApplication.create({
      data: { emailHash: hashOf(fresh.email!), rejectedAt: new Date('2025-01-01') },
    })
    const theirs = await createVolunteer({
      name: 'Their Applicant',
      approvalStatus: 'under_review',
      reviewerId: otherAdmin.id,
      location: 'Somewhere',
      country: null,
    })
    const mineReview = await createVolunteer({
      name: 'Continuing Applicant',
      approvalStatus: 'under_review',
      reviewerId: sa.id,
    })
    await createVolunteer({ name: 'Needs Info Applicant', approvalStatus: 'needs_info' })
    await createVolunteer({
      name: 'Rejected Soon',
      approvalStatus: 'rejected',
      rejectedAt: new Date(Date.now() - APPLICATION_ANONYMISATION_MS + DAY / 2),
    })
    await createVolunteer({
      name: 'Rejected Later',
      approvalStatus: 'rejected',
      rejectedAt: new Date(Date.now() - APPLICATION_ANONYMISATION_MS + 3 * DAY),
    })
    await createVolunteer({
      name: 'Rejected Overdue',
      approvalStatus: 'rejected',
      rejectedAt: new Date(Date.now() - APPLICATION_ANONYMISATION_MS - 3 * DAY),
    })
    await createVolunteer({ name: 'Approved Applicant', approvalStatus: 'approved' })
    await prisma.rejectedApplication.create({
      data: {
        emailHash: 'gone-hash',
        rejectedAt: new Date('2025-03-01'),
        adminNotes: 'anon notes',
        applicantNotes: 'anon applicant',
      },
    })
    await prisma.anonymisedEmail.create({ data: { emailHash: 'gone-hash' } })
    await prisma.rejectedApplication.create({
      data: { emailHash: 'allowed-hash', rejectedAt: new Date('2025-02-01') },
    })
    await prisma.anonymisedEmail.create({
      data: { emailHash: 'allowed-hash', reapplyAllowedAt: new Date('2025-04-01') },
    })

    await renderApp(<ApplicationsPage />, { as: sa })
    const freshCard = (
      await screen.findByRole('heading', { name: 'Fresh Applicant' })
    ).closest<HTMLElement>('[role="article"]')!
    expect(freshCard).toHaveTextContent('Leeds · United Kingdom · Applied')
    expect(freshCard).toHaveTextContent('Persuading')
    expect(freshCard).toHaveTextContent('5 hours/week')
    expect(freshCard).toHaveTextContent(`Email: ${fresh.email}`)
    expect(freshCard).toHaveTextContent('Discord: fresh#1Signal: +441WhatsApp: +442evenings')
    expect(freshCard).toHaveTextContent('seems fine')
    expect(freshCard).toHaveTextContent('we will see')
    expect(freshCard).toHaveTextContent('Previously rejected 2 times')
    expect(freshCard).toHaveTextContent('earlier')
    expect(freshCard).toHaveTextContent('try again')
    const theirCard = (
      await screen.findByRole('heading', { name: 'Their Applicant' })
    ).closest<HTMLElement>('[role="article"]')!
    expect(theirCard).toHaveTextContent(`Somewhere · Applied`)
    expect(theirCard).toHaveTextContent(`Reviewer: ${otherAdmin.name}`)
    expect(screen.getByTestId('applications-section-mine')).toHaveTextContent(
      'Pending & under review by me: 2',
    )
    await waitFor(() =>
      expect(screen.getByTestId('applications-section-rejected')).toHaveTextContent('Rejected: 3'),
    )
    const soon = screen
      .getByRole('heading', { name: 'Rejected Soon' })
      .closest<HTMLElement>('[role="article"]')!
    expect(soon).toHaveTextContent(/anonymised on .* \(1 day\)/)
    expect(
      screen.getByRole('heading', { name: 'Rejected Later' }).closest('[role="article"]'),
    ).toHaveTextContent(/\(3 days\)/)
    expect(
      screen.getByRole('heading', { name: 'Rejected Overdue' }).closest('[role="article"]'),
    ).not.toHaveTextContent(/\(\d/)

    // Approved and anonymised sections start collapsed; Enter and click toggle them.
    expect(screen.queryByRole('heading', { name: 'Approved Applicant' })).toBeNull()
    const approvedToggle = await screen.findByRole('button', { name: /^Approved: \d+/ })
    approvedToggle.focus()
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('heading', { name: 'Approved Applicant' })
    await userEvent.click(approvedToggle)
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Approved Applicant' })).toBeNull(),
    )
    const anonToggle = await screen.findByRole('button', { name: /Rejected – anonymised: 4/ })
    anonToggle.focus()
    await userEvent.keyboard('{Enter}')
    const anonCards = await screen.findAllByText(/Identity anonymised/)
    expect(anonCards).toHaveLength(4)
    expect(screen.getByText('Reapplication allowed since 1 April 2025')).toBeInTheDocument()
    const anonCard = screen.getByText('anon notes').closest<HTMLElement>('[role="article"]')!
    expect(anonCard).toHaveTextContent('anon applicant')
    await userEvent.click(within(anonCard).getByRole('button', { name: 'Allow reapply' }))
    await screen.findByText('Reapplication allowed')
    await waitFor(() => expect(screen.getAllByText(/Reapplication allowed since/)).toHaveLength(2))
    await userEvent.click(anonToggle)
    await waitFor(() => expect(screen.queryByText(/Identity anonymised/)).toBeNull())

    // Navigation buttons.
    const mineCard = screen
      .getByRole('heading', { name: 'Continuing Applicant' })
      .closest<HTMLElement>('[role="article"]')!
    await userEvent.click(within(mineCard).getByRole('button', { name: 'Continue review' }))
    expect(navigation.push).toHaveBeenCalledWith(`/admin/applications/${mineReview.id}`)
    const article = (name: string) =>
      screen.getByRole('heading', { name }).closest<HTMLElement>('[role="article"]')!
    await userEvent.click(
      within(article('Their Applicant')).getByRole('button', { name: 'Continue review' }),
    )
    expect(navigation.push).toHaveBeenCalledWith(`/admin/applications/${theirs.id}`)
    await userEvent.click(within(article('Rejected Soon')).getByRole('button', { name: 'View' }))
    expect(navigation.push).toHaveBeenCalledTimes(3)
    await userEvent.click(
      within(article('Fresh Applicant')).getByRole('button', { name: 'Start review' }),
    )
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(`/admin/applications/${fresh.id}`),
    )
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: fresh.id } })).approvalStatus,
    ).toBe('under_review')
  })

  it('shows the empty state, and still navigates when starting a review fails', async () => {
    const sa = await createSuperAdmin()
    await prisma.rejectedApplication.deleteMany()
    await prisma.volunteer.deleteMany({ where: { approvalStatus: { not: 'approved' } } })
    await prisma.volunteer.updateMany({ data: { approvalStatus: 'pending' } })
    await prisma.volunteer.update({ where: { id: sa.id }, data: { approvalStatus: 'approved' } })
    await renderApp(<ApplicationsPage />, { as: sa })
    // The super admin's own approved record is hidden while nothing else is listed.
    await screen.findByText(/Approved: 1|No applications to review/)
    const applicant = await createVolunteer({ name: 'Doomed Applicant', approvalStatus: 'pending' })
    await prisma.rejectedApplication.create({
      data: { emailHash: 'fail-hash', rejectedAt: new Date('2025-02-01') },
    })
    await prisma.anonymisedEmail.create({ data: { emailHash: 'fail-hash' } })
    cleanup()
    await renderApp(<ApplicationsPage />, { as: sa })
    const card = (
      await screen.findByRole('heading', { name: 'Doomed Applicant' })
    ).closest<HTMLElement>('[role="article"]')!
    await userEvent.click(await screen.findByRole('button', { name: /Rejected – anonymised/ }))
    await prisma.anonymisedEmail.delete({ where: { emailHash: 'fail-hash' } })
    await userEvent.click(await screen.findByRole('button', { name: 'Allow reapply' }))
    await screen.findByText('Record not found')
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(within(card).getByRole('button', { name: 'Start review' }))
    await screen.findByText('Failed to start review')
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(`/admin/applications/${applicant.id}`),
    )
  })
})
