import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import FormLabel from '@/components/FormLabel'

type ToggleProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  children?: ReactNode
}

export default function Toggle({ children, ...props }: ToggleProps) {
  return (
    <FormLabel className="flex items-center gap-3 cursor-pointer font-normal mb-0">
      <span className="relative flex-shrink-0">
        <input type="checkbox" className="sr-only peer" {...props} />
        <span className="block w-11 h-6 rounded-full bg-brand-border peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 transition-colors" />
        <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm peer-checked:translate-x-5 transition-transform pointer-events-none" />
      </span>
      {children !== null && <span>{children}</span>}
    </FormLabel>
  )
}
