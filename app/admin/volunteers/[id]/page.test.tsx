import { describe, it, expect } from 'vitest'
import { screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createLocalGroup,
  createAdmin,
  createVolunteer,
  createProject,
  createQuickTask,
  createSkill,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import AdminVolunteerDetailPage from './page'

const mount = (id: number | string, as: Awaited<ReturnType<typeof createAdmin>>) =>
  renderApp(<AdminVolunteerDetailPage params={Promise.resolve({ id: String(id) })} />, { as })

describe('admin volunteer detail', () => {
  it('shows the profile, and manages notes and endorsements', async () => {
    const admin = await createAdmin({ name: 'Ann Admin' })
    const skill = await createSkill({ name: 'Juggling' })
    const other = await createSkill({ name: 'Unicycling' })
    const vol = await createVolunteer({
      name: 'Detailed Vol',
      bio: 'Life story',
      location: 'Leeds',
      localGroupId: (await createLocalGroup({ name: 'Leeds North' })).id,
      availabilityHoursPerWeek: 4,
      discordHandle: 'dv#1',
      signalNumber: '+445',
      whatsappNumber: '+446',
      consentMakeProfileVisibleInDirectory: false,
      isAdmin: true,
    })
    await prisma.volunteerSkill.create({ data: { volunteerId: vol.id, skillId: skill.id } })
    await prisma.skillEndorsement.create({
      data: { volunteerId: vol.id, skillId: skill.id, endorsedById: admin.id, rating: 'strong' },
    })
    const note = await prisma.adminNote.create({
      data: {
        volunteerId: vol.id,
        authorId: admin.id,
        content: 'First note',
        category: 'skill_feedback',
      },
    })
    await createQuickTask({
      title: 'Quick one',
      assigneeId: vol.id,
      skillId: skill.id,
      status: 'completed',
      reviewRating: 'great',
    })
    await createQuickTask({ title: 'Quick two', assigneeId: vol.id })
    const owned = await createProject({
      title: 'Owned project',
      assigneeId: vol.id,
      status: 'in_progress',
    })
    await createProject({ title: 'Proposed project', creatorId: vol.id, status: 'pending_review' })

    await mount(vol.id, admin)
    await screen.findByRole('heading', { name: 'Detailed Vol' })
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('Profile hidden')).toBeInTheDocument()
    expect(screen.getByText('Life story')).toBeInTheDocument()
    expect(screen.getByText('Juggling', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Juggling', { selector: 'strong' }).parentElement).toHaveTextContent(
      'Juggling: strong · by Ann Admin',
    )
    const contact = document.getElementById('contactInfo')!
    expect(contact).toHaveTextContent('Location: Leeds')
    expect(contact).toHaveTextContent('Local group: Leeds North')
    expect(contact).toHaveTextContent('Availability: 4h/week')
    expect(contact).toHaveTextContent('Discord: dv#1')
    expect(contact).toHaveTextContent('Signal: +445')
    expect(contact).toHaveTextContent('WhatsApp: +446')

    // Notes: shown, edited (cancel then save), added, deleted.
    const notes = () => document.getElementById('notesList')!
    expect(notes()).toHaveTextContent('skill feedbackby Ann AdminEditDeleteFirst note')
    await userEvent.click(within(notes()).getByRole('button', { name: 'Edit' }))
    await userEvent.click(within(notes()).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(notes()).getByRole('button', { name: 'Edit' }))
    const edit = screen.getByLabelText('Edit note')
    await userEvent.clear(edit)
    await userEvent.type(edit, 'Edited note')
    await userEvent.click(within(notes()).getByRole('button', { name: 'Save' }))
    await screen.findByText('Note updated.')
    await waitFor(() => expect(notes()).toHaveTextContent('Edited note'))
    await userEvent.click(screen.getByRole('button', { name: 'Category' }))
    await userEvent.click(screen.getByRole('option', { name: 'Reliability' }))
    await userEvent.type(screen.getByLabelText('Note'), 'Always on time')
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await screen.findByText('Note added.')
    await waitFor(() => expect(notes()).toHaveTextContent('reliability'))
    expect(await prisma.adminNote.count({ where: { volunteerId: vol.id } })).toBe(2)
    await userEvent.click(within(notes()).getAllByRole('button', { name: 'Delete' })[0])
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete note' }),
    )
    await screen.findByText('Note deleted.')
    await waitFor(async () =>
      expect(await prisma.adminNote.count({ where: { volunteerId: vol.id } })).toBe(1),
    )
    void note

    await userEvent.click(screen.getByRole('tab', { name: 'Quick tasks' }))
    expect(screen.getByText('Quick one (Juggling)')).toBeInTheDocument()
    expect(screen.getByText('completed · great')).toBeInTheDocument()
    expect(screen.getByText('Quick two')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Project history' }))
    expect(screen.getByRole('link', { name: 'Owned project' })).toHaveAttribute(
      'href',
      `/projects/${owned.id}`,
    )
    expect(screen.getByRole('link', { name: 'Owned project' }).parentElement).toHaveTextContent(
      'owner · in progress',
    )
    expect(screen.getByRole('link', { name: 'Proposed project' }).parentElement).toHaveTextContent(
      'proposer · pending review',
    )

    await userEvent.click(screen.getByRole('tab', { name: 'Endorse skill' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skill' }))
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'Unicy')
    await userEvent.click(await screen.findByRole('option', { name: /Unicycling/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Rating' }))
    await userEvent.click(screen.getByRole('option', { name: /Strong/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Based on' }))
    await userEvent.click(screen.getByRole('option', { name: 'Quick task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Endorse skill' }))
    await screen.findByText('Skill endorsed!')
    await waitFor(() =>
      expect(document.getElementById('endorsements')).toHaveTextContent(
        'Unicycling: strong · by Ann Admin',
      ),
    )
    expect(
      await prisma.skillEndorsement.findFirst({
        where: { volunteerId: vol.id, skillId: other.id },
      }),
    ).toMatchObject({ source: 'quick_task' })
  })

  it('shows the empty states, a missing volunteer, and reports failures', async () => {
    const admin = await createAdmin()
    const vol = await createVolunteer({
      name: 'Sparse Vol',
      consentMakeProfileVisibleInDirectory: true,
    })
    const note = await prisma.adminNote.create({
      data: { volunteerId: vol.id, authorId: admin.id, content: 'Doomed note' },
    })
    await mount(vol.id, admin)
    await screen.findByRole('heading', { name: 'Sparse Vol' })
    expect(screen.queryByText('Profile hidden')).toBeNull()
    expect(screen.getByText('No skills listed.')).toBeInTheDocument()
    expect(screen.getByText('No endorsements yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(await prisma.adminNote.count({ where: { id: note.id } })).toBe(1)
    await userEvent.click(screen.getByRole('tab', { name: 'Quick tasks' }))
    expect(screen.getByText('No quick tasks assigned yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Project history' }))
    expect(screen.getByText('No project history.')).toBeInTheDocument()

    // Failures: the note vanishes underneath the edit; the endorsement lacks a skill.
    await userEvent.click(screen.getByRole('tab', { name: 'Admin notes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await prisma.adminNote.delete({ where: { id: note.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Note not found')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete note' }),
    )
    await screen.findAllByText('Note not found')
    await userEvent.click(screen.getByRole('tab', { name: 'Endorse skill' }))
    await userEvent.click(screen.getByRole('button', { name: 'Endorse skill' }))
    await screen.findByText(/Input validation failed|expected number/i)
    await userEvent.click(screen.getByRole('tab', { name: 'Admin notes' }))
    await userEvent.type(screen.getByLabelText('Note'), 'x')
    await prisma.adminNote.deleteMany({ where: { volunteerId: vol.id } })
    await prisma.volunteer.delete({ where: { id: vol.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await screen.findByText('Volunteer not found')

    cleanup()
    await mount(999_999, admin)
    await screen.findByText('Volunteer not found.')
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/volunteers')
  })
})
