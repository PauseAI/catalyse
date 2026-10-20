import type { ComponentPropsWithoutRef } from 'react'
import { twMerge } from 'tailwind-merge'

type FormLabelProps = ComponentPropsWithoutRef<'label'> & {
  /** Appends the same " *" marker globals.css drew with `label.required::after`. */
  required?: boolean
}

export default function FormLabel({
  required = false,
  className,
  children,
  ...props
}: FormLabelProps) {
  return (
    <label
      className={twMerge(
        'block font-medium mb-1.5 text-brand-text',
        required && "after:content-['_*'] after:text-error",
        className,
      )}
      {...props}
    >
      {children}
    </label>
  )
}
