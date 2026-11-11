import { useId, useState } from 'react'
import Radio from '@/components/Radio'
import { H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import { CATEGORY_LABELS, NOTIFICATION_CATEGORIES } from '@/lib/notification-categories'
import {
  EMAIL_DELIVERIES,
  PRESETS,
  ROLES,
  ROLE_LABELS,
  applyPreset,
  matchingPreset,
  type Delivery,
  type PreferenceRow,
  type Role,
} from '@/lib/notification-types'

const SHORT_LABELS: Record<Delivery, string> = {
  in_app: 'In app',
  email: 'Email',
  digest: 'Digest',
}

const ROW = 'py-3 border-t border-brand-border first:border-t-0 sm:flex sm:items-start sm:gap-4'

function Choices({
  name,
  label,
  value,
  onChange,
}: {
  name: string
  label: string
  value: Delivery | null
  onChange: (d: Delivery) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-x-5 gap-y-2 mt-2 sm:mt-0 sm:flex-shrink-0"
    >
      {EMAIL_DELIVERIES.map((d) => (
        <Radio key={d} name={name} checked={value === d} onChange={() => onChange(d)}>
          {SHORT_LABELS[d]}
        </Radio>
      ))}
    </div>
  )
}

type Change = (next: Record<string, Delivery>) => void

/** A block of rows with a "Set all" over them when there is more than one choice. */
function RowGroup({
  id,
  name,
  rows,
  value,
  onChange,
}: {
  id: string
  name: string
  rows: PreferenceRow[]
  value: Record<string, Delivery>
  onChange: Change
}) {
  const choosable = rows.filter((r) => !r.fixed)
  const current = choosable.map((r) => value[r.type] ?? r.delivery)
  const all = current.length > 0 && current.every((d) => d === current[0]) ? current[0] : null
  return (
    <div className="flex flex-col">
      {choosable.length > 1 && (
        <div className={`${ROW} font-medium`}>
          <span className="sm:flex-1">Set all</span>
          <Choices
            name={`${id}-all`}
            label={`Set all ${name}`}
            value={all}
            onChange={(d) =>
              onChange({ ...value, ...Object.fromEntries(choosable.map((r) => [r.type, d])) })
            }
          />
        </div>
      )}
      {rows.map((r) => (
        <div key={r.type} className={ROW}>
          <span className="block sm:flex-1">{r.label}</span>
          {r.fixed ? (
            <div className="mt-1 sm:mt-0 sm:w-64 sm:flex-shrink-0">
              <span className="font-medium">{r.fixed.shows}</span>
              <P className="text-sm text-text-light m-0">{r.fixed.why}</P>
            </div>
          ) : (
            <Choices
              name={`${id}-${r.type}`}
              label={r.label}
              value={value[r.type] ?? r.delivery}
              onChange={(d) => onChange({ ...value, [r.type]: d })}
            />
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Notification types any volunteer gets, under their Inbox categories, then one section per
 * role. A role the person holds is open; one they don't is muted and closed, and can still be
 * set in advance. Each row is a choice of In app, Email or Digest; a fixed type shows its
 * delivery and why. Presets above fill in every choice, across every section; the one the
 * choices match is shown checked, or Custom.
 */
export default function NotificationPreferences({
  rows,
  heldRoles,
  value,
  onChange,
}: {
  rows: PreferenceRow[]
  heldRoles: readonly Role[]
  value: Record<string, Delivery>
  onChange: Change
}) {
  const id = useId()
  const [open, setOpen] = useState<Partial<Record<Role, boolean>>>({})
  const preset = matchingPreset(rows, (r) => value[r.type] ?? r.delivery)
  const everyone = rows.filter((r) => r.role === 'everyone')
  return (
    <>
      <div role="radiogroup" aria-label="Preset" className="mb-6 flex flex-col gap-2">
        <span className="font-medium">Start from a preset</span>
        {PRESETS.map((p) => (
          <Radio
            key={p.key}
            name={`${id}-preset`}
            checked={preset === p.key}
            onChange={() => onChange({ ...value, ...applyPreset(p.key, rows) })}
          >
            {p.label} <span className="text-sm text-text-light">— {p.hint}</span>
          </Radio>
        ))}
        <Radio name={`${id}-preset`} checked={preset === null} disabled readOnly>
          Custom <span className="text-sm text-text-light">— your own mix, set below</span>
        </Radio>
      </div>
      {NOTIFICATION_CATEGORIES.map((category) => {
        const inCategory = everyone.filter((r) => r.category === category)
        if (inCategory.length === 0) return null
        const heading = CATEGORY_LABELS[category]
        return (
          <section key={category} aria-labelledby={`${id}-${category}`} className="mb-6">
            <H3 id={`${id}-${category}`} className="mt-0">
              {heading}
            </H3>
            <RowGroup
              id={`${id}-${category}`}
              name={heading}
              rows={inCategory}
              value={value}
              onChange={onChange}
            />
          </section>
        )
      })}
      {ROLES.filter((role) => role !== 'everyone').map((role) => {
        const inRole = rows
          .filter((r) => r.role === role)
          .sort(
            (a, b) =>
              NOTIFICATION_CATEGORIES.indexOf(a.category) -
              NOTIFICATION_CATEGORIES.indexOf(b.category),
          )
        if (inRole.length === 0) return null
        const held = heldRoles.includes(role)
        const expanded = open[role] ?? held
        const body = `${id}-${role}-body`
        return (
          <section
            key={role}
            aria-labelledby={`${id}-${role}`}
            className={`mb-6 ${held ? '' : 'text-text-light'}`}
          >
            <H3 className="mt-0 mb-1">
              <button
                type="button"
                id={`${id}-${role}`}
                aria-expanded={expanded}
                aria-controls={body}
                onClick={() => setOpen((o) => ({ ...o, [role]: !expanded }))}
                className={`flex w-full items-center gap-2 text-left cursor-pointer ${held ? '' : 'text-text-light'}`}
              >
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                {ROLE_LABELS[role]}
              </button>
            </H3>
            {!held && (
              <P className="text-sm text-text-light m-0 mb-2">
                You don&apos;t have this role right now; set these in advance if you like.
              </P>
            )}
            <div id={body} hidden={!expanded}>
              <RowGroup
                id={`${id}-${role}`}
                name={ROLE_LABELS[role]}
                rows={inRole}
                value={value}
                onChange={onChange}
              />
            </div>
          </section>
        )
      })}
    </>
  )
}
