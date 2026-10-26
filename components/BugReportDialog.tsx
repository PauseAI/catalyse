'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import Button from '@/components/Button'
import FilterDropdown, { useFilterOptions } from '@/components/FilterDropdown'
import { orpc } from '@/lib/orpc'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { H2, H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import FormLabel from '@/components/FormLabel'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'

interface BugReportDialogProps {
  isOpen: boolean
  onClose: () => void
}

const CATEGORIES = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'ux', label: 'UX Issue' },
] as const
type Category = (typeof CATEGORIES)[number]['value']

export default function BugReportDialog({ isOpen, onClose }: BugReportDialogProps) {
  const [category, setCategory] = useState<Category>('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const {
    value: severity,
    onChange: setSeverity,
    options: severityOptions,
  } = useFilterOptions(
    [
      { value: 'low', label: 'Low: minor inconvenience' },
      { value: 'medium', label: 'Medium: affects workflow' },
      { value: 'high', label: 'High: blocking' },
      { value: 'critical', label: 'Critical: site is broken' },
    ],
    'medium',
  )
  const [success, setSuccess] = useState(false)
  const [reportId, setReportId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [descriptionInvalid, setDescriptionInvalid] = useState(false)
  const createMutation = useMutation({ ...orpc.bugReports.create.mutationOptions() })

  const submitting = createMutation.isPending

  function reset() {
    setCategory('bug')
    setTitle('')
    setDescription('')
    setSeverity('medium')
    setSuccess(false)
    setReportId(null)
    setError('')
    setDescriptionInvalid(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (description.length < 10) {
      setDescriptionInvalid(true)
      return
    }
    setDescriptionInvalid(false)
    setError('')
    createMutation.mutate(
      {
        category,
        title,
        description,
        severity,
      },
      {
        onSuccess: (data) => {
          setSuccess(true)
          setReportId(data.id)
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Something went wrong'),
      },
    )
  }

  const trapRef = useFocusTrap(isOpen)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Report an issue"
        className="bg-surface rounded-xl shadow-lg max-w-125 w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
          <H2 className="mb-0">Report an issue</H2>
          <Button variant="ghost" icon onClick={handleClose} aria-label="Close">
            ×
          </Button>
        </div>
        <div className="p-6">
          {success ? (
            <div className="text-center py-5">
              <H3 role="heading">Thank you!</H3>
              <P>Your feedback has been submitted.</P>
              {reportId && (
                <P>
                  <Link href={`/bugs/${reportId}`} className="underline" onClick={handleClose}>
                    View your report
                  </Link>
                </P>
              )}
              <Button onClick={handleClose}>Close</Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* [test hook] toast-error class used as test selector */}
              {error && (
                <div className="toast-error flex items-center gap-3 p-4 rounded-lg mb-4 bg-red-100 text-red-800 border border-red-300 dark:bg-red-900 dark:text-red-300 dark:border-red-600">
                  {error}
                </div>
              )}

              <div className="mb-5">
                <FormLabel>What type of feedback?</FormLabel>
                <div className="flex gap-2 flex-wrap">
                  {/* [test hook] category-btn class used as test selector */}
                  {CATEGORIES.map((cat) => (
                    <Button
                      key={cat.value}
                      type="button"
                      variant="ghost"
                      active={category === cat.value}
                      className="category-btn flex-1"
                      onClick={() => setCategory(cat.value)}
                    >
                      {cat.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="mb-5">
                <FormLabel htmlFor="bug-title" required>
                  Title
                </FormLabel>
                <Input
                  id="bug-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="Brief summary"
                />
              </div>

              <div className="mb-5">
                <FormLabel htmlFor="bug-description" required>
                  Details
                </FormLabel>
                <Textarea
                  id="bug-description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value)
                    if (descriptionInvalid && e.target.value.length >= 10)
                      setDescriptionInvalid(false)
                  }}
                  required
                  aria-invalid={descriptionInvalid || undefined}
                  placeholder={
                    {
                      bug: 'What happened? What did you expect?',
                      feature: 'What would you like to be able to do?',
                      ux: 'What felt confusing or frustrating?',
                    }[category]
                  }
                />
              </div>

              <div className="mb-5">
                <FilterDropdown
                  id="bug-severity"
                  label="How urgent is this?"
                  ariaLabel="How urgent is this?"
                  value={severity}
                  options={severityOptions}
                  onChange={setSeverity}
                />
              </div>

              <div className="flex gap-3 justify-end">
                <Button type="button" variant="secondary" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Submit report'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
