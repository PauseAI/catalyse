'use client'

import { useId } from 'react'
import Linkify from './Linkify'

/**
 * Tells the viewer who invited them to help on this project, and any note that came with it.
 * Accept and Decline live with the rest of the page's actions, top right.
 */
export default function ProjectInviteBanner({
  invitedByName,
  note,
}: {
  invitedByName: string | null
  note: string | null
}) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface rounded-xl shadow p-6 mb-4 border-l-4 border-primary"
    >
      <h2 id={headingId} className="text-lg m-0 mb-2">
        {invitedByName ?? 'The owner'} invited you to help on this project
      </h2>
      {note && (
        <p className="m-0 whitespace-pre-wrap">
          <Linkify text={note} />
        </p>
      )}
    </section>
  )
}
