import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createAdmin } from '@/test/factories'
import { renderApp } from '@/test/render'
import { navigation } from '@/test/next-navigation'
import NewTemplatePage from './page'

describe('new template', () => {
  it('builds tasks with dependencies and creates the template', async () => {
    const admin = await createAdmin()
    await renderApp(<NewTemplatePage />, { as: admin, url: '/templates/new' })
    const create = await screen.findByRole('button', { name: 'Create template' })
    expect(create).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    await userEvent.type(screen.getByLabelText('Template title'), ' Door knocking ')
    await userEvent.type(screen.getByLabelText('Description'), ' Canvass a ward ')
    expect(create).toBeEnabled()

    await userEvent.type(screen.getByRole('textbox', { name: 'Task 1' }), 'Print leaflets')
    await userEvent.type(screen.getAllByPlaceholderText('Description (optional)')[0], 'A5')
    await userEvent.type(screen.getAllByPlaceholderText('Days after project start')[0], '2')
    await userEvent.type(screen.getAllByPlaceholderText('Duration (days)')[0], '3')
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Task 2' }), 'Knock doors')
    // Untitled tasks are named by position in the dependency list.
    const task2 = within(
      screen.getByRole('textbox', { name: 'Task 2' }).closest<HTMLElement>('.rounded-lg')!,
    )
    expect(task2.getAllByRole('checkbox').map((c) => c.parentElement?.textContent)).toEqual([
      'Print leaflets',
      'Task 3',
    ])
    await userEvent.click(task2.getByRole('checkbox', { name: 'Print leaflets' }))
    await userEvent.click(task2.getByRole('checkbox', { name: 'Task 3' }))
    await userEvent.click(task2.getByRole('checkbox', { name: 'Task 3' }))
    expect(task2.getByRole('checkbox', { name: 'Print leaflets' })).toBeChecked()
    expect(task2.getByRole('checkbox', { name: 'Task 3' })).not.toBeChecked()
    // Removing task 1 drops the dependency on it too.
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(screen.getByRole('textbox', { name: 'Task 1' })).toHaveValue('Knock doors')
    expect(screen.queryByRole('checkbox', { name: 'Print leaflets' })).toBeNull()
    expect(screen.queryByRole('checkbox', { checked: true })).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Task 2' }))

    // An untitled task is dropped from the template, so a dependency on it is refused.
    await userEvent.click(create)
    await screen.findByText(/depends on unknown ref "task-3"/)
    await userEvent.type(screen.getByRole('textbox', { name: 'Task 2' }), 'Follow up')
    await userEvent.click(create)
    await screen.findByText('Template created')
    const template = await prisma.template.findFirstOrThrow({ where: { title: 'Door knocking' } })
    expect(JSON.parse(template.structure)).toMatchObject({
      description: 'Canvass a ward',
      tasks: [
        { ref: 'task-2', title: 'Knock doors', dependsOn: [{ on: 'task-3' }] },
        { ref: 'task-3', title: 'Follow up', dependsOn: [] },
      ],
    })
    expect(navigation.push).toHaveBeenCalledWith('/templates')
  })

  it('reports a refused create', async () => {
    const admin = await createAdmin()
    await renderApp(<NewTemplatePage />, { as: admin, url: '/templates/new' })
    await userEvent.type(await screen.findByLabelText('Template title'), 'Doomed')
    localStorage.setItem('authToken', 'stale')
    await userEvent.click(screen.getByRole('button', { name: 'Create template' }))
    await screen.findByText('Unauthorized')
  })
})
