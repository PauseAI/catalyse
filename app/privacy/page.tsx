'use client'

import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import Button from '@/components/Button'
import { useAuth } from '@/lib/auth-context'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'
import {
  TASK_FINAL_WARNING_AFTER_DAYS,
  TASK_RELEASE_AFTER_DAYS,
  TASK_REMINDER_AFTER_DAYS,
} from '@/lib/staleness'

export default function PrivacyPage() {
  const { user, loading } = useAuth()
  const showToast = useToast()

  const exportMutation = useMutation({
    ...orpc.privacy.export.mutationOptions(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `catalyse-data-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('Data exported successfully!', 'success')
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error')
    },
  })

  if (loading) return null

  return (
    <>
      <main className="container py-5 pb-15">
        <div className="sm:max-w-[600px] mx-auto">
          <h1>Privacy &amp; data</h1>
          <p className="text-text-light mb-6">
            Manage your data and privacy settings. We&apos;re committed to respecting your rights
            under GDPR.
          </p>

          {user && (
            <>
              <div className={`${SECTION_CARD} overflow-hidden wrap-break-word mb-6`}>
                <h2>Export your data</h2>
                <p className="text-text-light mb-4">
                  Download all your data in JSON format. This includes your profile, skills, project
                  interests, and messages.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => exportMutation.mutate({})}
                  disabled={exportMutation.isPending}
                >
                  {exportMutation.isPending ? 'Preparing…' : 'Download My Data'}
                </Button>
              </div>
            </>
          )}

          <div className={`${SECTION_CARD} overflow-hidden wrap-break-word mb-6`}>
            <h2>Our data practices</h2>

            <h4>What we collect</h4>
            <ul className="list-disc text-text-light mb-4 pl-5">
              <li>Information you provide (name, email, bio, contact details)</li>
              <li>Skills and availability you share</li>
              <li>Projects you propose or express interest in</li>
              <li>Bug reports and feedback you submit</li>
              <li>Admin notes about your volunteering activity (visible to admins only)</li>
            </ul>

            <h4>Legal basis for processing</h4>
            <p className="text-text-light">We process your data based on:</p>
            <ul className="list-disc text-text-light mb-4 pl-5">
              <li>
                <strong>Consent</strong>: for sharing your profile with other volunteers and
                allowing project owners to contact you (you can withdraw consent at any time via
                your privacy settings)
              </li>
              <li>
                <strong>Legitimate interest</strong>: for operating the platform, matching
                volunteers with projects, platform administration, and sending inactivity reminders
                to volunteers who have claimed a task
              </li>
              <li>
                <strong>Contract performance</strong>: for providing you the service you signed up
                for
              </li>
            </ul>

            <h4>How we use it</h4>
            <ul className="list-disc text-text-light mb-4 pl-5">
              <li>To match you with relevant projects based on your skills</li>
              <li>To enable project owners to contact you (with your consent)</li>
              <li>
                To send you transactional emails (password resets, admin invites, welcome emails)
              </li>
              <li>
                To relay messages between volunteers via email (the sender&apos;s email is included
                as reply-to so you can respond directly)
              </li>
              <li>To send you notifications about your projects and interests</li>
              <li>
                To send automated inactivity reminders if you have claimed a project task and have
                not posted an update: a reminder after {TASK_REMINDER_AFTER_DAYS} days, a final
                warning after {TASK_FINAL_WARNING_AFTER_DAYS}, and after {TASK_RELEASE_AFTER_DAYS}{' '}
                days you are unassigned so that other volunteers can take it on. A comment on the
                task or a change to it counts as an update. The project owner is told when a
                volunteer is unassigned due to inactivity (legitimate interest basis: keeping
                projects moving)
              </li>
              <li>
                To notify project owners and admins when task updates are posted, so they can stay
                informed about progress
              </li>
              <li>For platform administration and volunteer coordination</li>
            </ul>

            <h4>What we don&apos;t do</h4>
            <ul className="list-disc text-text-light mb-4 pl-5">
              <li>We never sell your data</li>
              <li>We don&apos;t share your contact info without your consent</li>
              <li>
                We don&apos;t use your data for profiling or to make decisions that have legal or
                significant effects on you. Automated task unassignment due to inactivity is a minor
                operational measure to keep projects moving, it does not affect your account,
                profile, or ability to claim other tasks
              </li>
            </ul>

            <h4>Third-party data processors</h4>
            <p className="text-text-light">
              The following services process data on our behalf (as data processors under GDPR
              Article 28). We have assessed each for adequate data protection safeguards:
            </p>
            <ul className="list-disc text-text-light mb-4 pl-5">
              <li>
                <strong>Railway</strong> (hosting): our application and database are hosted on
                Railway&apos;s cloud infrastructure. Data may be processed in the United States. We
                rely on Railway&apos;s standard contractual safeguards for international transfers.
              </li>
              <li>
                <strong>Resend</strong> (email delivery): used to send transactional emails
                (password resets, welcome emails, admin invites) and relay messages between
                volunteers. Resend processes your email address and name for delivery purposes only.
                Data may be processed in the United States.
              </li>
              <li>
                <strong>Backblaze B2</strong> (encrypted backups): daily encrypted backups of the
                database are stored in Backblaze&apos;s EU data centre (Amsterdam). Backups are
                retained for 30 days and then automatically deleted. Backups are used solely for
                disaster recovery and are never accessed for any other purpose.
              </li>
              <li>
                <strong>Google Analytics</strong> (usage analytics): used only to understand how the
                platform is used so we can improve it. Collects anonymised page view and interaction
                data via cookies. IP addresses are anonymised. Google Signals and ads
                personalisation are disabled, so this data is never used for advertising. Google,
                our analytics provider, processes this data on our behalf — we never sell it or
                share it for any other purpose. It loads unless you have turned it off, and there is
                no cookie banner. You can turn it off at any time in Settings &gt; Privacy &amp;
                Data. Data may be processed in the United States.
              </li>
              <li>
                <strong>Google Sign-In</strong> (authentication): if you choose to sign in with
                Google, Google verifies your identity and shares your name and email with us to
                create or log into your account. No other Google data is accessed.
              </li>
            </ul>
            <p className="text-text-light mb-4">
              Where data is processed outside the UK/EEA, we rely on the service provider&apos;s
              standard contractual clauses and data processing agreements as safeguards for
              international transfers.
            </p>

            <h4>Data retention</h4>
            <ul className="list-disc text-text-light mb-4 pl-5">
              <li>Active accounts: data is kept as long as your account is active</li>
              <li>
                Deleted accounts: personal data is anonymised immediately upon deletion. Anonymised
                records (e.g. &ldquo;[Deleted User]&rdquo; on project history) are retained for
                platform integrity
              </li>
              <li>
                Database backups: retained for 30 days, then automatically deleted. When you delete
                your account, your data is anonymised in the live database immediately; backup
                copies containing pre-deletion data will be overwritten within 30 days
              </li>
              <li>Password reset tokens expire after 1 hour</li>
              <li>Admin invite tokens expire after 7 days</li>
            </ul>

            <h4>Cookies</h4>
            <ul className="list-disc text-text-light mb-4 pl-5">
              <li>
                <strong>Essential cookies</strong>: we use localStorage (not cookies) to store your
                login session and preferences (dark mode, cookie consent choice). These are
                necessary for the site to function.
              </li>
              <li>
                <strong>Analytics cookies</strong>: Google Analytics uses cookies to collect
                anonymised usage data. These load unless you have turned analytics off in Settings
                &gt; Privacy &amp; Data, which you can do at any time.
              </li>
            </ul>

            <h4>Security</h4>
            <p className="text-text-light">
              Passwords are hashed using PBKDF2-SHA256 with random salts and are never stored in
              plain text. All data is transmitted over HTTPS. Authentication uses secure random
              tokens. Database backups are encrypted at rest by Backblaze and transmitted over
              HTTPS. Access to backups requires API credentials that are stored securely as
              environment variables.
            </p>
          </div>

          <div className={`${SECTION_CARD} overflow-hidden wrap-break-word mb-6`}>
            <h2>Your GDPR rights</h2>
            <p className="text-text-light mb-4">
              Under GDPR and the UK Data Protection Act 2018, you have the right to:
            </p>
            <ul className="list-disc text-text-light pl-5">
              <li>
                <strong>Access</strong> (Article 15): Download all your data using the export
                feature above
              </li>
              <li>
                <strong>Rectification</strong> (Article 16): Update your profile at any time
              </li>
              <li>
                <strong>Erasure</strong> (Article 17): Delete your account and all personal data
              </li>
              <li>
                <strong>Restrict processing</strong> (Article 18): Contact us to limit how we use
                your data
              </li>
              <li>
                <strong>Portability</strong> (Article 20): Export your data in a machine-readable
                format (JSON)
              </li>
              <li>
                <strong>Object</strong> (Article 21): Contact us to opt out of specific processing
              </li>
              <li>
                <strong>Withdraw consent</strong> (Article 7): Update your privacy settings or
                delete your account at any time
              </li>
            </ul>
            <p className="text-text-light mt-4">
              <strong>Data Controller:</strong> Safe AI Alliance Ltd (trading as PauseAI UK /
              Catalyse)
              <br />
              <strong>Contact:</strong>{' '}
              <a href="mailto:matilda@pauseai.info">matilda@pauseai.info</a>
            </p>
            <p className="text-text-light mt-3">
              If you are not satisfied with how we handle your data, you have the right to lodge a
              complaint with the <strong>Information Commissioner&apos;s Office (ICO)</strong> at{' '}
              <a
                href="https://ico.org.uk/make-a-complaint/"
                target="_blank"
                rel="noopener noreferrer"
              >
                ico.org.uk
              </a>
              .
            </p>
          </div>

          {!user && (
            <div className={`${SECTION_CARD} overflow-hidden wrap-break-word text-center mb-6`}>
              <p className="text-text-light">
                <Link href="/login">Log in</Link> to export your data or manage your account.
              </p>
            </div>
          )}

          <p className="text-center mt-6">
            <Link href="/settings?tab=privacy">&larr; Back to Settings</Link>
          </p>
        </div>
      </main>
    </>
  )
}
