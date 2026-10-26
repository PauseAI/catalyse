'use client'

import { useRef, type ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Avatar from '@/components/Avatar'
import Button from '@/components/Button'
import SectionCard from '@/components/SectionCard'
import { P } from '@/components/Text'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { usePerson } from '@/lib/hooks/usePerson'
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from '@/lib/profile-picture'

const MAX_MB = MAX_UPLOAD_BYTES / 1024 / 1024

function asDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

/** The settings card where a volunteer uploads, replaces or removes their own picture. */
export default function ProfilePictureSettings({ id, name }: { id: number; name: string }) {
  const person = usePerson(id)
  const inputRef = useRef<HTMLInputElement>(null)
  const showToast = useToast()
  const queryClient = useQueryClient()
  // Every avatar on the page reads the lookup, so it is refreshed for all of them.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['person'] })
  const onError = (err: unknown) =>
    showToast(err instanceof Error ? err.message : 'Failed to update your picture', 'error')

  const upload = useMutation({
    ...orpc.profilePictures.upload.mutationOptions(),
    onSuccess: async () => {
      await refresh()
      showToast('Picture updated', 'success')
    },
    onError,
  })
  const remove = useMutation({
    ...orpc.profilePictures.remove.mutationOptions(),
    onSuccess: async () => {
      await refresh()
      showToast('Picture removed', 'success')
    },
    onError,
  })
  const busy = upload.isPending || remove.isPending

  const onChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast(`Pictures must be ${MAX_MB} MB or smaller`, 'error')
      return
    }
    upload.mutate({ picture: await asDataUrl(file) })
  }

  return (
    <SectionCard
      title="Profile picture"
      description="Shown on your profile and next to your name around the site. Without one, your initials are shown."
    >
      <div className="flex flex-wrap items-center gap-4">
        <Avatar id={id} name={name} size="lg" />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {upload.isPending
                ? 'Uploading…'
                : person?.picture
                  ? 'Change picture'
                  : 'Upload picture'}
            </Button>
            {person?.picture && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove.mutate({})}>
                {remove.isPending ? 'Removing…' : 'Remove'}
              </Button>
            )}
          </div>
          <P className="m-0 text-sm text-text-light">
            JPEG, PNG, WebP, GIF or AVIF, up to {MAX_MB} MB. It is cropped to a square.
          </P>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          aria-label="Profile picture file"
          className="hidden"
          onChange={onChosen}
        />
      </div>
    </SectionCard>
  )
}
