import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prisma } from '@/lib/prisma'
import { createVolunteer, createProject, createTask } from '@/test/factories'
import { renderApp } from '@/test/render'
import { clientAs } from '@/test/rpc'
import { navigation } from '@/test/next-navigation'
import ProjectImportDiff, { type ImportDiff } from './ProjectImportDiff'
import ProjectPorting from './ProjectPorting'

const emptyDiff: ImportDiff = {
  meta: { projectId: 1, fileHash: null, currentHash: 'h', stale: false },
  project: { op: 'noop', fieldChanges: [] },
  tasks: [],
  dependencies: [],
  errors: [],
  warnings: [],
}

describe('ProjectImportDiff', () => {
  it('reports no changes, errors, warnings and every kind of change', async () => {
    const onToggleDelete = vi.fn()
    const { rerender } = render(
      <ProjectImportDiff
        diff={emptyDiff}
        confirmedDeleteIds={new Set()}
        onToggleDelete={onToggleDelete}
      />,
    )
    expect(screen.getByText(/No changes/)).toBeInTheDocument()
    rerender(
      <ProjectImportDiff
        diff={{
          ...emptyDiff,
          errors: [
            { scope: 'task', ref: 'x', message: 'bad ref' },
            { scope: 'file', message: 'oops' },
          ],
          warnings: ['stale'],
          project: {
            op: 'update',
            fieldChanges: [
              { field: 'title', from: 'A', to: 'B' },
              { field: 'description', from: null, to: '' },
            ],
          },
          tasks: [
            {
              op: 'create',
              identity: { ref: 'n', title: 'New' },
              fieldChanges: [
                { field: 'title', from: null, to: 'New' },
                { field: 'isAnchor', from: null, to: true },
                { field: 'featuredAsQuickTask', from: null, to: false },
              ],
            },
            {
              op: 'update',
              identity: { id: 1, title: 'Old' },
              fieldChanges: [{ field: 'status', from: 'open', to: 'completed' }],
            },
            { op: 'delete', identity: { id: 2, title: 'Gone' }, fieldChanges: [] },
            { op: 'noop', identity: { id: 3, title: 'Same' }, fieldChanges: [] },
          ],
          dependencies: [
            {
              op: 'create',
              predecessor: { id: 1, title: 'Old' },
              successor: { ref: 'n', title: 'New' },
              lagDays: 2,
            },
            {
              op: 'create',
              predecessor: { id: 1, title: 'Old' },
              successor: { id: 3, title: 'Same' },
              lagDays: 0,
            },
            {
              op: 'delete',
              predecessor: { id: 2, title: 'Gone' },
              successor: { id: 1, title: 'Old' },
              lagDays: 0,
            },
            {
              op: 'update',
              predecessor: { id: 1, title: 'Old' },
              successor: { id: 3, title: 'Same' },
              lagDays: 4,
              fieldChanges: [{ field: 'lagDays', from: 1, to: 4 }],
            },
            {
              op: 'noop',
              predecessor: { id: 1, title: 'Old' },
              successor: { id: 3, title: 'Same' },
              lagDays: 0,
            },
          ],
        }}
        confirmedDeleteIds={new Set([2])}
        onToggleDelete={onToggleDelete}
      />,
    )
    expect(screen.getByText('This file cannot be imported (2)')).toBeInTheDocument()
    expect(screen.getByText('x:')).toBeInTheDocument()
    expect(screen.getByText('stale')).toBeInTheDocument()
    expect(screen.getByText('New (n)')).toBeInTheDocument()
    expect(screen.getByText('isAnchor: yes')).toBeInTheDocument()
    expect(screen.getByText('featuredAsQuickTask: no')).toBeInTheDocument()
    expect(screen.getByText('Add: Old → New (n) (2-day gap after it finishes)')).toBeInTheDocument()
    expect(screen.getByText('Remove: Gone → Old')).toBeInTheDocument()
    expect(screen.getByText(/Gap after it finishes: Old → Same/)).toBeInTheDocument()
    const box = screen.getByRole('checkbox')
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(onToggleDelete).toHaveBeenCalledWith(2)
  })
})

