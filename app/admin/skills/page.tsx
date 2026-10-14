'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'

interface Skill {
  id: number
  name: string
  description: string | null
  sortOrder: number
  categoryId: number
}

interface Category {
  id: number
  name: string
  description: string | null
  sortOrder: number
  skills: Skill[]
}

type ModalType =
  | { type: 'add-category' }
  | { type: 'edit-category'; category: Category }
  | { type: 'add-skill'; categoryId: number; categoryName: string }
  | { type: 'edit-skill'; skill: Skill }
  | { type: 'delete-category'; id: number; name: string }
  | { type: 'delete-skill'; id: number; name: string }

function SortableSkill({
  skill,
  onEdit,
  onDelete,
}: {
  skill: Skill
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: skill.id,
  })
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      className="skill-item bg-brand-bg rounded-lg px-4 py-3 flex items-start gap-2"
      style={{
        // dynamic: drag transform/transition/opacity
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-text-light shrink-0 mt-0.5 leading-none"
        title="Drag to reorder"
      >
        ⠿
      </span>
      <div className="flex-1 min-w-0">
        <h4 role="heading" className="mb-1 text-base font-bold">
          {skill.name}
        </h4>
        {skill.description && <p className="m-0 text-sm text-text-light">{skill.description}</p>}
      </div>
      <div className="flex gap-1 shrink-0">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          Del
        </Button>
      </div>
    </div>
  )
}

