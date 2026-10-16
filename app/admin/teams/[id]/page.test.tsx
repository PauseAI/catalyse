import { describe, it, expect } from 'vitest'
import { screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createAdmin,
  createVolunteer,
  createTeam,
  createChapter,
  createChapterDeputy,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import AdminTeamDetailPage from './page'

const mount = (id: number | string, as: Awaited<ReturnType<typeof createVolunteer>>) =>
  renderApp(<AdminTeamDetailPage params={Promise.resolve({ id: String(id) })} />, { as })

describe('admin team detail', () => {
  it('edits details, reviews join requests, and manages members', async () => {
    const admin = await createAdmin()
    const member = await createVolunteer({ name: 'Molly Member' })
    const leader = await createVolunteer({ name: 'Lars Leader' })
    const asker = await createVolunteer({ name: 'Ash Asker' })
    const quiet = await createVolunteer({ name: 'Quinn Quiet' })
    const newbie = await createVolunteer({ name: 'Nina Newbie' })
    const team = await createTeam({
      name: 'Edit Team',
      description: 'Before',
      lumaUrl: 'https://luma.before',
    })
    await prisma.teamMembership.createMany({
      data: [
        { teamId: team.id, volunteerId: member.id },
        { teamId: team.id, volunteerId: leader.id, role: 'leader' },
      ],
    })
    await prisma.teamJoinRequest.create({
      data: { teamId: team.id, volunteerId: asker.id, message: 'Let me in' },
    })
    await prisma.teamJoinRequest.create({ data: { teamId: team.id, volunteerId: quiet.id } })

    await mount(team.id, admin)
    await screen.findByRole('heading', { name: 'Edit Team' })
    expect(screen.getByRole('link', { name: '← All teams' })).toHaveAttribute(
      'href',
      '/admin/teams',
    )
    expect(screen.getByLabelText('Description')).toHaveValue('Before')
    expect(screen.getByLabelText('Luma calendar URL')).toHaveValue('https://luma.before')
    await userEvent.type(screen.getByLabelText('Team name'), ' Renamed')
    await userEvent.clear(screen.getByLabelText('Description'))
    await userEvent.clear(screen.getByLabelText('Luma calendar URL'))
    await userEvent.type(screen.getByLabelText('Team doc URL'), 'https://doc.after')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Team updated')
    await screen.findByRole('heading', { name: 'Edit Team Renamed' })
    expect(await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).toMatchObject({
      description: null,
      lumaUrl: null,
      docUrl: 'https://doc.after',
    })

    // Join requests: one accepted, one declined.
    expect(screen.getByText('Let me in')).toBeInTheDocument()
    const askerRow = () => screen.getByText('Ash Asker').closest<HTMLElement>('.flex')!
    await userEvent.click(askerRow().querySelector('button')!)
    await screen.findByText('Request accepted')
    await waitFor(() => expect(screen.getAllByText('Ash Asker')).toHaveLength(1))
    expect(
      await prisma.teamMembership.count({ where: { teamId: team.id, volunteerId: asker.id } }),
    ).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await screen.findByText('Request declined')
    await waitFor(() => expect(screen.queryByText('Pending join requests')).toBeNull())

    // Members: add, promote, demote, remove.
    await userEvent.click(screen.getByRole('button', { name: 'Select volunteer to add' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Nina Newbie' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await screen.findByText('Volunteer added to team')
    await screen.findByText('Nina Newbie', { selector: 'p' })
    expect(
      await prisma.teamMembership.count({ where: { teamId: team.id, volunteerId: newbie.id } }),
    ).toBe(1)
    const row = (name: string) =>
      screen.getByText(name, { selector: 'p' }).closest<HTMLElement>('.flex')!
    await userEvent.click(row('Molly Member').querySelector('button')!)
    await screen.findByText('Promoted to leader')
    await waitFor(() => expect(row('Molly Member')).toHaveTextContent('Leader'))
    await userEvent.click(row('Lars Leader').querySelector('button')!)
    await screen.findByText('Demoted to member')
    await waitFor(() =>
      expect(within(row('Lars Leader')).queryByText('Leader', { selector: 'span' })).toBeNull(),
    )
    await userEvent.click(row('Lars Leader').querySelectorAll('button')[1])
    await screen.findByText('Member removed')
    await waitFor(() => expect(screen.queryByText('Lars Leader', { selector: 'p' })).toBeNull())

    // Delete needs confirmation.
    await userEvent.click(screen.getByRole('button', { name: 'Delete team' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(await prisma.team.count({ where: { id: team.id } })).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Delete team' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete team' }),
    )
    await screen.findByText('Team deleted')
    expect(navigation.push).toHaveBeenCalledWith('/admin/teams')
  })

  it('handles leaders, forbidden viewers, missing teams and failures', async () => {
    const leader = await createVolunteer({ name: 'Solo Leader' })
    const stranger = await createVolunteer()
    const team = await createTeam({ name: 'Led Team' })
    await prisma.teamMembership.create({
      data: { teamId: team.id, volunteerId: leader.id, role: 'leader' },
    })
    await mount(team.id, stranger)
    await screen.findByText(/Only this team's leader or an admin/)
    expect(screen.getByRole('link', { name: '← Back to teams' })).toHaveAttribute('href', '/teams')
    cleanup()
    // A missing team is missing, whoever asks.
    await mount(999_999, leader)
    await screen.findByText('Team not found.')
    cleanup()
    await mount(999_999, await createAdmin())
    await screen.findByText('Team not found.')
    cleanup()
    await mount(team.id, leader)
    await screen.findByRole('heading', { name: 'Led Team' })
    expect(screen.queryByRole('button', { name: 'Delete team' })).toBeNull()
    await prisma.teamJoinRequest.create({ data: { teamId: team.id, volunteerId: stranger.id } })
    await prisma.teamMembership.deleteMany({ where: { teamId: team.id } })
    cleanup()
    await mount(team.id, await createAdmin())
    await screen.findByText('No members yet.')
    const request = await prisma.teamJoinRequest.findFirstOrThrow({ where: { teamId: team.id } })
    await prisma.teamJoinRequest.update({ where: { id: request.id }, data: { status: 'declined' } })
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await screen.findByText('Request already reviewed')
    await userEvent.click(screen.getByRole('button', { name: 'Select volunteer to add' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Solo Leader' }))
    await prisma.volunteer.delete({ where: { id: leader.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await screen.findByText('Volunteer not found')
  })

  it('reports failed saves, role changes, removals and deletes', async () => {
    const admin = await createAdmin()
    const member = await createVolunteer({ name: 'Gone Member' })
    const team = await createTeam({ name: 'Fragile Team' })
    await prisma.teamMembership.create({ data: { teamId: team.id, volunteerId: member.id } })
    // An expired session logs the page out, so each failure gets its own mount.
    for (const name of ['Make leader', 'Remove', 'Save changes', 'Delete team']) {
      cleanup()
      localStorage.clear()
      await mount(team.id, admin)
      await screen.findByRole('heading', { name: 'Fragile Team' })
      // The token goes stale just before the request that should fail: any request made
      // earlier (while a confirm dialog opens, say) would sign the page out and unmount it.
      if (name === 'Delete team') {
        await userEvent.click(screen.getByRole('button', { name }))
        const dialog = await screen.findByRole('dialog')
        localStorage.setItem('authToken', 'stale')
        await userEvent.click(within(dialog).getByRole('button', { name: 'Delete team' }))
      } else {
        localStorage.setItem('authToken', 'stale')
        await userEvent.click(screen.getByRole('button', { name }))
      }
      await screen.findByText('Unauthorized').catch((e: Error) => {
        throw new Error(`${name}: ${e.message.slice(0, 80)}`)
      })
    }
  })
})

describe('admin team detail — chapters', () => {
  it('lets a global admin move a team to another chapter or the pool', async () => {
    const chapter = await createChapter()
    const team = await createTeam({ name: 'Movers' })
    await mount(team.id, await createAdmin())
    await screen.findByRole('heading', { name: 'Movers' })
    await userEvent.click(screen.getByRole('button', { name: 'Team chapter' }))
    await userEvent.click(await screen.findByRole('option', { name: chapter.name }))
    await screen.findByText('Movers moved')
    await waitFor(async () =>
      expect(
        (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).nationalChapterId,
      ).toBe(chapter.id),
    )
  })

  it("shows the team's staff the team, without the chapter picker", async () => {
    const chapter = await createChapter()
    const team = await createTeam({ name: 'Ours', nationalChapterId: chapter.id })
    await mount(team.id, await createChapterDeputy(chapter))
    await screen.findByRole('heading', { name: 'Ours' })
    expect(screen.queryByRole('button', { name: 'Team chapter' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete team' })).toBeInTheDocument()
  })
})
