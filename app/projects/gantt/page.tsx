'use client'

import { useMemo, useState } from 'react'
import ViewSwitch, { PROJECT_VIEWS } from '@/components/ViewSwitch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireConfirmed } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import Button from '@/components/Button'
import GanttChart from '@/components/gantt/GanttChart'
import type { GanttRow as GanttRowData } from '@/components/gantt/types'
import { ProjectStatus } from '@/generated/prisma/enums'
import PageLoading from '@/components/PageLoading'

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: ProjectStatus.ready, label: 'Ready' },
  { key: ProjectStatus.in_progress, label: 'In progress' },
  { key: ProjectStatus.on_hold, label: 'On hold' },
  { key: ProjectStatus.completed, label: 'Completed' },
  { key: ProjectStatus.archived, label: 'Archived' },
]
const DEFAULT_STATUSES = [ProjectStatus.ready, ProjectStatus.in_progress, ProjectStatus.on_hold]

export default function RoadmapPage() {
  const { user, loading } = useRequireConfirmed()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_STATUSES)

  const { data, isPending } = useQuery({
    ...orpc.projects.ganttOverview.queryOptions({ input: { statuses } }),
    enabled: !!user,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.projects.ganttOverview.key() })

  const reschedule = useMutation({
    ...orpc.schedule.rescheduleItems.mutationOptions(),
    onSuccess: () => void invalidate(),
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to reschedule', 'error'),
  })
  const addDep = useMutation({
    ...orpc.dependencies.add.mutationOptions(),
    onSuccess: () => {
      showToast('Projects linked', 'success')
      void invalidate()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to link projects', 'error'),
  })

  const rows: GanttRowData[] = useMemo(() => {
    if (!data) return []
    return data.projects.flatMap((p) =>
      p.placement
        ? [
            {
              id: p.id,
              label: `${p.title}${p.taskCount ? ` (${p.taskCount})` : ''}`,
              href: `/projects/${p.id}`,
              status: p.status,
              placement: p.placement,
            },
          ]
        : [],
    )
  }, [data])

  if (loading || !user) return <PageLoading />

  function toggleStatus(key: string) {
    setStatuses((cur) => (cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key]))
  }

  return (
    <main className="container-wide py-5 pb-15">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0">Projects</h1>
        <Button href="/suggest">Propose a project</Button>
      </div>
      <ViewSwitch label="Project views" views={PROJECT_VIEWS} current="/projects/gantt" />
      <p className="text-text-light mb-4">
        Each bar is a project, placed by its planned dates; the number after a name is how many
        tasks it has. Click a bar for details.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-text-light text-sm">Show</span>
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={statuses.includes(f.key) ? 'primary' : 'secondary'}
            onClick={() => toggleStatus(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {isPending ? (
        <p className="text-text-light">Loading timeline…</p>
      ) : rows.length === 0 ? (
        <p className="text-text-light">
          No projects with a schedule match these filters. Give a project a start date or dated
          tasks to see it here.
        </p>
      ) : (
        <GanttChart
          rows={rows}
          edges={data!.dependencies}
          rangeStart={new Date(data!.scopeStart)}
          rangeEnd={new Date(data!.scopeEnd)}
          // The server lets only a project's manager move it; across the whole roadmap that
          // is reliably true only for admins.
          editable={Boolean(user.isAdmin)}
          onReschedule={(patch) =>
            reschedule.mutate({
              items: [
                {
                  id: patch.id,
                  startDate: patch.startDate,
                  ...(patch.durationDays !== undefined ? { durationDays: patch.durationDays } : {}),
                },
              ],
            })
          }
          onLink={(predecessorId, successorId) =>
            addDep.mutate({ predecessorId, successorId, lagDays: 0 })
          }
        />
      )}

      <p className="text-text-light mt-2 text-xs">
        Each bar spans a project&apos;s tasks (or its set duration).
        {user.isAdmin && (
          <>
            {' '}
            Drag to shift a project; drag the dot onto another project to say &ldquo;this one comes
            after that one&rdquo;.
          </>
        )}
      </p>
    </main>
  )
}
