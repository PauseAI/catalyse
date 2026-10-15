'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useRequireAdmin } from '@/lib/hooks/auth'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

const card = 'bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word'

type DraftTask = {
  ref: string
  title: string
  description: string
  startOffsetDays: string
  durationDays: string
  dependsOnRefs: string[]
}

function newTask(ref: string): DraftTask {
  return {
    ref,
    title: '',
    description: '',
    startOffsetDays: '',
    durationDays: '',
    dependsOnRefs: [],
  }
}

/**
 * Builds a project template from scratch — no source project. Deliberately a lighter form than
 * ProjectEditor: templates have no status/review/assignee lifecycle, just the structure that
 * lib/template-porting.ts's buildInstantiatePlan later turns into a real draft project.
 */
export default function NewTemplatePage() {
  const { user, loading } = useRequireAdmin()
  const router = useRouter()
  const showToast = useToast()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tasks, setTasks] = useState<DraftTask[]>([newTask('task-1')])

  const createFromScratch = useMutation({
    ...orpc.templates.createFromScratch.mutationOptions(),
    onSuccess: () => {
      showToast('Template created', 'success')
      router.push('/templates')
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Could not create template', 'error'),
  })

  function updateTask(index: number, patch: Partial<DraftTask>) {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  function addTask() {
    setTasks((prev) => [...prev, newTask(`task-${prev.length + 1}`)])
  }

  function removeTask(index: number) {
    const removedRef = tasks[index].ref
    setTasks((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((t) => ({ ...t, dependsOnRefs: t.dependsOnRefs.filter((r) => r !== removedRef) })),
    )
  }

  function toggleDependsOn(index: number, ref: string) {
    setTasks((prev) =>
      prev.map((t, i) =>
        i === index
          ? {
              ...t,
              dependsOnRefs: t.dependsOnRefs.includes(ref)
                ? t.dependsOnRefs.filter((r) => r !== ref)
                : [...t.dependsOnRefs, ref],
            }
          : t,
      ),
    )
  }

  if (loading || !user) return null

  const validTasks = tasks.filter((t) => t.title.trim())
  const canSubmit = title.trim() && !createFromScratch.isPending

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1">New template</h1>
      <p className="text-text-light mb-6">
        Build a reusable project structure from scratch. Country, local group, team and assignees
        are set later, per instance, when the template is used.
      </p>

      <div className={card}>
        <label htmlFor="template-title" className="mb-1 block font-medium">
          Template title
        </label>
        <input
          id="template-title"
          className="mb-4 w-full"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label htmlFor="template-description" className="mb-1 block font-medium">
          Description
        </label>
        <textarea
          id="template-description"
          rows={3}
          className="w-full"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className={card}>
        <h2 className="mt-0 mb-3 text-base">Tasks</h2>
        {tasks.map((t, i) => (
          <div key={t.ref} className="border-brand-border mb-4 rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label htmlFor={`task-title-${i}`} className="font-medium">
                Task {i + 1}
              </label>
              {tasks.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeTask(i)}>
                  Remove
                </Button>
              )}
            </div>
            <input
              id={`task-title-${i}`}
              className="mb-2 w-full"
              placeholder="Task title"
              value={t.title}
              onChange={(e) => updateTask(i, { title: e.target.value })}
            />
            <textarea
              rows={2}
              className="mb-2 w-full"
              placeholder="Description (optional)"
              value={t.description}
              onChange={(e) => updateTask(i, { description: e.target.value })}
            />
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                className="w-full"
                placeholder="Days after project start"
                value={t.startOffsetDays}
                onChange={(e) => updateTask(i, { startOffsetDays: e.target.value })}
              />
              <input
                type="number"
                min={0}
                className="w-full"
                placeholder="Duration (days)"
                value={t.durationDays}
                onChange={(e) => updateTask(i, { durationDays: e.target.value })}
              />
            </div>
            {tasks.length > 1 && (
              <div className="mt-2">
                <p className="text-text-light mb-1 text-sm">Depends on:</p>
                <div className="flex flex-wrap gap-3">
                  {tasks
                    .filter((other) => other.ref !== t.ref)
                    .map((other) => (
                      <label key={other.ref} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={t.dependsOnRefs.includes(other.ref)}
                          onChange={() => toggleDependsOn(i, other.ref)}
                        />
                        {other.title.trim() || `Task ${tasks.indexOf(other) + 1}`}
                      </label>
                    ))}
                </div>
              </div>
            )}
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={addTask}>
          Add task
        </Button>
      </div>

      <div className="flex gap-2">
        <Button
          disabled={!canSubmit}
          onClick={() =>
            createFromScratch.mutate({
              title: title.trim(),
              template: {
                title: title.trim(),
                description: description.trim() || null,
                tasks: validTasks.map((t) => ({
                  ref: t.ref,
                  title: t.title.trim(),
                  description: t.description.trim() || null,
                  startOffsetDays: t.startOffsetDays ? parseInt(t.startOffsetDays, 10) : null,
                  durationDays: t.durationDays ? parseInt(t.durationDays, 10) : null,
                  dependsOnRefs: t.dependsOnRefs,
                })),
              },
            })
          }
        >
          {createFromScratch.isPending ? 'Creating…' : 'Create template'}
        </Button>
        <Button variant="ghost" href="/templates">
          Cancel
        </Button>
      </div>
    </div>
  )
}
