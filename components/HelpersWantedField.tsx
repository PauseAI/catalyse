import FormLabel from '@/components/FormLabel'
import { P } from '@/components/Text'
import Input from '@/components/ui/Input'

/** A task's helpers wanted as the form holds it: blank seeks none. */
export function helpersWantedDraft(helpersWanted: number | null): string {
  return helpersWanted === null ? '' : String(helpersWanted)
}

/** Blank, zero or anything not a whole number seeks no helpers. */
export function helpersWantedPayload(draft: string): { helpersWanted: number | null } {
  const n = Number(draft)
  return { helpersWanted: draft.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null }
}

/** The task form's "Helpers wanted": how many volunteers may join beside whoever leads it. */
export default function HelpersWantedField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="mb-5">
      <FormLabel htmlFor={`${id}-helpers-wanted`}>Helpers wanted (optional)</FormLabel>
      <Input
        id={`${id}-helpers-wanted`}
        type="number"
        min={1}
        max={100}
        step={1}
        className="max-w-32"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <P className="text-sm text-text-light mt-1 mb-0">
        For work that needs several people with one in charge, such as flyering. Members can join as
        helpers until this many have; the person who claims it leads.
      </P>
    </div>
  )
}
