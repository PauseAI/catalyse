'use client'

import { useState } from 'react'
import Image from 'next/image'
import { initials } from '@/components/WorkItemHeader'
import { usePerson } from '@/lib/hooks/usePerson'

const SIZES = {
  xs: { box: 'size-4 text-[0.6rem]', px: 16 },
  row: { box: 'size-6 text-xs', px: 24 },
  sm: { box: 'size-7 text-xs', px: 28 },
  md: { box: 'size-9 text-sm', px: 36 },
  lg: { box: 'size-24 text-3xl', px: 96 },
} as const

export type AvatarSize = keyof typeof SIZES

/**
 * A person's profile picture in a circle, or their initials when they have none (or it fails to
 * load). `id` is null for someone with no account. The name beside it is what a screen reader
 * reads; pass `label` when there is no name beside it.
 */
export default function Avatar({
  id,
  name,
  size = 'sm',
  label,
}: {
  id: number | null | undefined
  name: string
  size?: AvatarSize
  label?: string
}) {
  const person = usePerson(id)
  const [failed, setFailed] = useState<string | null>(null)
  const { box, px } = SIZES[size]
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  const picture = person?.picture
  if (picture && failed !== picture) {
    return (
      <span {...a11y} className={`${box} shrink-0 overflow-hidden rounded-full`}>
        <Image
          src={picture}
          alt=""
          width={px}
          height={px}
          unoptimized
          className="size-full object-cover"
          onError={() => setFailed(picture)}
        />
      </span>
    )
  }
  return (
    <span
      {...a11y}
      className={`${box} rounded-full bg-secondary text-white font-semibold flex items-center justify-center shrink-0`}
    >
      {initials(name)}
    </span>
  )
}
