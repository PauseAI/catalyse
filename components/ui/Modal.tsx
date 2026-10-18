'use client'

import { useEffect } from 'react'
import Button from '@/components/Button'
import { H2 } from '@/components/Heading'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'

interface ModalProps {
  id: string
  title: string
  children: React.ReactNode
  isOpen: boolean
  onClose: () => void
  /** `wide` is for modals holding a working surface — a diff, a form — rather than a question. */
  size?: 'default' | 'wide'
}

const SIZES: Record<'default' | 'wide', string> = {
  default: 'max-w-md',
  wide: 'max-w-3xl',
}

export default function Modal({
  id,
  title,
  children,
  isOpen,
  onClose,
  size = 'default',
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const trapRef = useFocusTrap(isOpen)

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        id={id}
        className={`bg-surface max-h-[90vh] w-full ${SIZES[size]} overflow-y-auto rounded-lg p-6 shadow-lg`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <H2 id={`${id}-title`} className="mb-0 leading-none">
            {title}
          </H2>
          <Button variant="ghost" icon onClick={onClose} aria-label="Close">
            ×
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
