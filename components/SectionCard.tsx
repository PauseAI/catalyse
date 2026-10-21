import type { FormEvent, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'
import { H2 } from '@/components/Heading'
import { P } from '@/components/Text'
import { SECTION_CARD } from '@/lib/ui-classes'

type SectionCardProps = {
  title?: ReactNode
  description?: ReactNode
  className?: string
  children: ReactNode
} & (
  | { as?: 'section' | 'div'; onSubmit?: never }
  /** A card that is one form, submitted by its own button. */
  | { as: 'form'; onSubmit: (e: FormEvent) => void }
)

// One titled card in a page of cards, such as a settings tab. Stack several in a
// `flex flex-col gap-6` column so they share width and spacing.
export default function SectionCard({
  as: Tag = 'section',
  title,
  description,
  className,
  children,
  onSubmit,
}: SectionCardProps) {
  return (
    <Tag
      className={twMerge(SECTION_CARD, 'overflow-hidden wrap-break-word', className)}
      onSubmit={onSubmit}
    >
      {(title || description) && (
        <header className="mb-4">
          {title && <H2 className="mt-0 mb-1">{title}</H2>}
          {description && <P className="text-text-light m-0">{description}</P>}
        </header>
      )}
      {children}
    </Tag>
  )
}
