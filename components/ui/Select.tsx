import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { twMerge } from 'tailwind-merge'

const base =
  'w-full p-3 border-2 rounded-lg text-[1rem] border-brand-border dark:border-secondary bg-surface text-brand-text transition-colors duration-200 focus:outline-none focus:border-secondary aria-invalid:border-error focus:aria-invalid:border-error'

const Select = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<'select'>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={twMerge(base, className)} {...props} />
})

export default Select
