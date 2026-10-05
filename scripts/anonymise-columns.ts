/**
 * How the anonymiser treats every text column in the database. A column holding anything a
 * person typed, or anything that identifies or authenticates one, must not survive into an
 * anonymised copy. scripts/anonymise-columns.test.ts fails when a column is missing from this
 * map, so adding a text column to the schema means deciding here what it is.
 *
 * - keep: project content, reference data and enum-like values; nothing personal.
 * - redact: free text about or by a person; replaced with a marker where not null.
 * - null: emptied.
 * - token: a secret or a hash of an identifier; replaced with a random value.
 * - custom: replaced with plausible fake data by bespoke code in anonymise-db.ts.
 * - rows-deleted: every row of the table is deleted.
 */
export type Treatment = 'keep' | 'redact' | 'null' | 'token' | 'custom' | 'rows-deleted'

export const REDACTED = '[redacted]'

export const COLUMN_TREATMENT: Record<string, Record<string, Treatment>> = {
  admin_invites: { email: 'custom', invite_token: 'token' },
  admin_notes: { content: 'redact', category: 'keep' },
  anonymised_emails: { email_hash: 'token' },
  bug_report_comments: { content: 'redact' },
  bug_reports: {
    reporter_email: 'null',
    title: 'redact',
    description: 'redact',
    page_url: 'null',
    category: 'keep',
    severity: 'keep',
    status: 'keep',
    resolution_notes: 'redact',
  },
  contact_messages: { subject: 'redact', message: 'redact' },
  contact_requests: { message: 'redact' },
  cron_job_runs: { job_name: 'keep', triggered_by: 'keep', status: 'keep', summary: 'null' },
  deletion_requests: { volunteer_email: 'null', status: 'keep' },
  digest_runs: { type: 'keep' },
  email_verification_tokens: { token: 'rows-deleted' },
  experimental_journalists: {
    first_name: 'custom',
    last_name: 'custom',
    email: 'custom',
    organisation: 'custom',
    category: 'keep',
    medium: 'keep',
    website: 'null',
    interests: 'redact',
    notes: 'redact',
  },
  experimental_outreach_login_tokens: { token_hash: 'rows-deleted' },
  experimental_outreach_participants: { email: 'custom' },
  experimental_outreach_sessions: { token_hash: 'rows-deleted' },
  local_group_suggestions: { name: 'keep', country: 'keep', admin_notes: 'redact' },
  local_groups: { name: 'keep', country: 'keep' },
  notifications: { type: 'keep', title: 'redact', body: 'null', link: 'keep' },
  password_reset_tokens: { token: 'token' },
  project_review_requests: { message: 'redact' },
  rejected_applications: { email_hash: 'token', admin_notes: 'redact', applicant_notes: 'redact' },
  schema_migrations: { filename: 'keep' },
  sessions: { token_hash: 'rows-deleted' },
  skill_categories: { name: 'keep', description: 'keep' },
  skill_endorsements: { notes: 'redact' },
  skills: { name: 'keep', description: 'keep' },
  team_join_requests: { message: 'redact' },
  team_suggestions: { name: 'keep', description: 'keep', admin_notes: 'redact' },
  teams: { name: 'keep', description: 'keep', luma_url: 'keep', doc_url: 'keep' },
  templates: {
    title: 'keep',
    description: 'keep',
    structure: 'keep',
    source_country: 'keep',
    source_local_group: 'keep',
  },
  volunteer_skills: { proficiency_level: 'keep' },
  volunteers: {
    name: 'custom',
    email: 'custom',
    bio: 'custom',
    discord_handle: 'custom',
    signal_number: 'custom',
    whatsapp_number: 'custom',
    contact_preference: 'keep',
    contact_notes: 'custom',
    location: 'custom',
    other_skills: 'custom',
    auth_token: 'null',
    password_hash: 'custom',
    country: 'keep',
    email_digest: 'keep',
    local_group: 'custom',
    application_message: 'redact',
    application_admin_notes: 'redact',
    application_applicant_notes: 'redact',
  },
  work_item_comments: { content: 'redact' },
  work_item_interests: { interest_type: 'keep', message: 'redact', response_message: 'redact' },
  work_items: {
    type: 'keep',
    status: 'keep',
    title: 'keep',
    description: 'keep',
    review_notes: 'redact',
    review_rating: 'keep',
    submission_note: 'redact',
    submission_url: 'redact',
    changes_requested_note: 'redact',
    project_type: 'keep',
    urgency: 'keep',
    estimated_duration: 'keep',
    collaboration_link: 'keep',
    outcome: 'keep',
    outcome_notes: 'redact',
    country: 'keep',
    local_group: 'keep',
  },
}
