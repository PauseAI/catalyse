'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { client } from '@/lib/client'
import { useToast } from '@/lib/toast'
import {
  CSV_COLUMNS,
  OUTREACH_PATH,
  fullName,
  type JournalistStatus,
} from '@/lib/journalist-outreach'
import { formatDateTime } from '@/lib/format-date'
import Button from '@/components/Button'
import Modal from '@/components/ui/Modal'
import Toggle from '@/components/Toggle'
import { Badge, type BadgeVariant } from '@/components/Badge'
import { H1, H2, H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import { SECTION_CARD } from '@/lib/ui-classes'
import FormLabel from '@/components/FormLabel'
import Textarea from '@/components/ui/Textarea'
import TextLink from '@/components/TextLink'

type Preview = Awaited<ReturnType<typeof client.admin.journalistOutreach.previewImport>>
type Row = Awaited<ReturnType<typeof client.admin.journalistOutreach.list>>['journalists'][number]

const card = `${SECTION_CARD} mb-6 overflow-hidden wrap-break-word`
const STATUS_VARIANT: Record<JournalistStatus, BadgeVariant> = {
  available: 'neutral',
  claimed: 'info',
  contacted: 'success',
  bounced: 'danger',
}
const COLUMNS = Object.values(CSV_COLUMNS)
const REQUIRED_HEADERS = COLUMNS.filter((c) => c.required).map((c) => c.header)
const OPTIONAL_HEADERS = COLUMNS.filter((c) => !c.required).map((c) => c.header)
const FILTERS = ['all', 'available', 'claimed', 'contacted', 'bounced'] as const

export default function AdminJournalistOutreachPage() {
  const { user, loading } = useRequireAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [deleting, setDeleting] = useState<Row | null>(null)
  const cancelDelete = () => setDeleting(null)

  const listQuery = orpc.admin.journalistOutreach.list.queryOptions()
  const { data } = useQuery({ ...listQuery, enabled: !!user?.isAdmin })
  const refresh = () => queryClient.invalidateQueries({ queryKey: listQuery.queryKey })
  const onError = (err: Error) => showToast(err.message, 'error')

  const pausedQuery = orpc.admin.journalistOutreach.getPaused.queryOptions()
  const { data: pausedData } = useQuery({ ...pausedQuery, enabled: !!user?.isAdmin })
  const setPausedMutation = useMutation({
    ...orpc.admin.journalistOutreach.setPaused.mutationOptions(),
    onSuccess: (res) => {
      queryClient.setQueryData(pausedQuery.queryKey, res)
      showToast(res.paused ? 'Outreach paused' : 'Outreach resumed', 'success')
    },
    onError,
  })

  const previewMutation = useMutation({
    ...orpc.admin.journalistOutreach.previewImport.mutationOptions(),
    onSuccess: setPreview,
    onError,
  })
  const commitMutation = useMutation({
    ...orpc.admin.journalistOutreach.commitImport.mutationOptions(),
    onSuccess: (res) => {
      const parts = [`Imported ${res.created} new`]
      if (res.updated > 0) parts.push(`updated ${res.updated}`)
      showToast(parts.join(', '), 'success')
      setCsv('')
      setPreview(null)
      return refresh()
    },
    onError,
  })
  const resetMutation = useMutation({
    ...orpc.admin.journalistOutreach.reset.mutationOptions(),
    onSuccess: refresh,
    onError,
  })
  const deleteMutation = useMutation({
    ...orpc.admin.journalistOutreach.delete.mutationOptions(),
    onSuccess: () => {
      setDeleting(null)
      return refresh()
    },
    onError,
  })

  async function exportCsv() {
    const text = await client.admin.journalistOutreach.exportCsv()
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'journalist-outreach.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function loadFile(file: File) {
    setCsv(await file.text())
    setPreview(null)
  }

  if (loading || !user) return null

  const rows = (data?.journalists ?? []).filter((r) => filter === 'all' || r.status === filter)

  return (
    <main className="container py-5 pb-15">
      <H1>Journalist outreach</H1>
      <P className="text-text-light mb-6">
        Volunteers work through this list at{' '}
        <TextLink href={OUTREACH_PATH}>{OUTREACH_PATH}</TextLink>.
      </P>

      <section className={card}>
        <Toggle
          checked={pausedData?.paused ?? false}
          disabled={!pausedData || setPausedMutation.isPending}
          onChange={(e) => setPausedMutation.mutate({ paused: e.target.checked })}
        >
          Pause outreach — volunteers see a &ldquo;come back soon&rdquo; message and can&apos;t get
          a journalist to contact.
        </Toggle>
      </section>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {(
            [
              ['Available', data.totals.available],
              ['Claimed now', data.totals.claimed],
              ['Contacted', data.totals.contacted],
              ['Bounced', data.totals.bounced],
              ['Volunteers who sent', data.totals.volunteers],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-surface rounded-xl shadow p-4 text-center">
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-sm text-text-light">{label}</div>
            </div>
          ))}
        </div>
      )}

      <section className={card}>
        <H2>Import journalists</H2>
        <P className="text-sm text-text-light mb-3">
          Paste or upload CSV with a header row. Required columns:{' '}
          <code>{REQUIRED_HEADERS.join(', ')}</code>. Optional:{' '}
          <code>{OPTIONAL_HEADERS.join(', ')}</code>. Other columns are ignored. Leaning is
          Republican or Democrat (R/D also work); a row matching an email already on the list
          updates that journalist&apos;s fields instead of creating a duplicate — claim/contact
          status is never touched.
        </P>
        <FormLabel htmlFor="journalist-csv">CSV</FormLabel>
        <Textarea
          id="journalist-csv"
          rows={8}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value)
            setPreview(null)
          }}
          placeholder={`${REQUIRED_HEADERS.join(',')}\nJane,Doe,jane@example.com,Daily Planet,D`}
          className="font-mono text-sm"
        />
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <FormLabel className="text-sm">
            Or upload a file{' '}
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Upload CSV file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void loadFile(file)
              }}
            />
          </FormLabel>
          <Button
            variant="outline"
            disabled={!csv.trim() || previewMutation.isPending}
            onClick={() => previewMutation.mutate({ csv })}
          >
            Preview
          </Button>
        </div>

        {preview && (
          <div className="mt-5">
            {preview.missingColumns.length > 0 && (
              <P role="alert" className="text-error mb-3">
                Missing required column{preview.missingColumns.length === 1 ? '' : 's'}:{' '}
                {preview.missingColumns.join(', ')}
              </P>
            )}
            <H3>{preview.toCreate.length} new</H3>
            {preview.toCreate.length > 0 && (
              <ul className="text-sm mb-3">
                {preview.toCreate.map((r) => (
                  <li key={r.line}>
                    {fullName(r)} &lt;{r.email}&gt; · {r.organisation} · {r.leaning}
                  </li>
                ))}
              </ul>
            )}
            {preview.toUpdate.length > 0 && (
              <>
                <H3>{preview.toUpdate.length} to update</H3>
                <P className="text-sm text-text-light mb-2">
                  Matched by email. Only the fields below change — claim/contact status is never
                  touched by an import.
                </P>
                <ul className="text-sm mb-3">
                  {preview.toUpdate.map((u) => (
                    <li key={u.line}>
                      {u.email}:{' '}
                      {u.changes
                        .map((c) => `${c.field} "${c.from ?? ''}" → "${c.to ?? ''}"`)
                        .join(', ')}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {preview.duplicates.length > 0 && (
              <>
                <H3>{preview.duplicates.length} skipped</H3>
                <ul className="text-sm mb-3">
                  {preview.duplicates.map((d) => (
                    <li key={d.line}>
                      Line {d.line}: {d.email} ({d.reason})
                    </li>
                  ))}
                </ul>
              </>
            )}
            {preview.invalid.length > 0 && (
              <>
                <H3 className="text-error">{preview.invalid.length} invalid</H3>
                <ul className="text-sm mb-3">
                  {preview.invalid.map((i) => (
                    <li key={i.line}>
                      Line {i.line}: {i.reason} — <code>{i.raw}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Button
              disabled={
                (preview.toCreate.length === 0 && preview.toUpdate.length === 0) ||
                commitMutation.isPending
              }
              onClick={() => commitMutation.mutate({ csv })}
            >
              Import {preview.toCreate.length}
              {preview.toUpdate.length > 0 && `, update ${preview.toUpdate.length}`}
            </Button>
          </div>
        )}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <H2 className="m-0">Journalists</H2>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f}
                size="sm"
                variant="ghost"
                active={filter === f}
                onClick={() => setFilter(f)}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          </div>
        </div>
        {rows.length === 0 ? (
          <P className="text-text-light">No journalists here.</P>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th>Journalist</th>
                  <th>Leaning</th>
                  <th>Status</th>
                  <th>Who / when</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-brand-border align-top">
                    <td className="py-2">
                      <strong>{fullName(r)}</strong>
                      <div className="text-text-light">
                        {r.email} · {r.organisation}
                        {r.priorityTier !== null && ` · Tier ${r.priorityTier}`}
                      </div>
                      {r.skipCount > 0 && (
                        <div className="text-text-light">Skipped {r.skipCount}×</div>
                      )}
                    </td>
                    <td className="py-2">
                      {r.leaning[0]}
                      {r.leaningConfidence && (
                        <div className="text-text-light">{r.leaningConfidence.toLowerCase()}</div>
                      )}
                      {r.sentLeaning && r.sentLeaning !== r.leaning && (
                        <div className="text-warning-text">sent as {r.sentLeaning[0]}</div>
                      )}
                    </td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </td>
                    <td className="py-2">
                      {r.contactedAt && (
                        <>
                          {r.contactedBy ?? 'deleted participant'}
                          <div className="text-text-light">{formatDateTime(r.contactedAt)}</div>
                        </>
                      )}
                      {r.status === 'claimed' && r.claimedAt && (
                        <>
                          {r.claimedBy}
                          <div className="text-text-light">since {formatDateTime(r.claimedAt)}</div>
                        </>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {r.status !== 'available' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resetMutation.mutate({ id: r.id })}
                        >
                          Reset
                        </Button>
                      )}
                      <Button size="sm" variant="danger" onClick={() => setDeleting(r)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        id="delete-journalist"
        title="Delete journalist?"
        isOpen={deleting !== null}
        onClose={cancelDelete}
      >
        <P className="mb-4">
          Remove {deleting && fullName(deleting)} from the outreach list? Their contact history goes
          with them.
        </P>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={cancelDelete}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => deleting && deleteMutation.mutate({ id: deleting.id })}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </main>
  )
}
