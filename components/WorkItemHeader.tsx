import React from 'react'
import { H1 } from '@/components/Heading'

/**
 * The top of a work item's page. With tabs (a project): the title, then a line with where it
 * happens on the left and, flush right from `sm` up, the person who answers for it, then a bar
 * holding the tabs on the left and the status and actions on the right. Without tabs (a task):
 * the person, status and actions sit on the title's line from `lg` up, and `underTitle` sits
 * directly beneath the title.
 */
export default function WorkItemHeader({
  title,
  titleId,
  subtitle,
  underTitle,
  person,
  tabs,
  status,
  actions,
  children,
}: {
  title: React.ReactNode
  titleId?: string
  /** A quiet line under the title: where it happens, whose team. */
  subtitle?: React.ReactNode
  /** Directly under the title in the title's column, e.g. a task's dates. */
  underTitle?: React.ReactNode
  /** The owner of a project, the assignee of a task. */
  person?: React.ReactNode
  tabs?: React.ReactNode
  status?: React.ReactNode
  actions?: React.ReactNode
  /** Sits between the title row and the bar, e.g. the viewer's own standing on the item. */
  children?: React.ReactNode
}) {
  const heading = (
    <H1 id={titleId} className="mb-0">
      {title}
    </H1>
  )
  const toolbar = (
    <div
      aria-label="Status and actions"
      role="toolbar"
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${tabs ? 'lg:pl-4 lg:border-b lg:border-brand-border' : ''}`}
    >
      {/* Each group drops out when it renders nothing; a divider parts them when both show. */}
      <div
        role="group"
        aria-label="Status"
        className="flex flex-wrap items-center gap-2 empty:hidden"
      >
        {status}
      </div>
      <div
        role="group"
        aria-label="Actions"
        className="flex flex-wrap items-center gap-2 empty:hidden border-brand-border sm:[:not(:empty)+&]:border-l sm:[:not(:empty)+&]:pl-4"
      >
        {actions}
      </div>
    </div>
  )

  if (!tabs) {
    return (
      <header className="mb-4">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="min-w-0 lg:flex-1">
            {heading}
            {subtitle && <div className="text-sm text-text-light mt-1">{subtitle}</div>}
            {underTitle && <div className="mt-2 empty:hidden">{underTitle}</div>}
          </div>
          {/* Nudged down to sit level with the title's first line. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:justify-end lg:pt-2.5">
            {person}
            {toolbar}
          </div>
        </div>
        {children}
      </header>
    )
  }

  // Below `lg` the bar's wrapper drops out of the layout and `order` stacks its parts: `children`
  // (a note on the bar's actions), then the status and actions, then the tabs over the content.
  return (
    <header className="mb-4 flex flex-col lg:block">
      <div className="mb-3 min-w-0">
        {heading}
        {(subtitle || person) && (
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4">
            {subtitle && <div className="text-sm text-text-light">{subtitle}</div>}
            {person && <div className="flex min-w-0 sm:ml-auto">{person}</div>}
          </div>
        )}
        {underTitle && <div className="mt-2 empty:hidden">{underTitle}</div>}
      </div>
      {children && <div className="order-1 mb-2 lg:order-none lg:mb-0">{children}</div>}
      <div className="contents lg:flex lg:flex-row lg:items-stretch">
        <div className="order-3 mt-3 min-w-0 lg:order-none lg:mt-0 lg:flex-1">{tabs}</div>
        <div className="order-2 lg:order-none lg:flex">{toolbar}</div>
      </div>
    </header>
  )
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Initials in a circle; the name beside it is what a screen reader reads. */
export function PersonInitials({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={`${size === 'md' ? 'size-9 text-sm' : 'size-7 text-xs'} rounded-full bg-secondary text-white font-semibold flex items-center justify-center shrink-0`}
    >
      {initials(name)}
    </span>
  )
}

/**
 * The person block under the title: a small role label ("Owner", "Assigned to"), then whatever
 * names them, then an optional one-line summary of who else is on it and the viewer's actions on
 * that person's place (Claim, Message). `secondActions` sits beneath flush right, so its buttons
 * share a right edge with `actions`.
 */
export function WorkItemPerson({
  label,
  children,
  summary,
  actions,
  secondActions,
}: {
  label: string
  children: React.ReactNode
  summary?: React.ReactNode
  actions?: React.ReactNode
  /** The viewer's way to join the people working alongside them, e.g. Join as helper. */
  secondActions?: React.ReactNode
}) {
  return (
    <div className="flex w-fit max-w-full flex-col gap-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-text-light">{label}</span>
        {children}
        {summary && <span className="text-text-light">· {summary}</span>}
        {actions}
      </div>
      {secondActions && (
        <div className="flex flex-wrap items-center justify-end gap-2 self-end">
          {secondActions}
        </div>
      )}
    </div>
  )
}
