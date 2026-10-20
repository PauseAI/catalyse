import Checkbox from '@/components/Checkbox'
import FormLabel from '@/components/FormLabel'
import { P } from '@/components/Text'
import Input from '@/components/ui/Input'

/** The submit box's label when a task names nothing else to submit. */
export const DEFAULT_SUBMISSION_PROMPT = 'What did you do?'

/** What a task or Quick Task asks for when its work is handed in, as it comes from the API. */
export type SubmissionAsk = { submissionPrompt: string | null; submissionAsksLink: boolean }

/** The same, as a form holds it: a blank prompt is no prompt. */
export type SubmissionAskDraft = { prompt: string; asksLink: boolean }

export const NEW_SUBMISSION_ASK: SubmissionAskDraft = { prompt: '', asksLink: false }

export function submissionAskDraft(ask: SubmissionAsk): SubmissionAskDraft {
  return { prompt: ask.submissionPrompt ?? '', asksLink: ask.submissionAsksLink }
}

export function submissionAskPayload(draft: SubmissionAskDraft): SubmissionAsk {
  return { submissionPrompt: draft.prompt.trim() || null, submissionAsksLink: draft.asksLink }
}

/** The task form's "What to submit" and "Ask for a link", set by whoever can edit the task. */
export default function SubmissionAskFields({
  id,
  value,
  onChange,
}: {
  id: string
  value: SubmissionAskDraft
  onChange: (value: SubmissionAskDraft) => void
}) {
  return (
    <fieldset className="mb-5">
      <legend className="sr-only">When the work is submitted</legend>
      <div className="mb-3">
        <FormLabel htmlFor={`${id}-submission-prompt`}>What to submit (optional)</FormLabel>
        <Input
          id={`${id}-submission-prompt`}
          type="text"
          maxLength={200}
          placeholder={DEFAULT_SUBMISSION_PROMPT}
          value={value.prompt}
          onChange={(e) => onChange({ ...value, prompt: e.target.value })}
        />
        <P className="text-sm text-text-light mt-1 mb-0">
          The question the person doing it answers when they hand it in.
        </P>
      </div>
      <Checkbox
        checked={value.asksLink}
        onChange={(e) => onChange({ ...value, asksLink: e.target.checked })}
      >
        Ask for a link to the work
      </Checkbox>
    </fieldset>
  )
}