describe('ProjectPorting', () => {
  async function setup() {
    const owner = await createVolunteer()
    const project = await createProject({ assigneeId: owner.id, status: 'in_progress' })
    const a = await createTask(project.id, { title: 'A' })
    const b = await createTask(project.id, { title: 'B' })
    const file = await clientAs(owner).projects.exportPlan({ projectId: project.id })
    return { owner, project, a, b, file }
  }

  it('exports as a download', async () => {
    const { owner, project } = await setup()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await renderApp(<ProjectPorting projectId={project.id} />, { as: owner })
    await waitFor(() => expect(localStorage.getItem('authToken')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Download export' }))
    expect(await screen.findByText('Project exported')).toBeInTheDocument()
    expect(click).toHaveBeenCalled()
    click.mockRestore()
    // A failing export is reported.
    await renderApp(<ProjectPorting projectId={999_999} />, { as: owner })
    await userEvent.click(screen.getAllByRole('button', { name: 'Download export' })[1])
    expect(await screen.findByText('Project not found')).toBeInTheDocument()
  })

  it('previews pasted JSON, applies with confirmed deletions, and navigates away', async () => {
    const { owner, project, a, file } = await setup()
    const edited = {
      ...file,
      project: { ...file.project, title: 'Renamed' },
      tasks: [file.tasks[0]],
    }
    await renderApp(<ProjectPorting projectId={project.id} />, { as: owner })
    const paste = screen.getByLabelText('Paste export JSON')
    expect(screen.getByRole('button', { name: 'Preview pasted JSON' })).toBeDisabled()
    fireEvent.change(paste, { target: { value: JSON.stringify(edited) } })
    await userEvent.click(screen.getByRole('button', { name: 'Preview pasted JSON' }))
    expect(await screen.findByText('Loaded from: pasted text')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Tasks to delete (1)' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(await screen.findByText('Imported: 0 created, 0 changed, 1 deleted')).toBeInTheDocument()
    expect(await prisma.workItem.count({ where: { parentId: project.id } })).toBe(1)
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: project.id } })).title).toBe(
      'Renamed',
    )
    expect(navigation.push).toHaveBeenCalledWith(`/projects/${project.id}`)
    void a
  })

  it('accepts a dropped or chosen file, blocks unchanged/erroneous files, and can discard', async () => {
    const { owner, project, file } = await setup()
    const onDone = vi.fn()
    await renderApp(<ProjectPorting projectId={project.id} onDone={onDone} />, { as: owner })
    const input = screen.getByLabelText('Export file')
    const drop = screen.getByText('Drag a project export file here').parentElement!
    fireEvent.dragOver(drop)
    expect(drop).toHaveClass('border-primary')
    fireEvent.dragLeave(drop)
    fireEvent.drop(drop, {
      dataTransfer: {
        files: [new File([JSON.stringify(file)], 'export.json', { type: 'application/json' })],
      },
    })
    expect(await screen.findByText('Loaded from: export.json')).toBeInTheDocument()
    expect(await screen.findByText(/No changes/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Confirm import' })).toHaveAttribute(
      'title',
      expect.stringContaining('Nothing to apply'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Discard this file' }))
    expect(screen.queryByText(/Loaded from/)).toBeNull()

    const broken = { ...file, project: { ...file.project, id: 12345 } }
    await userEvent.upload(
      input,
      new File([JSON.stringify(broken)], 'broken.json', { type: 'application/json' }),
    )
    expect(await screen.findByText(/cannot be imported/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm import' })).toHaveAttribute(
      'title',
      'Fix the errors in the file first',
    )
    fireEvent.drop(drop, { dataTransfer: { files: [] } })
    fireEvent.change(input, { target: { files: [] } })

    // Oversized files are refused before being read.
    const big = new File(['x'], 'big.json')
    Object.defineProperty(big, 'size', { value: 3_000_000 })
    fireEvent.drop(drop, { dataTransfer: { files: [big] } })
    expect(
      await screen.findByText('That file is too large to be a project export'),
    ).toBeInTheDocument()

    // A change applied with onDone calls it instead of navigating; a stale hash surfaces an error.
    const edited = { ...file, project: { ...file.project, title: 'Via onDone' } }
    await userEvent.click(screen.getByText('Drag a project export file here'))
    await userEvent.upload(
      input,
      new File([JSON.stringify(edited)], 'edit.json', { type: 'application/json' }),
    )
    await screen.findByRole('heading', { name: 'Project (1)' })
    await prisma.workItem.update({
      where: { id: project.id },
      data: { description: 'changed underneath' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(await screen.findByText(/changed since the preview/)).toBeInTheDocument()
    await userEvent.upload(
      input,
      new File([JSON.stringify(edited)], 'edit.json', { type: 'application/json' }),
    )
    await screen.findByRole('heading', { name: 'Project (1)' })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    // The file can be discarded behind the confirm dialog; applying then does nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Discard this file' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(onDone).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.upload(
      input,
      new File([JSON.stringify(edited)], 'edit.json', { type: 'application/json' }),
    )
    await screen.findByRole('heading', { name: 'Project (1)' })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('treats a dependency-only change as applicable', async () => {
    const { owner, project, a, b, file } = await setup()
    const edited = {
      ...file,
      tasks: [file.tasks[0], { ...file.tasks[1], dependsOn: [{ on: a.id }] }],
    }
    await renderApp(<ProjectPorting projectId={project.id} />, { as: owner })
    fireEvent.change(screen.getByLabelText('Paste export JSON'), {
      target: { value: JSON.stringify(edited) },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Preview pasted JSON' }))
    expect(
      await screen.findByRole('heading', { name: 'Dependency changes (1)' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeEnabled()
    void b
  })

  it('shows a preview error for a project it cannot reach', async () => {
    const stranger = await createVolunteer()
    const { project } = await setup()
    await renderApp(<ProjectPorting projectId={project.id} />, { as: stranger })
    await waitFor(() => expect(localStorage.getItem('authToken')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Paste export JSON'), { target: { value: '{}' } })
    await userEvent.click(screen.getByRole('button', { name: 'Preview pasted JSON' }))
    expect(await screen.findByText(/Only the project owner or an admin/)).toBeInTheDocument()
  })
})
