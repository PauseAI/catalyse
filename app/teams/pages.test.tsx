import { describe, it, expect } from 'vitest'
import { screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  connect,
  createVolunteer,
  createAdmin,
  createProject,
  createTeam,
  createLocalGroup,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import TeamsPage from './page'
import TeamDetailPage from './[id]/page'
import LocalGroupAdoptPage from '../local-groups/[id]/page'

const confirmLeave = async () =>
  userEvent.click(
    within(await screen.findByRole('dialog', { name: /^Leave / })).getByRole('button', {
      name: 'Leave',
    }),
  )

async function setup() {
  const me = await createVolunteer()
  const leader = await createVolunteer({ name: 'Lead Person' })
  const open = await createTeam({
    name: 'Open Team',
    description: 'Join us',
    lumaUrl: 'https://luma',
    docUrl: 'https://doc',
  })
  await prisma.teamMembership.create({
    data: { teamId: open.id, volunteerId: leader.id, role: 'leader' },
  })
  const mine = await createTeam({ name: 'My Team' })
  await prisma.teamMembership.create({ data: { teamId: mine.id, volunteerId: me.id } })
  const led = await createTeam({ name: 'Led Team' })
  await prisma.teamMembership.create({
    data: { teamId: led.id, volunteerId: me.id, role: 'leader' },
  })
  const pending = await createTeam({ name: 'Pending Team' })
  await prisma.teamJoinRequest.create({ data: { teamId: pending.id, volunteerId: me.id } })
  return { me, leader, open, mine, led, pending }
}

describe('teams list', () => {
  it('shows each team with the right action, and applies', async () => {
    const { me, open, mine, led } = await setup()
    await createTeam({ name: 'Failing Team' })
    await renderApp(<TeamsPage />, { as: me })
    const openCard = (await screen.findByRole('link', { name: 'Open Team' })).closest('article')!
    expect(
      screen.getByText(/Teams are groups that collaborate on a particular kind of project/),
    ).toBeInTheDocument()
    expect(openCard).toHaveTextContent('1 member · Led by Lead Person')
    expect(openCard.querySelector('a[href="https://luma"]')).toBeNull()
    const ledCard = screen.getByRole('link', { name: 'Led Team' }).closest('article')!
    expect(ledCard).toHaveTextContent('Leader')
    expect(ledCard.querySelector(`a[href="/admin/teams/${led.id}"]`)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Application Pending' })).toBeDisabled()
    await userEvent.click(within(openCard).getByRole('button', { name: 'Apply to Join' }))
    await screen.findByText(
      /Sent to the leader of .+\. You'll get a notification when they reply\./,
    )
    expect(
      await prisma.teamJoinRequest.count({ where: { teamId: open.id, volunteerId: me.id } }),
    ).toBe(1)
    // A team the viewer is in offers a way to look at it, not a second Apply.
    const mineCard = screen.getByRole('link', { name: 'My Team' }).closest('article')!
    expect(within(mineCard).getByRole('link', { name: 'View team' })).toHaveAttribute(
      'href',
      `/teams/${mine.id}`,
    )
    expect(within(mineCard).queryByRole('button', { name: /Apply to Join|Leave/ })).toBeNull()
    expect(within(openCard).queryByRole('link', { name: 'View team' })).toBeNull()
    // Failed actions are reported.
    localStorage.setItem('authToken', 'stale')
    const failing = screen.getByRole('link', { name: 'Failing Team' }).closest('article')!
    await userEvent.click(within(failing).getByRole('button', { name: 'Apply to Join' }))
    await screen.findByText('Unauthorized')
  })

  it('renders the empty state and admin manage links', async () => {
    const admin = await createAdmin()
    await prisma.teamJoinRequest.deleteMany()
    await prisma.team.deleteMany()
    await renderApp(<TeamsPage />, { as: admin })
    await screen.findByText('No teams yet.')
    cleanup()
    await createTeam({ name: 'Admin Sees' })
    await renderApp(<TeamsPage />, { as: admin })
    await screen.findByRole('link', { name: 'Admin Sees' })
    expect(screen.getByRole('button', { name: 'Manage Members' })).toBeInTheDocument()
  })
})

describe('team detail', () => {
  it('shows a team with links for members, and each action state', async () => {
    const { me, open, mine, led, pending } = await setup()
    await renderApp(<TeamDetailPage params={Promise.resolve({ id: String(mine.id) })} />, {
      as: me,
    })
    await screen.findByRole('heading', { name: 'My Team' })
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await confirmLeave()
    await screen.findByText('Left team')
    await waitFor(
      async () =>
        expect(await screen.findByRole('button', { name: 'Apply to Join' })).toBeEnabled(),
      { timeout: 5000 },
    )
    cleanup()
    await renderApp(<TeamDetailPage params={Promise.resolve({ id: String(open.id) })} />, {
      as: me,
    })
    await screen.findByRole('heading', { name: 'Open Team' })
    expect(screen.queryByRole('link', { name: 'Meeting calendar' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Apply to Join' }))
    await screen.findByText(
      /Sent to the leader of .+\. You'll get a notification when they reply\./,
    )
    await screen.findByRole('button', { name: 'Application Pending' })
    cleanup()
    await renderApp(<TeamDetailPage params={Promise.resolve({ id: String(led.id) })} />, { as: me })
    await screen.findByRole('heading', { name: /Led Team/ })
    expect(screen.getByRole('button', { name: 'Manage Members' })).toBeInTheDocument()
    cleanup()
    await prisma.teamMembership.create({ data: { teamId: pending.id, volunteerId: me.id } })
    await prisma.team.update({
      where: { id: pending.id },
      data: { lumaUrl: 'https://luma2', docUrl: 'https://doc2' },
    })
    await renderApp(<TeamDetailPage params={Promise.resolve({ id: String(pending.id) })} />, {
      as: me,
    })
    expect(await screen.findByRole('link', { name: 'Meeting calendar' })).toHaveAttribute(
      'href',
      'https://luma2',
    )
    expect(screen.getByRole('link', { name: 'Team doc' })).toHaveAttribute('href', 'https://doc2')
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: /^Leave / })).getByRole('button', {
        name: 'Cancel',
      }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await confirmLeave()
    await screen.findByText('Unauthorized')
    cleanup()
    await renderApp(<TeamDetailPage params={Promise.resolve({ id: '999999' })} />, { as: me })
    await screen.findByText(/not found/i)
  })

  it('reports a failed apply', async () => {
    const { me, open } = await setup()
    await renderApp(<TeamDetailPage params={Promise.resolve({ id: String(open.id) })} />, {
      as: me,
    })
    await screen.findByRole('heading', { name: 'Open Team' })
    await prisma.teamMembership.create({ data: { teamId: open.id, volunteerId: me.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply to Join' }))
    await screen.findByText('Already a member of this team')
  })
})

describe('local group adoption', () => {
  it('sets the group as mine, or declines; handles unknown groups', async () => {
    const me = await createVolunteer()
    const group = await createLocalGroup({ name: 'Adopt Town', country: 'UK' })
    await renderApp(<LocalGroupAdoptPage params={Promise.resolve({ id: String(group.id) })} />, {
      as: me,
    })
    await screen.findByText(/listed under Adopt Town/)
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Set as my local group' }))
    await screen.findByText('Local group updated!')
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/settings'))
    expect(await prisma.volunteer.findUniqueOrThrow({ where: { id: me.id } })).toMatchObject({
      localGroup: 'Adopt Town',
      country: 'UK',
    })
    cleanup()
    await renderApp(<LocalGroupAdoptPage params={Promise.resolve({ id: '999999' })} />, { as: me })
    await screen.findByText(/not found/i)
    cleanup()
    await renderApp(<LocalGroupAdoptPage params={Promise.resolve({ id: 'abc' })} />, { as: me })
    await screen.findByText(/not found/i)
  })

  it('reports a failed update', async () => {
    const me = await createVolunteer()
    const group = await createLocalGroup({ name: 'Fail Town', country: 'UK' })
    await renderApp(<LocalGroupAdoptPage params={Promise.resolve({ id: String(group.id) })} />, {
      as: me,
    })
    await screen.findByText(/listed under Fail Town/)
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(screen.getByRole('button', { name: 'Set as my local group' }))
    await screen.findByText('Unauthorized')
  })
})

describe('team detail — messaging a leader', () => {
  it('offers each leader Message or Request contact, and shows members and projects to members', async () => {
    const { me, leader, open, led } = await setup()
    await connect(me, leader)
    const hidden = await createVolunteer({
      name: 'Shy',
      consentMakeProfileVisibleInDirectory: false,
    })
    const stranger = await createVolunteer({ name: 'Stranger Lead' })
    await prisma.teamMembership.createMany({
      data: [
        { teamId: open.id, volunteerId: hidden.id, role: 'leader' },
        { teamId: open.id, volunteerId: stranger.id, role: 'leader' },
      ],
    })
    await renderApp(<TeamDetailPage params={Promise.resolve({ id: String(open.id) })} />, {
      as: me,
    })
    const leaders = await screen.findByRole('list', { name: 'Leaders' })
    const row = (name: string) => within(within(leaders).getByText(name).closest('li')!)
    await userEvent.click(row('Lead Person').getByRole('button', { name: 'Message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Message Lead Person' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(row('Shy').queryByRole('button')).toBeNull()
    await userEvent.click(row('Stranger Lead').getByRole('button', { name: 'Request contact' }))
    const ask = await screen.findByRole('dialog', { name: 'Connect with Stranger Lead' })
    const note = within(ask).getByLabelText('Why would you like to connect?')
    await userEvent.type(note, 'I run the Leeds')
    expect(within(ask).getByText('5 more characters to go')).toBeInTheDocument()
    expect(within(ask).getByRole('button', { name: 'Send request' })).toBeDisabled()
    await userEvent.type(note, ' and would like to join forces.')
    expect(within(ask).queryByText(/more characters to go/)).toBeNull()
    await userEvent.click(within(ask).getByRole('button', { name: 'Send request' }))
    await screen.findByText('Request sent. Stranger Lead will answer in their Inbox.')
    await waitFor(() => expect(row('Stranger Lead').getByText('Request sent')).toBeInTheDocument())
    // Not a member: no member list or projects.
    expect(screen.queryByRole('heading', { name: 'Members' })).toBeNull()
    cleanup()

    const teamProject = await createProject({
      title: 'Team stall',
      teamId: led.id,
      status: 'in_progress',
    })
    await renderApp(<TeamDetailPage params={Promise.resolve({ id: String(led.id) })} />, {
      as: me,
    })
    await screen.findByRole('heading', { name: /Led Team/ })
    expect(screen.queryByRole('list', { name: 'Leaders' })).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Team stall' })).toHaveAttribute(
      'href',
      `/projects/${teamProject.id}`,
    )
  })
})
