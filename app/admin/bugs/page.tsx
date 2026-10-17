'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FilterDropdown, { useFilterOptions } from '@/components/FilterDropdown'
import VolunteerSelect from '@/components/VolunteerSelect'
import Button from '@/components/Button'
import { orpc } from '@/lib/orpc'
import { formatDate } from '@/lib/format-date'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'
import { Badge } from '@/components/Badge'
import {
  BUG_STATUS_OPTIONS,
  BUG_CATEGORY_OPTIONS,
  BUG_STATUS_VARIANT,
  bugReportPagePath,
  bugStatusLabel,
} from '@/lib/bug-report-labels'
import type { InferRouterOutputs } from '@orpc/server'
import type { AppRouter } from '@/server/router'

type BugReports = InferRouterOutputs<AppRouter>['admin']['bugReports']['list']

function exportReportsAsMarkdown(reports: BugReports): void {
  const baseUrl = window.location.origin
  const lines: string[] = [
    `# Bug Reports`,
    '',
    `Exported: ${new Date().toISOString()}`,
    `Total: ${reports.length}`,
    '',
    '---',
  ]

  for (const r of reports) {
    lines.push('')
    lines.push(`## [#${r.id} — ${r.title}](${baseUrl}/bugs/${r.id})`)
    lines.push('')
    lines.push(`- **Status:** ${bugStatusLabel(r.status)}`)
    if (r.category) lines.push(`- **Category:** ${r.category}`)
    if (r.severity) lines.push(`- **Severity:** ${r.severity}`)
    if (r.reporterName) lines.push(`- **Reporter:** ${r.reporterName}`)
    if (r.assigneeName) lines.push(`- **Assignee:** ${r.assigneeName}`)
    if (r.pageUrl) lines.push(`- **Page URL:** ${bugReportPagePath(r.pageUrl) ?? r.pageUrl}`)
    if (r.createdAt) lines.push(`- **Created:** ${formatDate(r.createdAt)}`)
    lines.push('')
    lines.push('**Description:**')
    lines.push('')
    lines.push(r.description)
    if (r.resolutionNotes) {
      lines.push('')
      lines.push('**Resolution notes:**')
      lines.push('')
      lines.push(r.resolutionNotes)
    }
    lines.push('')
    lines.push('---')
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bug-reports-${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

const CATEGORY_OPTIONS = [{ value: 'all', label: 'All' }, ...BUG_CATEGORY_OPTIONS] as const

const STATUS_SECTIONS = BUG_STATUS_OPTIONS.map((s) => ({
  status: s.value,
  label: s.label,
  collapsedByDefault: s.value === 'resolved' || s.value === 'wont_fix',
}))

export default function AdminBugsPage() {
  const { user, loading } = useRequireAdmin()
  const router = useRouter()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const { value: categoryFilter, onChange: setCategoryFilter } = useFilterOptions(
    CATEGORY_OPTIONS,
    'all',
  )

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  const listQuery = orpc.admin.bugReports.list.queryOptions({
    input: {
      category: categoryFilter !== 'all' ? categoryFilter : undefined,
    },
  })
  const { data: reports = [], isLoading: loadingData } = useQuery({
    ...listQuery,
    enabled: !!user?.isAdmin,
  })

  const [assignSelections, setAssignSelections] = useState<Record<number, string>>({})

  const updateMutation = useMutation({
    ...orpc.admin.bugReports.update.mutationOptions(),
    onSuccess: () => {
      showToast('Marked in progress', 'success')
      void queryClient.invalidateQueries({ queryKey: listQuery.queryKey })
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to update', 'error')
    },
  })

  const assignMutation = useMutation({
    ...orpc.admin.bugReports.assign.mutationOptions(),
    onSuccess: (_, variables) => {
      showToast('Bug report assigned', 'success')
      setAssignSelections((s) => {
        const next = { ...s }
        delete next[variables.id]
        return next
      })
      void queryClient.invalidateQueries({ queryKey: listQuery.queryKey })
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to assign', 'error')
    },
  })

  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <h1>Bug reports &amp; feedback</h1>

      <div className="mb-6 flex gap-4 flex-wrap items-end">
        <FilterDropdown
          id="category-filter"
          label="Type"
          ariaLabel="Filter by type"
          value={categoryFilter}
          options={CATEGORY_OPTIONS}
          onChange={setCategoryFilter}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={reports.length === 0}
          onClick={() => exportReportsAsMarkdown(reports)}
        >
          Export as Markdown
        </Button>
        <Button variant="outline" size="sm" href="/admin/api-tokens">
          Connect with MCP
        </Button>
      </div>

      {loadingData ? (
        <div className="text-center py-10 text-text-light">Loading…</div>
      ) : reports.length === 0 ? (
        <p>No bug reports found.</p>
      ) : (
        STATUS_SECTIONS.map((section) => {
          const sectionReports = reports.filter((r) => r.status === section.status)
          if (sectionReports.length === 0) return null

          const isOpen = section.collapsedByDefault ? (openSections[section.status] ?? false) : true
          const toggle = () => setOpenSections((s) => ({ ...s, [section.status]: !isOpen }))

          return (
            <div
              key={section.status}
              className="mb-8"
              data-testid={`bugs-section-${section.status}`}
            >
              {section.collapsedByDefault ? (
                <h2
                  className="text-lg mb-3 flex items-center gap-2 cursor-pointer select-none"
                  onClick={toggle}
                  role="button"
                  aria-expanded={isOpen}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && toggle()}
                >
                  {section.label}: {sectionReports.length}
                  <svg
                    className={`text-text-light shrink-0 transition-transform ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </h2>
              ) : (
                <h2 className="text-lg mb-3">
                  {section.label}: {sectionReports.length}
                </h2>
              )}
              {isOpen && (
                <div className={section.collapsedByDefault ? 'animate-fade-slide-in' : ''}>
                  {sectionReports.map((r) => (
                    <BugReportCard
                      key={r.id}
                      report={r}
                      onNavigate={() => router.push(`/bugs/${r.id}`)}
                      onMarkInProgress={() =>
                        updateMutation.mutate({ id: r.id, status: 'in_progress' })
                      }
                      markInProgressPending={updateMutation.isPending}
                      assignValue={assignSelections[r.id] ?? ''}
                      onAssignChange={(v) => setAssignSelections((s) => ({ ...s, [r.id]: v }))}
                      onAssign={() =>
                        assignMutation.mutate({
                          id: r.id,
                          volunteerId: parseInt(assignSelections[r.id]!, 10),
                        })
                      }
                      assignPending={assignMutation.isPending}
                      isAdmin={!!user?.isAdmin}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}
    </main>
  )
}

function BugReportCard({
  report: r,
  onNavigate,
  onMarkInProgress,
  markInProgressPending,
  assignValue,
  onAssignChange,
  onAssign,
  assignPending,
  isAdmin,
}: {
  report: BugReports[number]
  onNavigate: () => void
  onMarkInProgress: () => void
  markInProgressPending: boolean
  assignValue: string
  onAssignChange: (value: string) => void
  onAssign: () => void
  assignPending: boolean
  isAdmin: boolean
}) {
  return (
    // [test hook] card class used as test selector
    <div
      role="link"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onNavigate()
      }}
      className={`card block ${SECTION_CARD} mb-4 overflow-hidden wrap-break-word cursor-pointer`}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="mt-0 mx-0 mb-1">{r.title}</h3>
          <div className="text-text-light flex gap-2 flex-wrap text-[0.8rem]">
            {r.category && <span>{r.category}</span>}
            {r.severity && <span>· {r.severity}</span>}
            {r.reporterName && <span>· {r.reporterName}</span>}
            <span>· {r.createdAt ? formatDate(r.createdAt) : ''}</span>
            {r.pageUrl && <span>· {bugReportPagePath(r.pageUrl) ?? r.pageUrl}</span>}
            {r.assigneeName && <span>· Assigned to: {r.assigneeName}</span>}
          </div>
        </div>
        <Badge variant={BUG_STATUS_VARIANT[r.status] ?? 'neutral'}>
          {bugStatusLabel(r.status)}
        </Badge>
      </div>

      <p className="text-text-light mt-0 mx-0 mb-3 whitespace-pre-wrap">{r.description}</p>

      {r.resolutionNotes && (
        <p className="mt-0 mx-0 mb-3 text-sm italic">Resolution: {r.resolutionNotes}</p>
      )}

      <div
        className="flex gap-2 items-end flex-wrap pt-3 border-t border-brand-border"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {r.status === 'open' && (
          <Button
            variant="secondary"
            size="sm"
            disabled={markInProgressPending}
            onClick={onMarkInProgress}
          >
            Mark in progress
          </Button>
        )}

        <div className="flex-1 min-w-50 max-w-75">
          <VolunteerSelect
            id={`assign-bug-${r.id}`}
            label="Assign to"
            ariaLabel={`Assign volunteer to ${r.title}`}
            value={assignValue}
            onChange={onAssignChange}
            placeholder="Select volunteer…"
            enabled={isAdmin}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!assignValue || assignPending}
          onClick={onAssign}
        >
          Assign
        </Button>
      </div>
    </div>
  )
}
