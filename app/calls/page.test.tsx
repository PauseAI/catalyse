import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createCoordinator, createSkill, createVolunteer } from '@/test/factories'
import { renderApp } from '@/test/render'
import CallsPage from './page'

/** A call from a fresh coordinator, addressed to everyone. */
async function postCall({
  skillIds = [],
  ...overrides
}: {
  title: string
  closedAt?: Date
  skillIds?: number[]
}) {
  const coordinator = await createCoordinator(undefined, { name: 'Caio Coordinator' })
  return prisma.call.create({
    data: {
      senderId: coordinator.id,
      body: 'Send us photos of your event.',
      skills: { create: skillIds.map((skillId) => ({ skillId })) },
      ...overrides,
    },
  })
}

const card = async (title: string) =>
  (await screen.findByRole('heading', { name: title })).closest('section') as HTMLElement

describe('calls for volunteers', () => {
  it('answers a call, updates the answer and withdraws it', async () => {
    const me = await createVolunteer({ consentMakeProfileVisibleInDirectory: false })
    const skill = await createSkill({ name: 'Filming' })
    await prisma.volunteerSkill.create({ data: { volunteerId: me.id, skillId: skill.id } })
    const call = await postCall({ title: 'Film the march', skillIds: [skill.id] })
    await renderApp(<CallsPage />, { as: me })

    const section = await card('Film the march')
    const matching = screen.getByRole('heading', { name: 'Calls that match your skills' })
    expect(matching.closest('section')).toContainElement(section)
    expect(within(section).getByText(/Caio Coordinator · Media coordinator/)).toBeInTheDocument()
    expect(within(section).getByText(/for Filming/)).toBeInTheDocument()
    expect(
      within(section).getByText(/Answering shares your name, email address/),
    ).toBeInTheDocument()

    const box = within(section).getByLabelText('Answer this call')
    await userEvent.type(box, 'I film in Leeds')
    await userEvent.click(within(section).getByRole('button', { name: 'Send answer' }))
    await screen.findByText(/the coordinator can now see your answer/)
    const answered = { callId: call.id, volunteerId: me.id }
    expect(await prisma.callResponse.findFirstOrThrow({ where: answered })).toMatchObject({
      message: 'I film in Leeds',
    })

    await userEvent.clear(await within(section).findByLabelText('Your answer'))
    await userEvent.type(within(section).getByLabelText('Your answer'), 'Leeds and York')
    await userEvent.click(within(section).getByRole('button', { name: 'Update answer' }))
    await waitFor(async () =>
      expect((await prisma.callResponse.findFirstOrThrow({ where: answered })).message).toBe(
        'Leeds and York',
      ),
    )

    await userEvent.click(within(section).getByRole('button', { name: 'Withdraw answer' }))
    await screen.findByText('Your answer is withdrawn')
    expect(await prisma.callResponse.count({ where: answered })).toBe(0)
    expect(await within(section).findByLabelText('Answer this call')).toHaveValue('')
  })

  it('shows a closed call the volunteer answered, without the form', async () => {
    const me = await createVolunteer()
    const call = await postCall({ title: 'Closed photo call' })
    await prisma.callResponse.create({
      data: { callId: call.id, volunteerId: me.id, message: 'Sent you mine' },
    })
    await prisma.call.update({ where: { id: call.id }, data: { closedAt: new Date() } })
    await prisma.call.update({ where: { id: call.id }, data: { senderId: null } })
    await renderApp(<CallsPage />, { as: me })

    const section = await card('Closed photo call')
    expect(within(section).getByText(/A coordinator/)).toBeInTheDocument()
    expect(within(section).getByText(/closed/)).toBeInTheDocument()
    expect(within(section).getByText(/You answered on .*: Sent you mine/)).toBeInTheDocument()
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('says so when there are no calls, and leaves out the other calls', async () => {
    await prisma.call.updateMany({ data: { closedAt: new Date() } })
    await renderApp(<CallsPage />, { as: await createVolunteer() })
    expect(await screen.findByText('No calls match your skills right now')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Other calls' })).not.toBeInTheDocument()
  })

  it('puts calls for a skill the volunteer lacks under other calls, labelled and answerable', async () => {
    await prisma.call.updateMany({ data: { closedAt: new Date() } })
    const me = await createVolunteer()
    const drones = await createSkill({ name: 'Drone piloting' })
    const aerial = await createSkill({ name: 'Aerial photography' })
    const call = await postCall({ title: 'Fly over the march', skillIds: [drones.id, aerial.id] })
    await renderApp(<CallsPage />, { as: me })

    const other = (await screen.findByRole('heading', { name: 'Other calls' })).closest(
      'section',
    ) as HTMLElement
    const section = await card('Fly over the march')
    expect(other).toContainElement(section)
    expect(screen.getByText('No calls match your skills right now')).toBeInTheDocument()
    expect(
      within(section).getByText('Asks for Aerial photography or Drone piloting'),
    ).toBeInTheDocument()

    await userEvent.type(within(section).getByLabelText('Answer this call'), 'I fly one')
    await userEvent.click(within(section).getByRole('button', { name: 'Send answer' }))
    await screen.findByText(/the coordinator can now see your answer/)
    expect(
      await prisma.callResponse.count({ where: { callId: call.id, volunteerId: me.id } }),
    ).toBe(1)
  })

  it('reports a refused answer and a refused withdrawal', async () => {
    const me = await createVolunteer()
    const call = await postCall({ title: 'Refused call' })
    await prisma.callResponse.create({
      data: { callId: call.id, volunteerId: me.id, message: 'Here' },
    })
    await renderApp(<CallsPage />, { as: me })
    const section = await card('Refused call')
    await prisma.call.update({ where: { id: call.id }, data: { closedAt: new Date() } })
    await userEvent.click(within(section).getByRole('button', { name: 'Update answer' }))
    await screen.findByText('This call is no longer taking answers')

    await prisma.callResponse.deleteMany({ where: { callId: call.id } })
    await userEvent.click(within(section).getByRole('button', { name: 'Withdraw answer' }))
    await screen.findByText('You have not answered this call')
  })

  it('sends nothing for an empty answer submitted with Enter', async () => {
    const me = await createVolunteer()
    await postCall({ title: 'Empty answer call' })
    await renderApp(<CallsPage />, { as: me })
    const section = await card('Empty answer call')
    const respond = vi.spyOn(prisma.callResponse, 'upsert')
    within(section).getByRole('button', { name: 'Send answer' }).closest('form')!.requestSubmit()
    expect(respond).not.toHaveBeenCalled()
    respond.mockRestore()
  })
})
