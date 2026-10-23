import { P } from '@/components/Text'
import WorkRow, { type WorkRowParts } from '@/components/WorkRow'
import { DndContext, closestCenter, type DragEndEvent, type useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TaskStatus } from '@/generated/prisma/enums'
import type { InferRouterOutputs } from '@orpc/server'
import type { AppRouter } from '@/server/router'
import { matchesTaskFilter, tasksByStatus, type TaskFilter } from '@/lib/task-list-order'

/** The tasks a project's task list renders: `projects.getById`'s task shape. */
export type ProjectTask = InferRouterOutputs<AppRouter>['projects']['getById']['tasks'][number]

export type TaskRowParts = WorkRowParts

/** A task any volunteer may ask to take: not started, unassigned, and not already held for someone. */
export function isTaskOpenToClaim(task: ProjectTask): boolean {
  return (
    task.status === TaskStatus.not_started &&
    task.assignedToId === null &&
    task.requestedById === null
  )
}

/** A task row in "Your order", with a handle to drag it to a new place. */
function SortableTaskItem({ task, ...parts }: TaskRowParts & { task: ProjectTask }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })
  return (
    <WorkRow
      {...parts}
      rowRef={setNodeRef}
      style={{
        // dynamic: drag transform/transition/opacity
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      handle={
        <span
          {...attributes}
          {...listeners}
          className="w-4 shrink-0 leading-none text-text-light text-center text-base mt-1 cursor-grab"
          title="Drag to reorder"
          aria-label={`Drag to reorder ${task.title}`}
        >
          ⠿
        </span>
      }
    />
  )
}

/**
 * A project's task list, grouped by what can happen next (`tasksByStatus`) with done tasks
 * folded under "Done (N)"; under a `filter` it is only the matching tasks, in the same order
 * and unfolded; in `yourOrder` it is the manual order, which a manager drags to change. Used
 * both on the Tasks tab and inside the task picker a volunteer joins through.
 */
export function TaskList({
  tasks,
  yourOrder,
  filter,
  sensors,
  onDragEnd,
  rowParts,
}: {
  tasks: ProjectTask[]
  yourOrder: boolean
  filter: TaskFilter | null
  sensors: ReturnType<typeof useSensors>
  onDragEnd: (event: DragEndEvent) => void
  rowParts: (task: ProjectTask) => TaskRowParts
}) {
  const list = 'list-none p-0 m-0'
  if (yourOrder) {
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ul className={list}>
            {tasks.map((task) => (
              <SortableTaskItem key={task.id} task={task} {...rowParts(task)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    )
  }
  const { open, done } = tasksByStatus(tasks)
  if (filter) {
    const shown = [...open, ...done].filter((t) => matchesTaskFilter(t, filter))
    return shown.length === 0 ? (
      <P className="text-text-light">No {filter} tasks.</P>
    ) : (
      <ul className={list}>
        {shown.map((task) => (
          <WorkRow key={task.id} {...rowParts(task)} />
        ))}
      </ul>
    )
  }
  return (
    <>
      <ul className={list}>
        {open.map((task) => (
          <WorkRow key={task.id} {...rowParts(task)} />
        ))}
      </ul>
      {done.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer py-2 text-sm font-medium text-text-light">
            Done ({done.length})
          </summary>
          <ul className={list}>
            {done.map((task) => (
              <WorkRow key={task.id} {...rowParts(task)} />
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
