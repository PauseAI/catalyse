import Tooltip from './Tooltip'
import { ACTIVE_WITHIN_DAYS } from '@/lib/activity-window'

/** A green dot for someone who has used the site recently. */
export default function ActiveDot() {
  const label = `Active in the last ${ACTIVE_WITHIN_DAYS} days`
  return (
    <Tooltip content={label}>
      <span
        role="img"
        aria-label={label}
        className="ml-2 inline-block w-2.5 h-2.5 rounded-full bg-success align-middle"
      />
    </Tooltip>
  )
}
