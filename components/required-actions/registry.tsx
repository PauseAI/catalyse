import type { ComponentType } from 'react'
import type { RequiredAction } from '@/lib/required-actions'
import ConfirmLocationDialog from './ConfirmLocationDialog'
import MergeAccountDialog from './MergeAccountDialog'
import ReconcileProfileDialog from './ReconcileProfileDialog'

type Kind = RequiredAction['kind']
type ActionOf<K extends Kind> = Extract<RequiredAction, { kind: K }>

export type RequiredActionDialogProps<K extends Kind> = {
  action: ActionOf<K>
  onClose: () => void
}

type View<K extends Kind> = {
  /** What the banner and menu call it, as an instruction. */
  label: string
  /** A sentence for the banner. */
  summary: (action: ActionOf<K>) => string
  Dialog: ComponentType<RequiredActionDialogProps<K>>
}

/** How each kind of required action (lib/required-actions.ts) is shown and settled. */
export const REQUIRED_ACTION_VIEWS: { [K in Kind]: View<K> } = {
  confirm_location: {
    label: 'Confirm your location',
    summary: () => 'Help us match you with nearby projects and local groups.',
    Dialog: ConfirmLocationDialog,
  },
  merge_account: {
    label: 'Merge your accounts',
    summary: (a) =>
      `You seem to have a second account${a.other.email ? `, ${a.other.email}` : ''}.`,
    Dialog: MergeAccountDialog,
  },
  reconcile_profile: {
    label: 'Finish merging your profile',
    summary: (a) =>
      a.conflicts.length === 1
        ? 'Your accounts had one detail that differed. Choose which to keep.'
        : `Your accounts had ${a.conflicts.length} details that differed. Choose which to keep.`,
    Dialog: ReconcileProfileDialog,
  },
}

/** The view for an action, typed to its kind. */
export function viewOf<K extends Kind>(action: ActionOf<K>): View<K> {
  return REQUIRED_ACTION_VIEWS[action.kind] as View<K>
}
