import Link from 'next/link'
import type { ComponentPropsWithoutRef } from 'react'

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-bold cursor-pointer transition-all disabled:opacity-40 disabled:saturate-50 disabled:cursor-not-allowed'

const variants = {
  primary: 'bg-primary text-[#111827] hover:bg-primary-dark',
  secondary: 'bg-secondary text-white hover:bg-secondary-dark',
  danger: 'bg-error text-white hover:bg-red-700',
  ghost: 'bg-transparent text-text-light hover:bg-accent hover:text-brand-text',
  // --secondary is a fill; as text or border on the dark page it is grey on grey, so the
  // outline is drawn in the text colours.
  outline:
    'bg-transparent border-2 border-text-light text-brand-text hover:bg-secondary hover:text-white',
  // An outline for actions that give something up, like leaving a team or withdrawing.
  warning: 'bg-transparent border-2 border-error text-error hover:bg-error hover:text-white',
}

const activeVariants: Record<keyof typeof variants, string> = {
  primary: 'bg-primary-dark',
  secondary: 'bg-secondary-dark',
  danger: 'bg-red-700',
  ghost: 'bg-accent! text-brand-text!',
  outline: 'bg-secondary text-white',
  warning: 'bg-error text-white',
}

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-2.5',
  lg: 'px-5 py-3',
}

const iconSizes = {
  sm: 'size-7 text-sm',
  md: 'size-9',
  lg: 'size-11',
}

type Variant = keyof typeof variants
type Size = keyof typeof sizes

type AsLink = { href: string } & Omit<ComponentPropsWithoutRef<typeof Link>, 'href'>
type AsButton = { href?: never } & ComponentPropsWithoutRef<'button'>

type ButtonProps = (AsLink | AsButton) & {
  variant?: Variant
  size?: Size
  icon?: boolean
  active?: boolean
}

export default function Button({
  variant = 'primary',
  size = 'md',
  icon = false,
  active = false,
  className,
  ...props
}: ButtonProps) {
  const sizeClass = icon ? iconSizes[size] : sizes[size]
  const classes = [base, variants[variant], active && activeVariants[variant], sizeClass, className]
    .filter(Boolean)
    .join(' ')

  if ('href' in props && props.href !== undefined) {
    const { href, ...rest } = props as AsLink
    return <Link href={href} className={classes} {...rest} />
  }

  return <button className={classes} {...(props as AsButton)} />
}
