import type { ComponentPropsWithoutRef } from 'react'
import { twMerge } from 'tailwind-merge'

export default function TextLink({ className, ...props }: ComponentPropsWithoutRef<'a'>) {
  return <a className={twMerge('text-primary-text underline', className)} {...props} />
}