function SortableCategory({
  cat,
  onEdit,
  onDelete,
  onAddSkill,
  onEditSkill,
  onDeleteSkill,
  onSkillsReorder,
  onSkillsDragSave,
}: {
  cat: Category
  onEdit: () => void
  onDelete: () => void
  onAddSkill: () => void
  onEditSkill: (skill: Skill) => void
  onDeleteSkill: (skill: Skill) => void
  onSkillsReorder: (categoryId: number, newSkills: Skill[]) => void
  onSkillsDragSave: (reordered: Skill[]) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cat.id,
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleSkillDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = cat.skills.findIndex((s) => s.id === active.id)
    const newIndex = cat.skills.findIndex((s) => s.id === over.id)
    const reordered = arrayMove(cat.skills, oldIndex, newIndex)
    onSkillsReorder(cat.id, reordered)
    onSkillsDragSave(reordered)
  }

  return (
    <div
      ref={setNodeRef}
      className={`category-card ${SECTION_CARD} overflow-hidden wrap-break-word mb-6`}
      style={{
        // dynamic: drag transform/transition/opacity
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-start gap-2">
          <span
            {...attributes}
            {...listeners}
            className="cursor-grab text-text-light shrink-0 mt-1 leading-none text-xl"
            title="Drag to reorder"
          >
            ⠿
          </span>
          <div>
            <h3 role="heading">{cat.name}</h3>
            {cat.description && <p className="text-text-light text-sm mt-1">{cat.description}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSkillDragEnd}
      >
        <SortableContext items={cat.skills.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {cat.skills.map((skill) => (
              <SortableSkill
                key={skill.id}
                skill={skill}
                onEdit={() => onEditSkill(skill)}
                onDelete={() => onDeleteSkill(skill)}
              />
            ))}
            <button
              onClick={onAddSkill}
              className="border-2 border-dashed border-brand-border bg-transparent rounded-lg px-4 py-3 text-text-light cursor-pointer text-center hover:border-primary hover:text-primary hover:bg-accent transition-all"
            >
              + Add skill
            </button>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

export default function AdminSkillsPage() {
  const { user, loading } = useRequireAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [modal, setModal] = useState<ModalType | null>(null)
  const [inputName, setInputName] = useState('')
  const [inputDescription, setInputDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const { data: skillsListData } = useQuery({
    ...orpc.skills.list.queryOptions({ input: {} }),
    enabled: !!user?.isAdmin,
  })

  const invalidateSkillData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.skills.list.key() })
  }, [queryClient])

  useEffect(() => {
    if (!skillsListData) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategories(skillsListData as unknown as Category[])
    setLoadingData(false)
  }, [skillsListData])

  const reorderCategoriesMutation = useMutation({
    ...orpc.admin.skillCategories.reorder.mutationOptions(),
  })
  const reorderSkillsMutation = useMutation({ ...orpc.admin.skills.reorder.mutationOptions() })
  const createCategoryMutation = useMutation({
    ...orpc.admin.skillCategories.create.mutationOptions(),
  })
  const updateCategoryMutation = useMutation({
    ...orpc.admin.skillCategories.update.mutationOptions(),
  })
  const createSkillMutation = useMutation({ ...orpc.admin.skills.create.mutationOptions() })
  const updateSkillMutation = useMutation({ ...orpc.admin.skills.update.mutationOptions() })
  const deleteCategoryMutation = useMutation({
    ...orpc.admin.skillCategories.delete.mutationOptions(),
  })
  const deleteSkillMutation = useMutation({ ...orpc.admin.skills.delete.mutationOptions() })

  function openModal(m: ModalType) {
    setModal(m)
    setInputName(
      m.type === 'edit-skill' ? m.skill.name : m.type === 'edit-category' ? m.category.name : '',
    )
    setInputDescription(
      m.type === 'edit-skill'
        ? (m.skill.description ?? '')
        : m.type === 'edit-category'
          ? (m.category.description ?? '')
          : '',
    )
  }

  function closeModal() {
    setModal(null)
    setInputName('')
    setInputDescription('')
  }

  function handleCategoryDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = categories.findIndex((c) => c.id === active.id)
    const newIndex = categories.findIndex((c) => c.id === over.id)
    const reordered = arrayMove(categories, oldIndex, newIndex)
    setCategories(reordered)
    reorderCategoriesMutation.mutate(reordered.map((c, i) => ({ id: c.id, sortOrder: i + 1 })))
  }

  function handleSkillsReorder(categoryId: number, newSkills: Skill[]) {
    setCategories((cats) =>
      cats.map((c) => (c.id === categoryId ? { ...c, skills: newSkills } : c)),
    )
  }

  async function handleSaveCategory(
    e: React.FormEvent,
    modal: Extract<ModalType, { type: 'add-category' | 'edit-category' }>,
  ) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const body = { name: inputName.trim(), description: inputDescription.trim() || null }
      if (modal.type === 'edit-category') {
        await updateCategoryMutation.mutateAsync({ id: modal.category.id, ...body })
        showToast('Category updated!', 'success')
      } else {
        await createCategoryMutation.mutateAsync(body)
        showToast('Category created!', 'success')
      }
      closeModal()
      await invalidateSkillData()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save category', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveSkill(
    e: React.FormEvent,
    modal: Extract<ModalType, { type: 'add-skill' | 'edit-skill' }>,
  ) {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (modal.type === 'add-skill') {
        await createSkillMutation.mutateAsync({
          name: inputName.trim(),
          description: inputDescription.trim() || null,
          categoryId: modal.categoryId,
        })
        showToast('Skill created!', 'success')
      } else {
        await updateSkillMutation.mutateAsync({
          id: modal.skill.id,
          name: inputName.trim(),
          description: inputDescription.trim() || null,
        })
        showToast('Skill updated!', 'success')
      }
      closeModal()
      await invalidateSkillData()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save skill', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(
    modal: Extract<ModalType, { type: 'delete-category' | 'delete-skill' }>,
  ) {
    setSubmitting(true)
    try {
      if (modal.type === 'delete-category') {
        await deleteCategoryMutation.mutateAsync({ id: modal.id })
        showToast('Category deleted!', 'success')
      } else {
        await deleteSkillMutation.mutateAsync({ id: modal.id })
        showToast('Skill deleted!', 'success')
      }
      closeModal()
      await invalidateSkillData()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !user) return null

  return (
    <>
      <main className="container py-5 pb-15">
        <div className="flex justify-between items-center mb-3">
          <h1>Manage skills</h1>
          <Button onClick={() => openModal({ type: 'add-category' })}>+ Add category</Button>
        </div>

        <p className="text-text-light mb-6">
          Manage skill categories and individual skills. These are used for volunteer profiles and
          project requirements.
        </p>

        {loadingData ? (
          <div className="text-center py-10 text-text-light">Loading…</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleCategoryDragEnd}
          >
            <SortableContext
              items={categories.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {/* [test hook] category-card class used as test selector */}
              {categories.map((cat) => (
                <SortableCategory
                  key={cat.id}
                  cat={cat}
                  onEdit={() => openModal({ type: 'edit-category', category: cat })}
                  onDelete={() =>
                    openModal({ type: 'delete-category', id: cat.id, name: cat.name })
                  }
                  onAddSkill={() =>
                    openModal({ type: 'add-skill', categoryId: cat.id, categoryName: cat.name })
                  }
                  onEditSkill={(skill) => openModal({ type: 'edit-skill', skill })}
                  onDeleteSkill={(skill) =>
                    openModal({ type: 'delete-skill', id: skill.id, name: skill.name })
                  }
                  onSkillsReorder={handleSkillsReorder}
                  onSkillsDragSave={(reordered) =>
                    reorderSkillsMutation.mutate(
                      reordered.map((s, i) => ({ id: s.id, sortOrder: i + 1 })),
                    )
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </main>

      {/* Add/Edit Category Modal */}
      {(modal?.type === 'add-category' || modal?.type === 'edit-category') && (
        <div
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="bg-surface rounded-xl shadow-lg max-w-125 w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 role="heading">
                {modal.type === 'edit-category' ? 'Edit category' : 'Add category'}
              </h2>
            </div>
            <div className="p-6">
              <form onSubmit={(e) => handleSaveCategory(e, modal)}>
                <div className="mb-5">
                  <label htmlFor="cat-name">Category Name</label>
                  <input
                    id="cat-name"
                    aria-label="Category Name"
                    type="text"
                    value={inputName}
                    onChange={(e) => setInputName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="mb-5">
                  <label htmlFor="cat-description">Description</label>
                  <textarea
                    id="cat-description"
                    aria-label="Description"
                    value={inputDescription}
                    onChange={(e) => setInputDescription(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="px-0 py-4 border-t border-brand-border flex gap-3 justify-end">
                  <Button type="button" variant="secondary" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    Save category
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Skill Modal */}
      {(modal?.type === 'add-skill' || modal?.type === 'edit-skill') && (
        <div
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="bg-surface rounded-xl shadow-lg max-w-125 w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 role="heading">{modal.type === 'add-skill' ? 'Add skill' : 'Edit skill'}</h2>
            </div>
            <div className="p-6">
              {modal.type === 'add-skill' && (
                <p className="text-text-light mb-4">Category: {modal.categoryName}</p>
              )}
              <form onSubmit={(e) => handleSaveSkill(e, modal)}>
                <div className="mb-5">
                  <label htmlFor="skill-name">Skill Name</label>
                  <input
                    id="skill-name"
                    aria-label="Skill Name"
                    type="text"
                    value={inputName}
                    onChange={(e) => setInputName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="mb-5">
                  <label htmlFor="skill-description">Description</label>
                  <textarea
                    id="skill-description"
                    aria-label="Description"
                    value={inputDescription}
                    onChange={(e) => setInputDescription(e.target.value)}
                    placeholder="What does this skill involve?"
                    rows={3}
                  />
                </div>
                <div className="px-0 py-4 border-t border-brand-border flex gap-3 justify-end">
                  <Button type="button" variant="secondary" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    Save skill
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {(modal?.type === 'delete-category' || modal?.type === 'delete-skill') && (
        <div
          id="deleteModal"
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="bg-surface rounded-xl shadow-lg max-w-125 w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 role="heading">Confirm delete</h2>
            </div>
            <div className="p-6">
              <p className="text-text-light mb-6">
                Delete &ldquo;{modal.name}&rdquo;? This cannot be undone.
              </p>
              <div className="px-0 py-4 border-t border-brand-border flex gap-3 justify-end">
                <Button type="button" variant="secondary" onClick={closeModal}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => handleDelete(modal)}
                  disabled={submitting}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
