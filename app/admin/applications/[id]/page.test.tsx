import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { APPLICATION_ANONYMISATION_MS } from '@/lib/applications'
import { createLocalGroup, createVolunteer, createSuperAdmin, createSkill } from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import ApplicationReviewPage from './page'

const hashOf = (email: string) =>
  createHash('sha256').update(email.toLowerCase().trim()).digest('hex')
const DAY = 86_400_000

describe('application review', () => {
  it('shows the full application, saves notes, and approves after confirming', async () => {
    const sa = await createSuperAdmin()
    const skill = await createSkill({ name: 'Cajoling' })
    const app = await createVolunteer({
      name: 'Full Applicant',
      approvalStatus: 'under_review',
      reviewerId: sa.id,
      localGroupId: (await createLocalGroup({ name: 'Bristol' })).id,
      country: 'UK',
      bio: 'Full bio',
      availabilityHoursPerWeek: 3,
      signalNumber: '+443',
      whatsappNumber: '+444',
      discordHandle: 'full#2',
      contactNotes: 'mornings',
      applicationMessage: 'Please',
      applicationAdminNotes: 'existing admin',
      applicationApplicantNotes: 'existing applicant',
    })
    await prisma.volunteerSkill.create({ data: { volunteerId: app.id, skillId: skill.id } })
    await prisma.rejectedApplication.create({
      data: {
        emailHash: hashOf(app.email!),
        rejectedAt: new Date('2025-06-01'),
        adminNotes: 'earlier',
        applicantNotes: 'try again',
      },
    })
    await prisma.rejectedApplication.create({
      data: { emailHash: hashOf(app.email!), rejectedAt: new Date('2025-01-01') },
    })
    await renderApp(<ApplicationReviewPage />, { as: sa, params: { id: String(app.id) } })
    await screen.findByRole('heading', { name: 'Full Applicant' })
    const main = screen.getByRole('main')
    expect(main).toHaveTextContent(`Bristol · United Kingdom · Applied`)
    expect(main).toHaveTextContent(`Reviewer: ${sa.name}`)
    expect(main).toHaveTextContent('Full bio')
    expect(main).toHaveTextContent('Cajoling')
    expect(main).toHaveTextContent('3 hours/week')
    expect(main).toHaveTextContent('Discord: full#2Signal: +443WhatsApp: +444mornings')
    expect(main).toHaveTextContent('Please')
    expect(main).toHaveTextContent('Previously rejected 2 times')
    expect(main).toHaveTextContent('try again')
    expect(screen.queryByText(/Already under review/)).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByLabelText(/Internal admin notes/)).toHaveValue('existing admin')
    expect(screen.getByLabelText(/Message to applicant/)).toHaveValue('existing applicant')

    await userEvent.type(screen.getByLabelText(/Internal admin notes/), ' plus more')
    await userEvent.type(screen.getByLabelText(/Message to applicant/), ' too')
    await userEvent.click(screen.getByRole('button', { name: 'Save notes' }))
    await screen.findByText('Notes saved')
    await waitFor(async () =>
      expect(
        (await prisma.volunteer.findUniqueOrThrow({ where: { id: app.id } }))
          .applicationApplicantNotes,
      ).toBe('existing applicant too'),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Full Applicant will be approved and notified by email.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'will be rejected and sent your message by email.',
    )
    await userEvent.click(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Request more info' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'resubmit their application, along with your message.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('dialog').querySelector('button:last-child')!)
    await screen.findByText('Application approved')
    expect(navigation.push).toHaveBeenCalledWith('/admin/applications')
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: app.id } })).approvalStatus,
    ).toBe('approved')
  })

  it('warns the reviewer when the applicant wrote a link', async () => {
    const sa = await createSuperAdmin()
    const app = await createVolunteer({
      name: 'Link Applicant',
      approvalStatus: 'pending',
      applicationMessage: 'My portfolio is at https://example.com/portfolio',
    })
    await renderApp(<ApplicationReviewPage />, { as: sa, params: { id: String(app.id) } })
    await screen.findByRole('heading', { name: 'Link Applicant' })
    expect(screen.getByRole('note')).toHaveTextContent('nobody has checked where they lead')
    // Shown as the text the applicant typed, never as something to click.
    expect(screen.queryByRole('link', { name: /example\.com/ })).toBeNull()
  })

  it('shows each status banner, reopens a rejection, and handles unknown ids and failures', async () => {
    const sa = await createSuperAdmin()
    const other = await createSuperAdmin()
    const mount = async (id: number | string) => {
      cleanup()
      await renderApp(<ApplicationReviewPage />, { as: sa, params: { id: String(id) } })
    }
    const approved = await createVolunteer({
      name: 'Was Approved',
      approvalStatus: 'approved',
      reviewerId: other.id,
      location: 'Town',
      country: null,
    })
    await mount(approved.id)
    await screen.findByText(`Already approved by ${other.name}.`)
    expect(screen.getByRole('main')).toHaveTextContent('Town · Applied')
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()

    const needsInfo = await createVolunteer({ name: 'Needs Info', approvalStatus: 'needs_info' })
    await mount(needsInfo.id)
    await screen.findByText('Waiting on the applicant — more info was requested.')
    await userEvent.click(screen.getByRole('button', { name: 'Request more info' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('resubmit their application.')
    await userEvent.click(screen.getByRole('button', { name: 'Request info' }))
    await screen.findByText('Cannot request info on a needs_info application')

    const pendingInfo = await createVolunteer({ name: 'Pending Info', approvalStatus: 'pending' })
    await mount(pendingInfo.id)
    await screen.findByRole('heading', { name: 'Pending Info' })
    await userEvent.click(screen.getByRole('button', { name: 'Request more info' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request info' }))
    await screen.findByText('More information requested')

    const theirs = await createVolunteer({
      name: 'Theirs',
      approvalStatus: 'under_review',
      reviewerId: other.id,
    })
    await mount(theirs.id)
    await screen.findByText(`Already under review by ${other.name}.`)

    const rejected = await createVolunteer({
      name: 'Was Rejected',
      approvalStatus: 'rejected',
      reviewerId: other.id,
      rejectedAt: new Date(Date.now() - APPLICATION_ANONYMISATION_MS + DAY / 2),
    })
    await mount(rejected.id)
    await screen.findByText(`Already rejected by ${other.name}.`)
    expect(screen.getByRole('main')).toHaveTextContent(/anonymised on .* \(1 day\)/)
    await userEvent.click(screen.getByRole('button', { name: 'Reopen application' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      "Was Rejected's application will be reset to pending",
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await screen.findByText('Application reopened')
    expect(
      (await prisma.volunteer.findUniqueOrThrow({ where: { id: rejected.id } })).approvalStatus,
    ).toBe('needs_info')

    const overdue = await createVolunteer({
      name: 'Overdue',
      approvalStatus: 'rejected',
      rejectedAt: new Date(Date.now() - APPLICATION_ANONYMISATION_MS - 3 * DAY),
    })
    await mount(overdue.id)
    await screen.findByText('Already rejected.')
    expect(screen.getByRole('main')).not.toHaveTextContent(/\(\d/)
    await userEvent.click(screen.getByRole('button', { name: '← Back to applications' }))
    expect(navigation.push).toHaveBeenCalledWith('/admin/applications')

    await mount(999_999)
    await screen.findByText('Application not found.')

    const pending = await createVolunteer({ name: 'Pending One', approvalStatus: 'pending' })
    await mount(pending.id)
    await screen.findByRole('heading', { name: 'Pending One' })
    await prisma.volunteer.delete({ where: { id: pending.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Save notes' }))
    await screen.findByText('Volunteer not found')
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await userEvent.click(screen.getByRole('dialog').querySelector('button:last-child')!)
    await screen.findAllByText('Volunteer not found')
  })
})
