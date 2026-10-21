import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { twMerge } from 'tailwind-merge'

const base =
  'w-full p-3 border-2 rounded-lg text-[1rem] border-field-border bg-surface text-brand-text transition-colors duration-200 focus:outline-none focus:border-secondary aria-invalid:border-error focus:aria-invalid:border-error min-h-[120px] resize-y'

const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={twMerge(base, className)} {...props} />
  },
)

export default Textarea
