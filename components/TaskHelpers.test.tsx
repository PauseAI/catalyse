import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createProject, createTask } from '@/test/factories'
import { renderApp } from '@/test/render'
import TaskHelpers, { type TaskHelpersState } from './TaskHelpers'

async function joinProject(projectId: number, volunteerId: number) {
  await prisma.workItemInterest.create({
    data: {
      workItemId: projectId,
      volunteerId,
      interestType: 'want_to_contribute',
      status: 'accepted',
      respondedAt: new Date(),
    },
  })
}

async function setUp() {
  const owner = await createVolunteer()
  const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
  const task = await createTask(project.id, { helpersWanted: 2 })
  return { owner, project, task }
}

const baseState: TaskHelpersState = {
  helpers: [],
  helpersWanted: 2,
  canJoinAsHelper: false,
  canLeaveAsHelper: false,
  canRemoveHelpers: true,
  canAddHelpers: true,
  eligibleHelpers: [],
}

describe('TaskHelpers', () => {
  it('filters the candidate list while typing, and adds the typed-to match on Enter', async () => {
    const { owner, project, task } = await setUp()
    const ada = await createVolunteer({ name: 'Ada Lovelace' })
    const grace = await createVolunteer({ name: 'Grace Hopper' })
    await joinProject(project.id, ada.id)
    await joinProject(project.id, grace.id)

    await renderApp(
      <TaskHelpers
        projectId={project.id}
        taskId={task.id}
        state={{
          ...baseState,
          eligibleHelpers: [
            { id: ada.id, name: ada.name },
            { id: grace.id, name: grace.name },
          ],
        }}
      />,
      { as: owner },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Add a member as a helper' }))
    const input = screen.getByRole('searchbox', { name: 'Add a member as a helper' })
    await userEvent.type(input, 'Ada')
    expect(screen.getByRole('option', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Grace Hopper' })).toBeNull()

    await userEvent.keyboard('{ArrowDown}{Enter}')

    await screen.findByText('Ada Lovelace is now helping on this task')
    const interest = await prisma.workItemInterest.findFirstOrThrow({
      where: { workItemId: task.id, volunteerId: ada.id },
    })
    expect(interest.status).toBe('accepted')
  })

  it('adds a candidate by clicking a result, with no separate submit button', async () => {
    const { owner, project, task } = await setUp()
    const grace = await createVolunteer({ name: 'Grace Hopper' })
    await joinProject(project.id, grace.id)

    await renderApp(
      <TaskHelpers
        projectId={project.id}
        taskId={task.id}
        state={{ ...baseState, eligibleHelpers: [{ id: grace.id, name: grace.name }] }}
      />,
      { as: owner },
    )

    expect(screen.queryByRole('button', { name: 'Add helper' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Add a member as a helper' }))
    await userEvent.click(screen.getByRole('option', { name: 'Grace Hopper' }))

    await screen.findByText('Grace Hopper is now helping on this task')
    const interest = await prisma.workItemInterest.findFirstOrThrow({
      where: { workItemId: task.id, volunteerId: grace.id },
    })
    expect(interest.status).toBe('accepted')
  })

  it('renders a current helper as a chip, and removes them only after confirming', async () => {
    const { owner, project, task } = await setUp()
    const helper = await createVolunteer({ name: 'Grace Hopper' })
    const interest = await prisma.workItemInterest.create({
      data: {
        workItemId: task.id,
        volunteerId: helper.id,
        interestType: 'want_to_help_task',
        status: 'accepted',
        respondedAt: new Date(),
      },
    })

    await renderApp(
      <TaskHelpers
        projectId={project.id}
        taskId={task.id}
        state={{
          ...baseState,
          helpers: [{ interestId: interest.id, volunteerId: helper.id, name: helper.name }],
        }}
      />,
      { as: owner },
    )

    const chip = screen.getByText('Grace Hopper').closest('li')!
    expect(chip).toBeInTheDocument()
    const removeButton = within(chip).getByRole('button', { name: 'Remove Grace Hopper' })

    await userEvent.click(removeButton)
    const dialog = await screen.findByRole('dialog', { name: 'Remove Grace Hopper?' })
    // Closing without confirming leaves the helper in place.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(
      await prisma.workItemInterest.findUniqueOrThrow({ where: { id: interest.id } }),
    ).toMatchObject({ status: 'accepted' })

    await userEvent.click(removeButton)
    const dialogAgain = await screen.findByRole('dialog', { name: 'Remove Grace Hopper?' })
    await userEvent.click(within(dialogAgain).getByRole('button', { name: 'Remove' }))

    await screen.findByText('Helper removed')
    expect(
      await prisma.workItemInterest.findUniqueOrThrow({ where: { id: interest.id } }),
    ).toMatchObject({ status: 'removed' })
  })
})
