import type { ComponentPropsWithoutRef } from 'react'
import { twMerge } from 'tailwind-merge'

type HeadingProps = ComponentPropsWithoutRef<'h1'>

const base = 'font-heading font-bold text-heading'

export function H1({ className, ...props }: HeadingProps) {
  return <h1 className={twMerge(base, 'text-[2rem] mb-4', className)} {...props} />
}

export function H2({ className, ...props }: HeadingProps) {
  return <h2 className={twMerge(base, 'text-[1.5rem] mb-3', className)} {...props} />
}

export function H3({ className, ...props }: HeadingProps) {
  return <h3 className={twMerge(base, 'text-[1.25rem] mb-2', className)} {...props} />
}

// h4 was never part of the heading selector in globals.css — it kept the body font and colour.
export function H4({ className, ...props }: HeadingProps) {
  return <h4 className={twMerge('text-[1rem] font-semibold mb-1.5', className)} {...props} />
}
