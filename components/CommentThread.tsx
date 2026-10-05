'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import CommentThreadView, { succeeded } from './CommentThreadView'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

interface CommentThreadProps {
  workItemId: number
  emptyText?: string
  placeholder?: string
}

export default function CommentThread({ workItemId, emptyText, placeholder }: CommentThreadProps) {
  const queryClient = useQueryClient()
  const showToast = useToast()

  const { data, isPending } = useQuery({
    ...orpc.workItemComments.list.queryOptions({ input: { workItemId } }),
  })

  const handlers = (done: string, failed: string) => ({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.workItemComments.list.key() })
      showToast(done, 'success')
    },
    onError: (err: unknown) => showToast(err instanceof Error ? err.message : failed, 'error'),
  })
  const addMutation = useMutation({
    ...orpc.workItemComments.add.mutationOptions(),
    ...handlers('Comment added', 'Failed to add comment'),
  })
  const editMutation = useMutation({
    ...orpc.workItemComments.edit.mutationOptions(),
    ...handlers('Comment updated', 'Failed to update comment'),
  })
  const deleteMutation = useMutation({
    ...orpc.workItemComments.delete.mutationOptions(),
    ...handlers('Comment deleted', 'Failed to delete comment'),
  })

  return (
    <CommentThreadView
      comments={data?.comments ?? []}
      canPost={data?.canPost ?? false}
      canReply
      mentionable={data?.mentionable}
      isPending={isPending}
      isSubmitting={addMutation.isPending}
      onSubmit={(content, parentId) =>
        succeeded(() => addMutation.mutateAsync({ workItemId, content, parentId }))
      }
      onEdit={(id, content) => succeeded(() => editMutation.mutateAsync({ id, content }))}
      onDelete={(id) => succeeded(() => deleteMutation.mutateAsync({ id }))}
      emptyText={emptyText}
      placeholder={placeholder}
    />
  )
}
