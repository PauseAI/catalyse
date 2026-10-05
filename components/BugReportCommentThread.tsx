'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import CommentThreadView, { succeeded } from './CommentThreadView'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

interface BugReportCommentThreadProps {
  bugReportId: number
  emptyText?: string
  placeholder?: string
}

export default function BugReportCommentThread({
  bugReportId,
  emptyText,
  placeholder,
}: BugReportCommentThreadProps) {
  const queryClient = useQueryClient()
  const showToast = useToast()

  const { data, isPending } = useQuery({
    ...orpc.bugReportComments.list.queryOptions({ input: { bugReportId } }),
  })

  const handlers = (done: string, failed: string) => ({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.bugReportComments.list.key() })
      showToast(done, 'success')
    },
    onError: (err: unknown) => showToast(err instanceof Error ? err.message : failed, 'error'),
  })
  const addMutation = useMutation({
    ...orpc.bugReportComments.add.mutationOptions(),
    ...handlers('Comment added', 'Failed to add comment'),
  })
  const editMutation = useMutation({
    ...orpc.bugReportComments.edit.mutationOptions(),
    ...handlers('Comment updated', 'Failed to update comment'),
  })
  const deleteMutation = useMutation({
    ...orpc.bugReportComments.delete.mutationOptions(),
    ...handlers('Comment deleted', 'Failed to delete comment'),
  })

  return (
    <CommentThreadView
      comments={data?.comments ?? []}
      canPost={data?.canPost ?? false}
      isPending={isPending}
      isSubmitting={addMutation.isPending}
      onSubmit={(content) => succeeded(() => addMutation.mutateAsync({ bugReportId, content }))}
      onEdit={(id, content) => succeeded(() => editMutation.mutateAsync({ id, content }))}
      onDelete={(id) => succeeded(() => deleteMutation.mutateAsync({ id }))}
      emptyText={emptyText}
      placeholder={placeholder}
    />
  )
}
