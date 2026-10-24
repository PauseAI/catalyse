'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import AiEditingHelp from '@/components/AiEditingHelp'
import FormLabel from '@/components/FormLabel'
import { H3 } from '@/components/Heading'
import Modal from '@/components/ui/Modal'
import ProjectImportDiff from '@/components/ProjectImportDiff'
import { P } from '@/components/Text'
import Textarea from '@/components/ui/Textarea'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

/**
 * The whole round trip in one place: take the file out, learn how to edit it, put it back.
 *
 * Those three steps were previously a button that downloaded, a page that explained, and a
 * page that uploaded — so the thing you had just downloaded was two navigations away from the
 * place you needed to return it to. Rendered both as a modal from the project sidebar and as
 * the `/projects/[id]/import` page, which stays as a linkable home for the same flow.
 */
export default function ProjectPorting({
  projectId,
  onDone,
}: {
  projectId: number
  /** Called once an import has been applied — close the modal, or leave the page. */
  onDone?: () => void
}) {
  const router = useRouter()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fileText, setFileText] = useState<string | null>(null)
  const [sourceName, setSourceName] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [confirmedDeleteIds, setConfirmedDeleteIds] = useState<Set<number>>(new Set())
  const [showConfirm, setShowConfirm] = useState(false)

  const exportMutation = useMutation({
    ...orpc.projects.exportPlan.mutationOptions(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `catalyse-project-${projectId}-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('Project exported', 'success')
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Export failed', 'error'),
  })

  const previewMutation = useMutation(orpc.projects.previewImport.mutationOptions())
  const applyMutation = useMutation({
    ...orpc.projects.applyImport.mutationOptions(),
    onSuccess: (res) => {
      setShowConfirm(false)
      void queryClient.invalidateQueries({ queryKey: orpc.projects.getById.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.projects.listTasks.key() })
      showToast(
        `Imported: ${res.created} created, ${res.updated} changed, ${res.deleted} deleted`,
        'success',
      )
      if (onDone) onDone()
      else router.push(`/projects/${projectId}`)
    },
    onError: (err: unknown) => {
      setShowConfirm(false)
      showToast(err instanceof Error ? err.message : 'Import failed', 'error')
    },
  })

  const diff = previewMutation.data ?? null

  function runPreview(text: string, name: string) {
    setFileText(text)
    setSourceName(name)
    setConfirmedDeleteIds(new Set())
    previewMutation.mutate({ projectId, file: text })
  }

  async function acceptFile(file: File) {
    if (file.size > 2_000_000) {
      showToast('That file is too large to be a project export', 'error')
      return
    }
    const text = await file.text()
    setPasteText('')
    runPreview(text, file.name)
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await acceptFile(file)
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await acceptFile(file)
  }

  function toggleDelete(id: number) {
    setConfirmedDeleteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const willApplyChange = useMemo(() => {
    if (!diff) return false
    const nonDeleteChange =
      diff.project.op === 'update' ||
      diff.tasks.some((t) => t.op === 'create' || t.op === 'update') ||
      diff.dependencies.some((d) => d.op !== 'noop')
    const deleteIds = new Set(
      diff.tasks.filter((t) => t.op === 'delete').map((t) => t.identity.id!),
    )
    const willDelete = [...confirmedDeleteIds].some((id) => deleteIds.has(id))
    return nonDeleteChange || willDelete
  }, [diff, confirmedDeleteIds])

  const canConfirm =
    !!diff && !!fileText && diff.errors.length === 0 && willApplyChange && !applyMutation.isPending

  return (
    <div>
      {/* Step 1 — take the file out. */}
      <div className="border-brand-border mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div>
          <H3 className="m-0 text-base">Export</H3>
          <P className="text-text-light m-0 text-sm">
            Downloads the project, its tasks and their dependencies as JSON.
          </P>
        </div>
        <Button
          size="sm"
          disabled={exportMutation.isPending}
          onClick={() => exportMutation.mutate({ projectId })}
        >
          {exportMutation.isPending ? 'Exporting…' : 'Download export'}
        </Button>
      </div>

      {/* Step 2 — learn how to change it. */}
      <AiEditingHelp />

      {/* Step 3 — put it back. */}
      <div className="border-brand-border mb-4 rounded-lg border p-4">
        <H3 className="mt-0 mb-2 text-base">Import</H3>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            dragActive
              ? 'border-primary bg-primary/10'
              : 'border-brand-border hover:border-secondary'
          }`}
        >
          <P className="m-0 font-medium">Drag a project export file here</P>
          <P className="text-text-light m-0 text-sm">or click to choose a .json file</P>
          <input
            id="import-file"
            ref={fileInputRef}
            type="file"
            accept="application/json,.json,application/octet-stream"
            aria-label="Export file"
            className="hidden"
            onChange={onFileChosen}
          />
        </div>

        <div className="mt-4">
          <FormLabel htmlFor="import-paste" className="mb-1 block font-medium">
            …or paste the file contents
          </FormLabel>
          <Textarea
            id="import-paste"
            aria-label="Paste export JSON"
            rows={4}
            className="w-full font-mono text-sm"
            placeholder='{ "project": { … }, "tasks": [ … ] }'
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="mt-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!pasteText.trim() || previewMutation.isPending}
              onClick={() => runPreview(pasteText, 'pasted text')}
            >
              Preview pasted JSON
            </Button>
          </div>
        </div>

        {sourceName && <P className="text-text-light mt-3 text-sm">Loaded from: {sourceName}</P>}
      </div>

      {previewMutation.isPending && <P className="text-text-light">Computing diff…</P>}
      {previewMutation.isError && (
        <P className="text-error">
          {previewMutation.error instanceof Error
            ? previewMutation.error.message
            : 'Could not read that file'}
        </P>
      )}

      {diff && (
        <div className="border-brand-border rounded-lg border p-4">
          <ProjectImportDiff
            diff={diff}
            confirmedDeleteIds={confirmedDeleteIds}
            onToggleDelete={toggleDelete}
          />

          <div className="mt-6 flex gap-2">
            <Button
              onClick={() => setShowConfirm(true)}
              disabled={!canConfirm}
              title={
                diff.errors.length > 0
                  ? 'Fix the errors in the file first'
                  : !willApplyChange
                    ? 'Nothing to apply — no changes, and no deletions ticked'
                    : undefined
              }
            >
              Confirm import
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                previewMutation.reset()
                setFileText(null)
                setSourceName(null)
              }}
            >
              Discard this file
            </Button>
          </div>
        </div>
      )}

      <Modal
        id="confirm-import"
        title="Apply these changes?"
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
      >
        <P className="mb-4 text-sm">
          This applies every change shown, in one step. It cannot be undone automatically.
        </P>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              if (!diff || !fileText) return
              applyMutation.mutate({
                projectId,
                file: fileText,
                expectedHash: diff.meta.currentHash,
                confirmedDeleteIds: [...confirmedDeleteIds],
              })
            }}
            disabled={applyMutation.isPending}
          >
            {applyMutation.isPending ? 'Applying…' : 'Apply changes'}
          </Button>
          <Button variant="secondary" onClick={() => setShowConfirm(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  )
}
