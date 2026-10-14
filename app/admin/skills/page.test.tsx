import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEndEvent } from '@dnd-kit/core'
import { prisma } from '@/lib/prisma'
import { createAdmin, createSkill } from '@/test/factories'
import { renderApp } from '@/test/render'
import AdminSkillsPage from './page'

const drags = await vi.hoisted(() => import('@/test/dnd').then((m) => m.captureDrags()))
vi.mock('@dnd-kit/core', (importOriginal) => drags.mockDndKit(importOriginal))

const drag = (handler: (e: DragEndEvent) => void, activeId: number | null, overId: number | null) =>
  act(() =>
    handler({
      active: { id: activeId },
      over: overId === null ? null : { id: overId },
    } as unknown as DragEndEvent),
  )

describe('admin skills', () => {
  it('creates, edits, reorders and deletes categories and skills', async () => {
    const admin = await createAdmin()
    const catA = await prisma.skillCategory.create({
      data: { name: 'Zeta Cat', description: 'Last things', sortOrder: 90 },
    })
    const catB = await prisma.skillCategory.create({ data: { name: 'Zulu Cat', sortOrder: 91 } })
    const s1 = await createSkill({
      name: 'Zeta One',
      categoryId: catA.id,
      description: 'first',
      sortOrder: 1,
    })
    const s2 = await createSkill({ name: 'Zeta Two', categoryId: catA.id, sortOrder: 2 })
    await renderApp(<AdminSkillsPage />, { as: admin })
    const catCard = (name: string) =>
      screen.getByRole('heading', { name }).closest<HTMLElement>('.category-card')!
    await screen.findByRole('heading', { name: 'Zeta Cat' })
    // Seeded categories mount before ours; the skill contexts follow the outer one in that order.
    const zetaContext =
      1 +
      [...document.querySelectorAll('.category-card h3')].findIndex(
        (h) => h.textContent === 'Zeta Cat',
      )
    expect(catCard('Zeta Cat')).toHaveTextContent('Last things')
    expect(
      within(catCard('Zeta Cat'))
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual([expect.stringContaining('Zeta Onefirst'), expect.stringContaining('Zeta Two')])

    // Category: add (backdrop click cancels first), edit, and reorder by drag.
    await userEvent.click(screen.getByRole('button', { name: '+ Add Category' }))
    await userEvent.click(screen.getByRole('heading', { name: 'Add Category' }).closest('.fixed')!)
    expect(screen.queryByRole('heading', { name: 'Add Category' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '+ Add Category' }))
    await userEvent.type(screen.getByLabelText('Category Name'), 'Zany Cat')
    await userEvent.type(screen.getByLabelText('Description'), 'Brand new')
    await userEvent.click(screen.getByRole('button', { name: 'Save Category' }))
    await screen.findByText('Category created!')
    await screen.findByRole('heading', { name: 'Zany Cat' })
    await userEvent.click(within(catCard('Zulu Cat')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Category Name')).toHaveValue('Zulu Cat')
    await userEvent.type(screen.getByLabelText('Category Name'), ' Renamed')
    await userEvent.click(screen.getByRole('button', { name: 'Save Category' }))
    await screen.findByText('Category updated!')
    await screen.findByRole('heading', { name: 'Zulu Cat Renamed' })
    drag(drags.at(0), catB.id, catA.id)
    await waitFor(async () =>
      expect(
        Number(
          (await prisma.skillCategory.findUniqueOrThrow({ where: { id: catB.id } })).sortOrder,
        ),
      ).toBeLessThan(
        Number(
          (await prisma.skillCategory.findUniqueOrThrow({ where: { id: catA.id } })).sortOrder,
        ),
      ),
    )
    drag(drags.at(0), catB.id, catB.id)
    drag(drags.at(0), catB.id, null)
    await userEvent.click(within(catCard('Zany Cat')).getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(catCard('Zany Cat')).getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(document.getElementById('deleteModal')!).getByRole('button', { name: 'Delete' }),
    )
    await screen.findByText('Category deleted!')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Zany Cat' })).toBeNull())

    // Skill: add, edit, reorder by drag, delete.
    await userEvent.click(within(catCard('Zeta Cat')).getByRole('button', { name: '+ Add Skill' }))
    expect(screen.getByText('Category: Zeta Cat')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('heading', { name: 'Add Skill' }).closest('.fixed')!)
    expect(screen.queryByRole('heading', { name: 'Add Skill' })).toBeNull()
    await userEvent.click(within(catCard('Zeta Cat')).getByRole('button', { name: '+ Add Skill' }))
    await userEvent.type(screen.getByLabelText('Skill Name'), 'Zeta Three')
    await userEvent.click(screen.getByRole('button', { name: 'Save Skill' }))
    await screen.findByText('Skill created!')
    await screen.findByRole('heading', { name: 'Zeta Three' })
    await userEvent.click(
      within(
        screen.getByRole('heading', { name: 'Zeta One' }).closest<HTMLElement>('.skill-item')!,
      ).getByRole('button', { name: 'Edit' }),
    )
    expect(screen.getByLabelText('Description')).toHaveValue('first')
    await userEvent.clear(screen.getByLabelText('Description'))
    await userEvent.type(screen.getByLabelText('Skill Name'), ' Edited')
    await userEvent.click(screen.getByRole('button', { name: 'Save Skill' }))
    await screen.findByText('Skill updated!')
    await screen.findByRole('heading', { name: 'Zeta One Edited' })
    expect((await prisma.skill.findUniqueOrThrow({ where: { id: s1.id } })).description).toBeNull()
    drag(drags.at(zetaContext), s2.id, s2.id)
    drag(drags.at(zetaContext), s2.id, null)
    drag(drags.at(zetaContext), s2.id, s1.id)
    await waitFor(async () =>
      expect(
        Number((await prisma.skill.findUniqueOrThrow({ where: { id: s2.id } })).sortOrder),
      ).toBeLessThan(
        Number((await prisma.skill.findUniqueOrThrow({ where: { id: s1.id } })).sortOrder),
      ),
    )
    await userEvent.click(
      within(
        screen.getByRole('heading', { name: 'Zeta Two' }).closest<HTMLElement>('.skill-item')!,
      ).getByRole('button', { name: 'Del' }),
    )
    expect(screen.getByText('Delete “Zeta Two”? This cannot be undone.')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('heading', { name: 'Confirm delete' }).closest('.fixed')!,
    )
    await userEvent.click(
      within(
        screen.getByRole('heading', { name: 'Zeta Two' }).closest<HTMLElement>('.skill-item')!,
      ).getByRole('button', { name: 'Del' }),
    )
    await userEvent.click(
      within(document.getElementById('deleteModal')!).getByRole('button', { name: 'Delete' }),
    )
    await screen.findByText('Skill deleted!')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Zeta Two' })).toBeNull())

    // Failure paths once the rows are gone underneath.
    await prisma.skill.delete({ where: { id: s1.id } })
    await userEvent.click(
      within(
        screen
          .getByRole('heading', { name: 'Zeta One Edited' })
          .closest<HTMLElement>('.skill-item')!,
      ).getByRole('button', { name: 'Edit' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Skill' }))
    await screen.findByText('Skill not found')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(
      within(
        screen
          .getByRole('heading', { name: 'Zeta One Edited' })
          .closest<HTMLElement>('.skill-item')!,
      ).getByRole('button', { name: 'Del' }),
    )
    await userEvent.click(
      within(document.getElementById('deleteModal')!).getByRole('button', { name: 'Delete' }),
    )
    await screen.findAllByText('Skill not found')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await prisma.skillCategory.delete({ where: { id: catB.id } })
    await userEvent.click(within(catCard('Zulu Cat Renamed')).getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save Category' }))
    // The earlier "Skill not found" toasts are still up, so wait for this one by name.
    await screen.findByText('Category not found')
  }, 120_000)
})
