import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEndEvent } from '@dnd-kit/core'
import { prisma } from '@/lib/prisma'
import {
  createVolunteer,
  createAdmin,
  createChapter,
  createChapterDeputy,
  createChapterLead,
  createProject,
  createTask,
} from '@/test/factories'
import { navigation } from '@/test/next-navigation'
import { renderApp } from '@/test/render'
import RoadmapPage from './page'

const captured = vi.hoisted(() => ({
  onDragEnd: undefined as ((e: DragEndEvent) => void) | undefined,
}))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...original,
    DndContext: (props: React.ComponentProps<typeof original.DndContext>) => {
      captured.onDragEnd = props.onDragEnd
      return <original.DndContext {...props} />
    },
  }
})

describe('roadmap page', () => {
  it('explains an empty roadmap to a chapter lead', async () => {
    const me = await createChapterLead(await createChapter())
    await renderApp(<RoadmapPage />, { as: me })
    await screen.findByText(/No projects with a schedule/)
    expect(screen.getByText(/Each bar is a project/)).toHaveTextContent(
      'the number after a name is how many tasks it has',
    )
  })

  it('gives a one-day plan as "1 day", not "1 days"', async () => {
    const chapter = await createChapter()
    const me = await createChapterDeputy(chapter)
    await createProject({ title: 'Road one', durationDays: 1, nationalChapterId: chapter.id })
    await renderApp(<RoadmapPage />, { as: me })
    await screen.findByRole('button', { name: /^Road one:/ })
    expect(screen.getByText('Span').nextElementSibling).toHaveTextContent(/^1 day$/)
  })

  it('turns a volunteer away to the project list', async () => {
    await renderApp(<RoadmapPage />, { as: await createVolunteer() })
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/projects?notice=no-access'),
    )
    expect(screen.queryByRole('heading', { name: 'Projects' })).toBeNull()
  })

  it('draws projects as bars, toggles status filters, and links/moves projects by drag', async () => {
    const admin = await createAdmin()
    const a = await createProject({ title: 'Road A', durationDays: 3 })
    const b = await createProject({ title: 'Road B', status: 'in_progress', assigneeId: admin.id })
    await createTask(b.id, { durationDays: 2 })
    await createTask(b.id)
    const done = await createProject({ title: 'Road done', status: 'completed', durationDays: 1 })
    await renderApp(<RoadmapPage />, { as: admin })
    await screen.findByRole('button', { name: /^Road A:/ })
    expect(screen.getByText(/Each bar spans a project/)).toHaveTextContent(/Drag to shift/)
    expect(screen.getByRole('link', { name: 'Road B (2)' })).toHaveAttribute(
      'href',
      `/projects/${b.id}`,
    )
    expect(screen.queryByText(/Road done/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }))
    await screen.findByRole('link', { name: 'Road done' })
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Road done' })).toBeNull())
    void done

    act(() =>
      captured.onDragEnd?.({
        active: { data: { current: { kind: 'link', rowId: a.id } } },
        over: { data: { current: { rowId: b.id } } },
        delta: { x: 0, y: 0 },
      } as never),
    )
    await screen.findByText('Projects linked')
    expect(
      await prisma.workItemDependency.count({ where: { predecessorId: a.id, successorId: b.id } }),
    ).toBe(1)
    act(() =>
      captured.onDragEnd?.({
        active: { data: { current: { kind: 'resize-end', rowId: a.id } } },
        delta: { x: 600, y: 0 },
      } as never),
    )
    await waitFor(async () =>
      expect(
        (await prisma.workItem.findUniqueOrThrow({ where: { id: a.id } })).durationDays,
      ).toBeGreaterThan(3),
    )
    // A move on a project the caller cannot manage fails, as does a self link.
    const other = await createVolunteer()
    localStorage.setItem('authToken', await (await import('@/lib/auth')).createSession(other.id))
    act(() =>
      captured.onDragEnd?.({
        active: { data: { current: { kind: 'move', rowId: a.id } } },
        delta: { x: 600, y: 0 },
      } as never),
    )
    await screen.findByText(/cannot reschedule/)
    act(() =>
      captured.onDragEnd?.({
        active: { data: { current: { kind: 'link', rowId: b.id } } },
        over: { data: { current: { rowId: a.id } } },
        delta: { x: 0, y: 0 },
      } as never),
    )
    await screen.findByText(/loop|Only the owner/)
  })
})
