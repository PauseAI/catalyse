'use client'

import { useState } from 'react'
import Button from '@/components/Button'
import { useRequiredActions } from '@/lib/required-actions-context'
import { viewOf } from './registry'

/**
 * The open required action's dialog, and a banner of the rest under the header. The banner
 * can be put away until the next page load; the header menu still lists them.
 */
export default function RequiredActions() {
  const { actions, openAction, show, hide } = useRequiredActions()
  const [bannerHidden, setBannerHidden] = useState(false)
  const Dialog = openAction && viewOf(openAction).Dialog

  return (
    <>
      {openAction && Dialog && <Dialog key={openAction.id} action={openAction} onClose={hide} />}
      {!openAction && !bannerHidden && actions.length > 0 && (
        <section
          aria-label="Things to settle"
          className="border-b border-brand-border bg-primary/10"
        >
          <div className="container flex items-start gap-3 py-3">
            <ul className="flex-1 flex flex-col gap-2">
              {actions.map((action) => {
                const view = viewOf(action)
                return (
                  <li key={action.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{view.label}</span>
                    <span className="text-text-light text-sm">{view.summary(action)}</span>
                    <Button size="sm" onClick={() => show(action.id)}>
                      Continue
                    </Button>
                  </li>
                )
              })}
            </ul>
            <Button
              variant="ghost"
              icon
              aria-label="Hide for now"
              onClick={() => setBannerHidden(true)}
            >
              ×
            </Button>
          </div>
        </section>
      )}
    </>
  )
}
