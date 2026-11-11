import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import {
  createAdmin,
  createChapter,
  createCoordinator,
  createSkill,
  createVolunteer,
} from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import { NO_ACCESS_NOTICE_URL } from '@/lib/hooks/auth'
import CoordinatePage from './page'

const card = async (title: string) =>
  (await screen.findByRole('heading', { name: title })).closest('section') as HTMLElement

describe('coordinate', () => {
  it('puts out a call to chosen chapters and skills, reads its answers and closes it', async () => {
    const chapter = await createChapter()
    const photo = await createSkill({ name: 'March photography' })
    const video = await createSkill({ name: 'Rally videography' })
    await createSkill({ name: 'Rally sound' })
    const coordinator = await createCoordinator(chapter)
    await renderApp(<CoordinatePage />, { as: coordinator })

    expect(await screen.findByText('No calls yet')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Title'), 'Photos of protests')
    await userEvent.type(screen.getByLabelText('What you are asking for'), 'Send photos')
    await userEvent.click(screen.getByRole('checkbox', { name: chapter.name }))
    await userEvent.click(screen.getByRole('checkbox', { name: chapter.name }))
    await userEvent.click(screen.getByRole('checkbox', { name: chapter.name }))
    // Keyboard only: type to filter, pick, and the field keeps focus for the next pick.
    const skills = await screen.findByRole('button', { name: 'Skills it asks for' })
    skills.focus()
    for (const [typed, picked] of [
      ['March photo', 'March photography'],
      ['Rally vid', 'Rally videography'],
      ['Rally sou', 'Rally sound'],
    ]) {
      await userEvent.keyboard('{Enter}')
      await userEvent.type(screen.getByRole('searchbox', { name: 'Skills it asks for' }), typed)
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([picked])
      await userEvent.keyboard('{ArrowDown}{Enter}')
      expect(screen.getByRole('button', { name: 'Skills it asks for' })).toHaveFocus()
    }
    const chosen = screen.getByRole('list', { name: 'Skills it asks for: chosen' })
    await userEvent.click(within(chosen).getByRole('button', { name: 'Remove Rally sound' }))
    expect(
      within(chosen)
        .getAllByRole('listitem')
        .map((li) => li.firstChild?.textContent),
    ).toEqual(['March photography', 'Rally videography'])
    await userEvent.click(screen.getByRole('button', { name: 'Skills it asks for' }))
    expect(screen.queryByRole('option', { name: 'March photography' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Send call' }))
    await screen.findByText('Your call is on its way to volunteers')

    const call = await prisma.call.findFirstOrThrow({
      where: { senderId: coordinator.id },
      include: { skills: { orderBy: { skillId: 'asc' } } },
    })
    expect(call).toMatchObject({
      chapterIds: [chapter.id],
      skills: [{ skillId: photo.id }, { skillId: video.id }],
    })
    const section = await card('Photos of protests')
    expect(
      within(section).getByText(
        new RegExp(`${chapter.name} · for March photography or Rally videography · open`),
      ),
    ).toBeTruthy()

    await userEvent.click(within(section).getByRole('button', { name: 'Answers (0)' }))
    expect(await within(section).findByText('No answers yet.')).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Hide answers' }))

    const responder = await createVolunteer({
      name: 'Rita Responder',
      nationalChapterId: chapter.id,
    })
    const pooled = await createVolunteer({ name: 'Pat Pool', email: null })
    for (const v of [responder, pooled]) {
      await prisma.callResponse.create({
        data: { callId: call.id, volunteerId: v.id, message: `From ${v.name}` },
      })
    }
    await userEvent.click(within(section).getByRole('button', { name: /Answers/ }))
    expect(await within(section).findByText('Rita Responder')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: responder.email! })).toHaveAttribute(
      'href',
      `mailto:${responder.email}`,
    )
    expect(within(section).getByText('From Pat Pool')).toBeInTheDocument()

    await userEvent.click(within(section).getByRole('button', { name: 'Close call' }))
    await screen.findByText('The call is closed to new answers')
    await waitFor(() =>
      expect(within(section).queryByRole('button', { name: 'Close call' })).not.toBeInTheDocument(),
    )
  })

  it('shows a global admin every call, with its sender, sent to every chapter', async () => {
    const coordinator = await createCoordinator(undefined, { name: 'Sam Sender' })
    await prisma.call.create({
      data: { senderId: coordinator.id, title: 'Everyone call', body: 'b' },
    })
    await renderApp(<CoordinatePage />, { as: await createAdmin() })
    expect(await screen.findByRole('heading', { name: 'All calls' })).toBeInTheDocument()
    const section = await card('Everyone call')
    expect(within(section).getByText(/Every chapter · from Sam Sender · open/)).toBeTruthy()
  })

  it('reports a refused call and a refused close', async () => {
    const coordinator = await createCoordinator()
    await prisma.call.create({ data: { senderId: coordinator.id, title: 'Gone soon', body: 'b' } })
    await renderApp(<CoordinatePage />, { as: coordinator })
    const section = await card('Gone soon')
    await prisma.call.deleteMany({ where: { title: 'Gone soon' } })
    await userEvent.click(within(section).getByRole('button', { name: 'Close call' }))
    await screen.findByText('Call not found')

    await userEvent.type(screen.getByLabelText('Title'), 'Refused')
    await userEvent.type(screen.getByLabelText('What you are asking for'), 'Body')
    await prisma.coordinator.deleteMany({ where: { volunteerId: coordinator.id } })
    await userEvent.click(screen.getByRole('button', { name: 'Send call' }))
    await screen.findByText('Forbidden')
  })

  it('turns away someone who may not send calls', async () => {
    await renderApp(<CoordinatePage />, { as: await createVolunteer() })
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(NO_ACCESS_NOTICE_URL))
  })

  it('sends the signed out to log in', async () => {
    await renderApp(<CoordinatePage />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/login'))
  })
})
