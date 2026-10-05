import { describe, it, expect } from 'vitest'
import { screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  connect,
  createVolunteer,
  createAdmin,
  createProject,
  createQuickTask,
  createSkill,
  createLocalGroup,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import { emails } from '@/test/fakes/email'
import VolunteersPage from './page'
import VolunteerDetailPage from './[id]/page'

describe('volunteer directory', () => {
  it('lists, filters, pages and clears', async () => {
    const skill = await createSkill()
    const extra = await Promise.all(Array.from({ length: 6 }, () => createSkill()))
    await createLocalGroup({ name: 'Dir Town', country: 'UK' })
    const me = await createVolunteer()
    const ann = await createVolunteer({
      name: 'Ann Directory',
      bio: 'x'.repeat(120),
      country: 'UK',
      localGroup: 'Dir Town',
      availabilityHoursPerWeek: 4,
      skills: { create: [skill, ...extra].map((s) => ({ skillId: s.id })) },
    })
    await createVolunteer({ name: 'Hidden Person', consentMakeProfileVisibleInDirectory: false })
    for (let i = 0; i < 50; i++)
      await createVolunteer({
        name: `Filler ${i}`,
        bio: null,
        availabilityHoursPerWeek: null,
        location: 'Somewhere',
      })
    await renderApp(<VolunteersPage />, { as: me, url: '/volunteers' })
    await screen.findByText('Page 1 of 2')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Page 2 of 2')
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('Page 1 of 2')
    await userEvent.click(screen.getByRole('button', { name: 'Skill filter' }))
    await userEvent.click(await screen.findByRole('option', { name: skill.name }))
    await screen.findByRole('link', { name: 'Ann Directory' })
    // Rows are compact: the first three skills, and a way to reach them.
    expect(screen.getByText('and 4 more')).toBeInTheDocument()
    const annCard = screen
      .getByRole('link', { name: 'Ann Directory' })
      .closest('.card') as HTMLElement
    expect(within(annCard).getByRole('button', { name: 'Request contact' })).toBeInTheDocument()
    expect(screen.getByText(/📍 Dir Town · United Kingdom/)).toBeInTheDocument()
    expect(screen.getByText('🕐 4h/week')).toBeInTheDocument()
    expect(screen.queryByText('Filler 0')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Country/Group filter' }))
    await userEvent.click(await screen.findByRole('option', { name: 'United Kingdom - Dir Town' }))
    await screen.findByRole('link', { name: 'Ann Directory' })
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nobody-matches' } })
    await screen.findByText('No volunteers found')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(navigation.replace).toHaveBeenCalledWith('?', { scroll: false })
    expect(screen.queryByText('Hidden Person')).toBeNull()
    void ann

    cleanup()
    const admin = await createAdmin()
    await renderApp(<VolunteersPage />, { as: admin, url: '/volunteers?q=Hidden' })
    await screen.findByRole('link', { name: 'Hidden Person' })
    expect(screen.getByText('Hidden')).toBeInTheDocument()
  })
})

describe('volunteer profile', () => {
  it('shows a full profile with contact, endorsements, tasks and history', async () => {
    const me = await createAdmin()
    const skill = await createSkill()
    const vol = await createVolunteer({
      name: 'Profiled',
      email: 'profiled@example.org',
      location: 'Leeds',
      localGroup: 'North',
      otherSkills: 'juggling',
      availabilityHoursPerWeek: 3,
      discordHandle: 'd#1',
      signalNumber: '+1',
      whatsappNumber: '+2',
      contactNotes: 'evenings',
      skills: { create: [{ skillId: skill.id }] },
    })
    await prisma.skillEndorsement.create({
      data: { volunteerId: vol.id, skillId: skill.id, endorsedById: me.id, rating: 'strong' },
    })
    await createQuickTask({
      title: 'Done task',
      assigneeId: vol.id,
      status: 'completed',
      reviewRating: 'good',
      skillId: skill.id,
    })
    await createQuickTask({
      title: 'Plain task',
      assigneeId: vol.id,
      status: 'completed',
      reviewRating: 'excellent',
    })
    await createProject({ title: 'Led', assigneeId: vol.id })
    await createProject({ title: 'Pitched', creatorId: vol.id })
    await renderApp(<VolunteerDetailPage params={Promise.resolve({ id: String(vol.id) })} />, {
      as: me,
    })
    await screen.findByRole('heading', { name: 'Profiled' })
    expect(screen.getByText('📍 Leeds · North')).toBeInTheDocument()
    expect(screen.getByText(`${skill.name} ✓`)).toBeInTheDocument()
    expect(screen.getByText('juggling')).toBeInTheDocument()
    expect(screen.getByText('3 hours/week')).toBeInTheDocument()
    // The login address is never on a profile, even for an admin.
    expect(screen.queryByText(/profiled@example\.org/)).toBeNull()
    expect(screen.getByText('Discord: d#1')).toBeInTheDocument()
    expect(screen.getByText('evenings')).toBeInTheDocument()
    expect(screen.getByText('Verified Skills')).toBeInTheDocument()
    expect(screen.getByText('Done task')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Led' })).toBeInTheDocument()
    expect(screen.getByText('Project owner')).toBeInTheDocument()
    expect(screen.getByText('Proposer')).toBeInTheDocument()
  })

  it('offers a message to someone the viewer is connected with, but not to themselves', async () => {
    const me = await createVolunteer({ name: 'Sender' })
    const vol = await createVolunteer({
      name: 'Reachable',
      email: 'reachable@example.org',
      lastActiveAt: new Date(),
    })
    await connect(me, vol)
    await renderApp(<VolunteerDetailPage params={Promise.resolve({ id: String(vol.id) })} />, {
      as: me,
    })
    await screen.findByRole('heading', { name: 'Reachable' })
    await userEvent.click(await screen.findByRole('button', { name: 'Message' }))
    const dialog = screen.getByRole('dialog', { name: 'Message Reachable' })
    expect(dialog).toHaveTextContent(
      'Reachable will see this in their Inbox and get a copy by email.',
    )
    await userEvent.type(within(dialog).getByLabelText('Subject'), 'Hello')
    await userEvent.type(within(dialog).getByLabelText('Message'), 'Can we talk?')
    // Sharing my address lets them reply to the email itself.
    await userEvent.click(within(dialog).getByLabelText(/Let Reachable reply by email/))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send Message' }))
    await screen.findByText(/Message sent\./)
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() =>
      expect(emails.lastTo('reachable@example.org')?.html).toContain('Can we talk?'),
    )
    expect(emails.lastTo('reachable@example.org')?.replyTo).toBe(me.email)
    expect(
      await prisma.message.findFirstOrThrow({ where: { toVolunteerId: vol.id } }),
    ).toMatchObject({ fromVolunteerId: me.id, subject: 'Hello', relatedWorkItemId: null })

    // Cancel closes without sending.
    await userEvent.click(screen.getByRole('button', { name: 'Message' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()

    await renderApp(<VolunteerDetailPage params={Promise.resolve({ id: String(vol.id) })} />, {
      as: vol,
    })
    await screen.findByRole('heading', { name: 'Reachable' })
    expect(screen.getByRole('img', { name: 'Active in the last 14 days' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull()
  })

  it('answers a contact request from the profile, and says when there is no way in', async () => {
    const me = await createVolunteer()
    const asker = await createVolunteer({ name: 'Asker' })
    const other = await createVolunteer({ name: 'Other Asker' })
    for (const from of [asker, other]) {
      await prisma.contactRequest.create({
        data: {
          fromVolunteerId: from.id,
          toVolunteerId: me.id,
          message: 'See https://example.org/plan',
        },
      })
    }
    const view = (id: number) =>
      renderApp(<VolunteerDetailPage params={Promise.resolve({ id: String(id) })} />, { as: me })
    await view(asker.id)
    const banner = await screen.findByRole('region', { name: 'Contact request' })
    expect(within(banner).getByRole('link', { name: 'https://example.org/plan' })).toBeTruthy()
    await userEvent.click(within(banner).getByRole('button', { name: 'Accept' }))
    await screen.findByText('Connected. You can now message each other.')
    await screen.findByRole('button', { name: 'Message' })
    cleanup()

    await view(other.id)
    const second = await screen.findByRole('region', { name: 'Contact request' })
    await userEvent.click(within(second).getByRole('button', { name: 'Decline' }))
    await screen.findByText('Request declined. They are not told.')
    cleanup()

    // The request has gone by the time it is answered.
    const late = await createVolunteer({ name: 'Late' })
    const req = await prisma.contactRequest.create({
      data: { fromVolunteerId: late.id, toVolunteerId: me.id, message: 'x'.repeat(20) },
    })
    await view(late.id)
    const third = await screen.findByRole('region', { name: 'Contact request' })
    await prisma.contactRequest.update({ where: { id: req.id }, data: { status: 'declined' } })
    await userEvent.click(within(third).getByRole('button', { name: 'Accept' }))
    await screen.findByText('Request not found')
    cleanup()

    // An owner can read a hidden applicant's profile but cannot reach them yet.
    const hidden = await createVolunteer({
      name: 'Hidden Applicant',
      consentMakeProfileVisibleInDirectory: false,
    })
    const p = await createProject({ assigneeId: me.id, status: 'in_progress' })
    await prisma.workItemInterest.create({
      data: { workItemId: p.id, volunteerId: hidden.id, interestType: 'want_to_contribute' },
    })
    await view(hidden.id)
    await screen.findByText('You can reach them once you work on a project together.')
  })

  it('shows a minimal profile, and a not-found state', async () => {
    const me = await createVolunteer()
    const bare = await createVolunteer({
      name: 'Bare',
      location: null,
      availabilityHoursPerWeek: null,
    })
    await renderApp(<VolunteerDetailPage params={Promise.resolve({ id: String(bare.id) })} />, {
      as: me,
    })
    await screen.findByRole('heading', { name: 'Bare' })
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Request contact' }))
    const ask = await screen.findByRole('dialog', { name: 'Connect with Bare' })
    await userEvent.type(
      within(ask).getByLabelText('Why would you like to connect?'),
      'Hello there, I would like to talk about leafleting.',
    )
    // They leave the directory before the request goes.
    await prisma.volunteer.update({
      where: { id: bare.id },
      data: { consentMakeProfileVisibleInDirectory: false },
    })
    await userEvent.click(within(ask).getByRole('button', { name: 'Send request' }))
    await screen.findByText('Volunteer not found')
    expect(screen.queryByText('Verified Skills')).toBeNull()
    cleanup()
    await renderApp(<VolunteerDetailPage params={Promise.resolve({ id: '999999' })} />, { as: me })
    await screen.findByRole('link', { name: 'Back to Volunteers' })
  })
})
