import Radio from '@/components/Radio'
import FilterDropdown from '@/components/FilterDropdown'
import { P } from '@/components/Text'
import {
  DIGEST_FREQUENCIES,
  DIGEST_FREQUENCY_LABELS,
  type DigestFrequency,
} from '@/lib/notification-digest'
import { formatLocalDay, hourLabel, zoneLabel, type TimeZoneSource } from '@/lib/time-zone'

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }))

const SOURCE_NOTES: Record<TimeZoneSource, string> = {
  chosen: '',
  country: " (from your chapter's country until you choose)",
  default: ' (UTC until you choose)',
}

/** How often the digest goes, at what local hour, in which time zone, and when it next can. */
export default function DigestSchedule({
  frequency,
  hour,
  timeZone,
  effectiveTimeZone,
  timeZoneSource,
  nextDigestAt,
  zones,
  onChange,
}: {
  frequency: DigestFrequency
  hour: number
  /** Their own choice; empty while it falls back. */
  timeZone: string
  effectiveTimeZone: string
  timeZoneSource: TimeZoneSource
  nextDigestAt: Date | null
  zones: readonly string[]
  onChange: (next: { frequency?: DigestFrequency; hour?: number; timeZone?: string }) => void
}) {
  const current = timeZone || effectiveTimeZone
  // The runtime's list can miss UTC and name a zone the browser spells otherwise.
  const zoneOptions = [...new Set([...zones, 'UTC', current])]
    .sort()
    .map((z) => ({ value: z, label: zoneLabel(z) }))
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div role="radiogroup" aria-label="Digest frequency" className="flex flex-col gap-2">
        <span className="font-medium">How often the digest comes</span>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {DIGEST_FREQUENCIES.map((f) => (
            <Radio
              key={f}
              name="digest_frequency"
              checked={frequency === f}
              onChange={() => onChange({ frequency: f })}
            >
              {DIGEST_FREQUENCY_LABELS[f]}
            </Radio>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-40">
          <FilterDropdown
            id="digest_hour"
            label="At"
            ariaLabel="Digest time"
            value={String(hour)}
            options={HOURS}
            onChange={(v) => onChange({ hour: Number(v) })}
          />
        </div>
        <div className="sm:flex-1">
          <FilterDropdown
            id="time_zone"
            label="Your time zone"
            ariaLabel="Your time zone"
            value={current}
            options={zoneOptions}
            searchable
            onChange={(v) => onChange({ timeZone: v })}
          />
        </div>
      </div>
      <P className="text-sm text-text-light m-0">
        {nextDigestAt
          ? `Next digest: ${formatLocalDay(nextDigestAt, effectiveTimeZone, true)} ${zoneLabel(effectiveTimeZone)}${SOURCE_NOTES[timeZoneSource]}, if anything new has arrived by then.`
          : null}
      </P>
    </div>
  )
}
