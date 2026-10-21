import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import FormLabel from '@/components/FormLabel'

type CheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  children?: ReactNode
}

export default function Checkbox({ children, ...props }: CheckboxProps) {
  return (
    <FormLabel className="flex items-center gap-2 cursor-pointer font-normal mb-0">
      <span className="relative flex-shrink-0">
        <input type="checkbox" className="sr-only peer" {...props} />
        <span className="block w-5 h-5 rounded border-2 border-field-border bg-surface peer-checked:bg-primary peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 transition-colors" />
        <span className="absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 pointer-events-none">
          <svg
            className="w-3.5 h-3.5 text-white dark:text-[#111827]"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3.5 8.5L6.5 11.5L12.5 4.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </span>
      {children !== null && <span>{children}</span>}
    </FormLabel>
  )
}
