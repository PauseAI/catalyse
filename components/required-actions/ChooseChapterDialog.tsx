'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import Modal from '@/components/ui/Modal'
import Button from '@/components/Button'
import FilterDropdown from '@/components/FilterDropdown'
import { useAuth } from '@/lib/auth-context'
import { orpc } from '@/lib/orpc'
import { useRequiredActions } from '@/lib/required-actions-context'
import { useToast } from '@/lib/toast'
import type { RequiredActionDialogProps } from './registry'

export default function ChooseChapterDialog({
  onClose,
}: RequiredActionDialogProps<'choose_chapter'>) {
  const { refreshUser } = useAuth()
  const { refresh } = useRequiredActions()
  const showToast = useToast()
  const [chapterId, setChapterId] = useState('')
  const { data: chapters = [] } = useQuery(orpc.chapters.list.queryOptions())

  const join = useMutation({
    ...orpc.chapters.join.mutationOptions(),
    onSuccess: async ({ message }) => {
      showToast(message, 'success')
      await refreshUser()
      await refresh()
    },
    onError: (err) =>
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error'),
  })

  return (
    <Modal id="choose-chapter" title="Join a national chapter" isOpen onClose={onClose}>
      <p className="text-text-light mb-4">
        You aren&#39;t in a national chapter yet. Projects, teams and local groups are run by
        chapters, so join the one you&#39;d like to work with. Its organisers will hear that you
        joined.
      </p>
      <div className="mb-5">
        <FilterDropdown
          id="choose-chapter-select"
          label="Chapter"
          ariaLabel="Select chapter"
          value={chapterId}
          options={[
            { value: '', label: 'Choose a chapter' },
            ...chapters.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
          onChange={setChapterId}
          searchable
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          onClick={() => join.mutate({ chapterId: Number(chapterId) })}
          disabled={!chapterId || join.isPending}
        >
          {join.isPending ? 'Joining…' : 'Join'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Ask me later
        </Button>
      </div>
    </Modal>
  )
}
