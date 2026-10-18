import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import FormLabel from '@/components/FormLabel'

type RadioProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  children?: ReactNode
}

export default function Radio({ children, ...props }: RadioProps) {
  return (
    <FormLabel className="flex items-center gap-2 cursor-pointer font-normal mb-0">
      <span className="relative flex-shrink-0">
        <input type="radio" className="sr-only peer" {...props} />
        <span className="block w-5 h-5 rounded-full border-2 border-brand-border dark:border-secondary bg-surface peer-checked:border-primary dark:peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 transition-colors" />
        <span className="absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 pointer-events-none">
          <span className="w-2.5 h-2.5 rounded-full bg-primary" />
        </span>
      </span>
      {children !== null && <span>{children}</span>}
    </FormLabel>
  )
}
