'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import MessageDialog from '@/components/MessageDialog'
import Modal from '@/components/ui/Modal'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'

/**
 * How to reach a volunteer from a list or profile: Message when the viewer works with them
 * (or they accepted a request), otherwise Request contact, which they answer in their Inbox.
 * Renders nothing when neither is open, such as for someone hidden from the directory.
 */
export default function ContactButton({
  volunteerId,
  name,
  canMessage,
  canRequestContact,
  contactRequested,
  size = 'sm',
}: {
  volunteerId: number
  name: string
  canMessage: boolean
  canRequestContact: boolean
  contactRequested: boolean
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState<'message' | 'request' | null>(null)
  const [note, setNote] = useState('')
  const close = () => setOpen(null)
  const showToast = useToast()
  const queryClient = useQueryClient()
  const request = useMutation({
    ...orpc.contacts.request.mutationOptions(),
    onSuccess: () => {
      showToast(`Request sent. ${name} will answer in their Inbox.`, 'success')
      close()
      setNote('')
      void queryClient.invalidateQueries({ queryKey: orpc.volunteers.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.teams.key() })
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to send the request', 'error'),
  })
  const id = `contact-${volunteerId}`

  if (canMessage) {
    return (
      <>
        <Button size={size} variant="secondary" onClick={() => setOpen('message')}>
          Message
        </Button>
        {open === 'message' && (
          <MessageDialog
            id={id}
            title={`Message ${name}`}
            recipientId={volunteerId}
            recipientName={name}
            onClose={close}
          />
        )}
      </>
    )
  }
  if (contactRequested) {
    return <span className="text-sm text-text-light">Request sent</span>
  }
  if (!canRequestContact) return null

  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setOpen('request')}>
        Request contact
      </Button>
      <Modal id={id} title={`Connect with ${name}`} isOpen={open === 'request'} onClose={close}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            request.mutate({ toVolunteerId: volunteerId, message: note.trim() })
          }}
        >
          <p className="text-sm text-text-light mt-0">
            {name} is asked in their Inbox. If they accept, you can both see each other&apos;s
            contact details and message each other here.
          </p>
          <div className="mb-5">
            <label htmlFor={`${id}-note`}>Why would you like to connect?</label>
            <textarea
              id={`${id}-note`}
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Say who you are and what you'd like to talk about (at least 20 characters)"
            />
            {note.trim().length > 0 && note.trim().length < 20 && (
              <p className="text-xs text-text-light mt-1 mb-0">
                {20 - note.trim().length} more characters to go
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={request.isPending || note.trim().length < 20}>
              {request.isPending ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
