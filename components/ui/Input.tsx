import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { twMerge } from 'tailwind-merge'

type TextInputType = 'text' | 'email' | 'number' | 'url' | 'password' | 'search' | 'date'

type InputProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  type?: TextInputType
}

const base =
  'w-full p-3 border-2 rounded-lg text-[1rem] border-brand-border dark:border-secondary bg-surface text-brand-text transition-colors duration-200 focus:outline-none focus:border-secondary aria-invalid:border-error focus:aria-invalid:border-error'

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { type = 'text', className, ...props },
  ref,
) {
  return <input ref={ref} type={type} className={twMerge(base, className)} {...props} />
})

export default Input
