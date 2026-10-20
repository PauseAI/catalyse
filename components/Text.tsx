import type { ComponentPropsWithoutRef } from 'react'
import { twMerge } from 'tailwind-merge'

export function P({ className, ...props }: ComponentPropsWithoutRef<'p'>) {
  return <p className={twMerge('mb-3', className)} {...props} />
}
