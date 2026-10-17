/** The profile fields a merge reconciles, with the label the reconcile wizard asks about. */
export const MERGE_FIELD_LABELS = {
  name: 'Name',
  bio: 'Bio',
  location: 'Location',
  discordHandle: 'Discord',
  signalNumber: 'Signal',
  whatsappNumber: 'WhatsApp',
  contactPreference: 'Preferred contact',
  contactNotes: 'Contact notes',
  availabilityHoursPerWeek: 'Hours a week',
  otherSkills: 'Other skills',
  consentMakeProfileVisibleInDirectory: 'Show my profile in the directory',
  consentContactableByProjectOwners: 'Project owners may contact me',
  consentShareContactInfoWithProjectOwner: 'Share my contact details with project owners',
} as const

export type MergeField = keyof typeof MERGE_FIELD_LABELS
export const MERGE_FIELDS = Object.keys(MERGE_FIELD_LABELS) as MergeField[]

/** Consents a merge sets to "no" when the accounts disagree, until the person says otherwise. */
export const CONSENT_FIELDS: readonly MergeField[] = [
  'consentMakeProfileVisibleInDirectory',
  'consentContactableByProjectOwners',
  'consentShareContactInfoWithProjectOwner',
]

export type MergeValue = string | number | boolean | null

/** A field both accounts held with different values. */
export type MergeConflict = { field: MergeField; kept: MergeValue; merged: MergeValue }
