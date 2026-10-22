'use client'

import Checkbox from '@/components/Checkbox'
import { H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import type { InferRouterOutputs } from '@orpc/server'
import type { AppRouter } from '@/server/router'

export type ImportDiff = InferRouterOutputs<AppRouter>['projects']['previewImport']
type TaskEntry = ImportDiff['tasks'][number]
type DependencyEntry = ImportDiff['dependencies'][number]

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (v === true) return 'yes'
  if (v === false) return 'no'
  return String(v)
}

function entityLabel(e: { id?: number; ref?: string; title: string }): string {
  if (e.ref) return `${e.title} (${e.ref})`
  return e.title
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="mb-5">
      <H3 className="mb-2 text-base font-bold">
        {title} <span className="text-text-light font-normal">({count})</span>
      </H3>
      {children}
    </div>
  )
}

export default function ProjectImportDiff({
  diff,
  confirmedDeleteIds,
  onToggleDelete,
}: {
  diff: ImportDiff
  confirmedDeleteIds: Set<number>
  onToggleDelete: (id: number) => void
}) {
  const creates = diff.tasks.filter((t): t is TaskEntry => t.op === 'create')
  const updates = diff.tasks.filter((t): t is TaskEntry => t.op === 'update')
  const deletes = diff.tasks.filter((t): t is TaskEntry => t.op === 'delete')
  const depChanges = diff.dependencies.filter((d): d is DependencyEntry => d.op !== 'noop')
  const projectChanged = diff.project.op === 'update'

  const nothing =
    diff.errors.length === 0 &&
    !projectChanged &&
    creates.length === 0 &&
    updates.length === 0 &&
    deletes.length === 0 &&
    depChanges.length === 0

  return (
    <div>
      {diff.errors.length > 0 && (
        <div className="mb-5 rounded-lg border border-error bg-error/10 p-4">
          <H3 className="mb-2 text-base font-bold text-error">
            This file cannot be imported ({diff.errors.length})
          </H3>
          <ul className="list-disc pl-5 text-sm">
            {diff.errors.map((e, i) => (
              <li key={i}>
                {e.ref ? <span className="font-mono">{e.ref}: </span> : null}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {diff.warnings.length > 0 && (
        <div className="mb-5 rounded-lg border border-warning bg-warning/10 p-4 text-sm">
          <ul className="list-disc pl-5">
            {diff.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {nothing && (
        <P className="text-text-light">No changes — the file matches the project exactly.</P>
      )}

      {projectChanged && (
        <Section title="Project" count={1}>
          <div className="rounded-lg border border-brand-border p-3 text-sm">
            {diff.project.fieldChanges.map((c) => (
              <div key={c.field}>
                <span className="font-medium">{c.field}</span>: {fmt(c.from)} →{' '}
                <span className="font-medium">{fmt(c.to)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="New tasks" count={creates.length}>
        <ul className="space-y-2">
          {creates.map((t, i) => (
            <li key={i} className="rounded-lg border border-brand-border p-3 text-sm">
              <div className="font-medium">{entityLabel(t.identity)}</div>
              {t.fieldChanges
                .filter((c) => c.field !== 'title')
                .map((c) => (
                  <div key={c.field} className="text-text-light">
                    {c.field}: {fmt(c.to)}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Changed tasks" count={updates.length}>
        <ul className="space-y-2">
          {updates.map((t, i) => (
            <li key={i} className="rounded-lg border border-brand-border p-3 text-sm">
              <div className="font-medium">{entityLabel(t.identity)}</div>
              {t.fieldChanges.map((c) => (
                <div key={c.field}>
                  <span className="font-medium">{c.field}</span>: {fmt(c.from)} →{' '}
                  <span className="font-medium">{fmt(c.to)}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Tasks to delete" count={deletes.length}>
        <P className="mb-2 text-sm text-text-light">
          These tasks are in the project but not in the file. Tick one to delete it on import; leave
          it unticked to keep it.
        </P>
        <ul className="space-y-2">
          {deletes.map((t) => (
            <li
              key={t.identity.id}
              className="flex items-center gap-2 rounded-lg border border-error/50 p-3 text-sm"
            >
              <Checkbox
                checked={confirmedDeleteIds.has(t.identity.id!)}
                onChange={() => onToggleDelete(t.identity.id!)}
              >
                Delete <span className="font-medium">{t.identity.title}</span>
              </Checkbox>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Dependency changes" count={depChanges.length}>
        <ul className="space-y-1 text-sm">
          {depChanges.map((d, i) => (
            <li key={i} className="rounded-lg border border-brand-border p-2">
              {d.op === 'create' && (
                <>
                  Add: {entityLabel(d.predecessor)} → {entityLabel(d.successor)}
                  {d.lagDays !== 0 ? ` (${d.lagDays}-day gap after it finishes)` : ''}
                </>
              )}
              {d.op === 'delete' && (
                <>
                  Remove: {entityLabel(d.predecessor)} → {entityLabel(d.successor)}
                </>
              )}
              {d.op === 'update' && (
                <>
                  Gap after it finishes: {entityLabel(d.predecessor)} → {entityLabel(d.successor)} (
                  {fmt(d.fieldChanges?.[0]?.from)} → {fmt(d.fieldChanges?.[0]?.to)})
                </>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
