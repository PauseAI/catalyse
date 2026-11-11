import { useId } from 'react'
import Radio from '@/components/Radio'
import { H3 } from '@/components/Heading'
import { P } from '@/components/Text'
import { CATEGORY_LABELS, NOTIFICATION_CATEGORIES } from '@/lib/notification-categories'
import { EMAIL_DELIVERIES, type Delivery, type PreferenceRow } from '@/lib/notification-types'

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

/**
 * One row per notification type under its Inbox category, each a choice of In app, Email or
 * Digest, with a "Set all" row per category. A fixed type shows its delivery and why.
 */
export default function NotificationPreferences({
  rows,
  value,
  onChange,
}: {
  rows: PreferenceRow[]
  value: Record<string, Delivery>
  onChange: (next: Record<string, Delivery>) => void
}) {
  const id = useId()
  return (
    <>
      {NOTIFICATION_CATEGORIES.map((category) => {
        const inCategory = rows.filter((r) => r.category === category)
        if (inCategory.length === 0) return null
        const choosable = inCategory.filter((r) => !r.fixed)
        const current = choosable.map((r) => value[r.type] ?? r.delivery)
        const all = current.length > 0 && current.every((d) => d === current[0]) ? current[0] : null
        const heading = CATEGORY_LABELS[category]
        return (
          <section key={category} aria-labelledby={`${id}-${category}`} className="mb-6">
            <H3 id={`${id}-${category}`} className="mt-0">
              {heading}
            </H3>
            <div className="flex flex-col">
              {choosable.length > 1 && (
                <div className={`${ROW} font-medium`}>
                  <span className="sm:flex-1">Set all</span>
                  <Choices
                    name={`${id}-all-${category}`}
                    label={`Set all ${heading}`}
                    value={all}
                    onChange={(d) =>
                      onChange({
                        ...value,
                        ...Object.fromEntries(choosable.map((r) => [r.type, d])),
                      })
                    }
                  />
                </div>
              )}
              {inCategory.map((r) => (
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
          </section>
        )
      })}
    </>
  )
}
