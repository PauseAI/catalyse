'use client'

import { useEffect, useState, FormEvent, Suspense } from 'react'
import { useRequireAuth } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import Button from '@/components/Button'
import Checkbox from '@/components/Checkbox'
import Radio from '@/components/Radio'
import FilterDropdown, { useFilterOptions } from '@/components/FilterDropdown'
import SkillPicker from '@/components/SkillPicker'
import Tabs from '@/components/Tabs'
import { Badge } from '@/components/Badge'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { useUrlParam } from '@/lib/hooks/url-filters'
import { formatDate } from '@/lib/format-date'
import { BUG_STATUS_VARIANT, bugStatusLabel } from '@/lib/bug-report-labels'
import {
  EMAIL_CATEGORY_LABELS,
  MUTABLE_EMAIL_CATEGORIES,
  type MutableEmailCategory,
} from '@/lib/notification-categories'
import {
  COUNTRY_OPTIONS,
  NO_LOCAL_GROUP,
  buildLocalGroupOptionsForCountry,
  type LocalGroupOption,
} from '@/lib/filter-options'

type TabKey = 'profile' | 'account' | 'notifications' | 'privacy' | 'bug-reports'

type DailySummaryChoice = 'email_and_in_app' | 'in_app_only' | 'off'

const DAILY_SUMMARY_CHOICES: { value: DailySummaryChoice; label: string }[] = [
  { value: 'email_and_in_app', label: 'Email and in-app' },
  { value: 'in_app_only', label: 'In-app only' },
  { value: 'off', label: 'Off' },
]

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'account', label: 'Account' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'privacy', label: 'Privacy & Data' },
  { key: 'bug-reports', label: 'My Bug Reports' },
]

const VALID_TABS = new Set<string>(TABS.map((t) => t.key))

interface SelectedSkill {
  skillId: number
  proficiencyLevel: string
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageContent />
    </Suspense>
  )
}

function SettingsPageContent() {
  const { user, loading, refreshUser, logout, setToken } = useRequireAuth()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const [rawTab, setTab] = useUrlParam('tab')
  const activeTab: TabKey = VALID_TABS.has(rawTab) ? (rawTab as TabKey) : 'profile'

  // Profile + Notifications + Privacy form state
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [countryValue, setCountryValue] = useState('')
  const [localGroupValue, setLocalGroupValue] = useState('')
  const [hours, setHours] = useState('')
  const [discordHandle, setDiscordHandle] = useState('')
  const [signalNumber, setSignalNumber] = useState('')
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [contactNotes, setContactNotes] = useState('')
  const [otherSkills, setOtherSkills] = useState('')
  const [skills, setSkills] = useState<SelectedSkill[]>([])
  const {
    value: contactPreference,
    onChange: setContactPreference,
    options: contactPrefOptions,
  } = useFilterOptions(
    [
      { value: '', label: 'Select…' },
      { value: 'email', label: 'Email' },
      { value: 'discord', label: 'Discord' },
      { value: 'signal', label: 'Signal' },
      { value: 'whatsapp', label: 'WhatsApp' },
    ],
    '',
  )
  const {
    value: emailDigest,
    onChange: setEmailDigest,
    options: emailDigestOptions,
  } = useFilterOptions(
    [
      { value: 'none', label: "Don't email me" },
      { value: 'match', label: 'Email me when a project matches my skills' },
      { value: 'fortnightly', label: 'Send me a fortnightly digest' },
    ],
    'none',
  )
  const [notifyRemoteProjects, setNotifyRemoteProjects] = useState(false)
  const [emailMutedCategories, setEmailMutedCategories] = useState<MutableEmailCategory[]>([])
  const [dailySummary, setDailySummary] = useState<DailySummaryChoice>('email_and_in_app')
  const [consentMakeProfileVisibleInDirectory, setConsentMakeProfileVisibleInDirectory] =
    useState(true)
  const [consentAnalytics, setConsentAnalytics] = useState(false)
  const [syncedUpdatedAt, setSyncedUpdatedAt] = useState<string | null>(null)

  // Account tab state
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState('')

  const { data: me, isPending: loadingProfile } = useQuery({
    ...orpc.auth.me.queryOptions(),
    enabled: !!user,
  })
  const { data: localGroupsData } = useQuery(orpc.localGroups.list.queryOptions({ input: {} }))
  const allLocalGroups: LocalGroupOption[] = localGroupsData?.groups ?? []

  const { data: myBugReports = [], isPending: loadingBugReports } = useQuery({
    ...orpc.bugReports.listMine.queryOptions(),
    enabled: !!user && activeTab === 'bug-reports',
  })

  const { data: myApplication } = useQuery({
    ...orpc.volunteers.myApplication.queryOptions(),
    enabled: !!user && user.approvalStatus === 'needs_info',
  })
  const [applicationMessage, setApplicationMessage] = useState('')
  const [syncedApplicationMessage, setSyncedApplicationMessage] = useState(false)

  useEffect(() => {
    if (!myApplication || syncedApplicationMessage) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSyncedApplicationMessage(true)
    setApplicationMessage(myApplication.applicationMessage ?? '')
  }, [myApplication, syncedApplicationMessage])

  const updateApplicationMutation = useMutation({
    ...orpc.volunteers.updateMe.mutationOptions(),
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to save application', 'error')
    },
  })

  const resubmitMutation = useMutation({
    ...orpc.volunteers.resubmitApplication.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.volunteers.myApplication.key() })
      await refreshUser()
      showToast('Application resubmitted for review', 'success')
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to resubmit application', 'error')
    },
  })

  async function handleResubmitApplication() {
    // onError has already reported a failed save; the rejection just stops the resubmit.
    const saved = await updateApplicationMutation.mutateAsync({ applicationMessage }).then(
      () => true,
      () => false,
    )
    if (saved) resubmitMutation.mutate({})
  }

  useEffect(() => {
    if (!me) return
    const updatedAtKey = String(me.updatedAt)
    if (updatedAtKey === syncedUpdatedAt) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSyncedUpdatedAt(updatedAtKey)
    setName(me.name ?? '')
    setBio(me.bio ?? '')
    setLocation(me.location ?? '')
    setCountryValue(me.country ?? '')
    setLocalGroupValue(me.localGroup ?? (me.location ? NO_LOCAL_GROUP : ''))
    setHours(me.availabilityHoursPerWeek !== null ? String(me.availabilityHoursPerWeek) : '')
    setDiscordHandle(me.discordHandle ?? '')
    setSignalNumber(me.signalNumber ?? '')
    setWhatsappNumber(me.whatsappNumber ?? '')
    setContactPreference(me.contactPreference ?? '')
    setContactNotes(me.contactNotes ?? '')
    setEmailDigest(me.emailDigest ?? 'none')
    setNotifyRemoteProjects(!!me.notifyRemoteProjects)
    setEmailMutedCategories(
      MUTABLE_EMAIL_CATEGORIES.filter((c) => me.emailMutedCategories?.includes(c)),
    )
    setDailySummary(me.dailySummary ?? 'email_and_in_app')
    setOtherSkills(me.otherSkills ?? '')
    setConsentMakeProfileVisibleInDirectory(!!me.consentMakeProfileVisibleInDirectory)
    setConsentAnalytics(me.cookieConsentAnalytics !== false)
    setSkills(
      ((me.skills ?? []) as { id: number; proficiencyLevel?: string | null }[]).map((s) => ({
        skillId: s.id,
        proficiencyLevel: s.proficiencyLevel ?? 'intermediate',
      })),
    )
  }, [me, syncedUpdatedAt, setContactPreference, setEmailDigest])

  const updateMutation = useMutation({
    ...orpc.volunteers.updateMe.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.auth.me.key() })
      await refreshUser()
      showToast('Profile updated!', 'success')
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to save', 'error')
    },
  })

  const changeEmailMutation = useMutation({
    ...orpc.auth.changeEmail.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      setNewEmail('')
      setEmailPassword('')
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Email change failed', 'error')
    },
  })

  const changePasswordMutation = useMutation({
    ...orpc.auth.changePassword.mutationOptions(),
    onSuccess: async (data) => {
      // The server rotates the session token on a password change; adopt the new one
      // so this tab stays signed in.
      await setToken(data.token)
      showToast(data.message, 'success')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Password change failed', 'error')
    },
  })

  const logoutOtherSessionsMutation = useMutation({
    ...orpc.auth.logoutOtherSessions.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to sign out other sessions', 'error')
    },
  })

  const deleteAccountMutation = useMutation({
    ...orpc.auth.deleteAccount.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      setTimeout(async () => {
        await logout()
      }, 1500)
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Account deletion failed', 'error')
    },
  })

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

  const localGroupOptions = countryValue
    ? buildLocalGroupOptionsForCountry(countryValue, allLocalGroups)
    : []
  const hasLocalGroups = localGroupOptions.some((o) => o.value && o.value !== NO_LOCAL_GROUP)
  const showCityInput = localGroupValue === NO_LOCAL_GROUP || (!!countryValue && !hasLocalGroups)

  function handleCountryChange(value: string) {
    setCountryValue(value)
    setLocalGroupValue('')
  }

  function buildUpdatePayload() {
    return {
      name: name.trim(),
      bio: bio.trim() || null,
      location: location.trim() || null,
      country: countryValue || null,
      localGroup: localGroupValue && localGroupValue !== NO_LOCAL_GROUP ? localGroupValue : null,
      availabilityHoursPerWeek: hours ? Number(hours) : null,
      discordHandle: discordHandle.trim() || null,
      signalNumber: signalNumber.trim() || null,
      whatsappNumber: whatsappNumber.trim() || null,
      contactPreference: contactPreference || null,
      contactNotes: contactNotes.trim() || null,
      emailDigest,
      notifyRemoteProjects,
      emailMutedCategories,
      dailySummary,
      otherSkills: otherSkills.trim() || null,
      skillIds: skills.map((s) => s.skillId),
      consentMakeProfileVisibleInDirectory,
      cookieConsentAnalytics: consentAnalytics,
    }
  }

  function handleSave(e: FormEvent) {
    e.preventDefault()
    updateMutation.mutate(buildUpdatePayload())
  }

  function handleChangeEmail(e: FormEvent) {
    e.preventDefault()
    changeEmailMutation.mutate({ newEmail, password: emailPassword })
  }

  function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', 'error')
      return
    }
    changePasswordMutation.mutate({ currentPassword, newPassword })
  }

  function handleDeleteAccount(e: FormEvent) {
    e.preventDefault()
    if (user?.hasPassword) {
      if (deletePassword !== deleteConfirmPassword) {
        showToast('Passwords do not match', 'error')
        return
      }
    } else {
      if (deletePassword !== 'DELETE') {
        showToast('Please type DELETE to confirm', 'error')
        return
      }
    }
    deleteAccountMutation.mutate(user?.hasPassword ? { password: deletePassword } : {})
  }

  if (loading || !user) return null

  if (loadingProfile) {
    return (
      <main className="container py-5 pb-15">
        <div className="text-center py-10 text-text-light">Loading…</div>
      </main>
    )
  }

  const saveButton = (
    <Button type="submit" disabled={updateMutation.isPending}>
      {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
    </Button>
  )

  return (
    <main className="container py-5 pb-15">
      <h1>Settings</h1>

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setTab} />

      {activeTab === 'profile' && user.approvalStatus === 'needs_info' && (
        <div className="bg-surface rounded-xl shadow p-6 mb-4 max-w-4xl border-2 border-amber-300 dark:border-amber-700">
          <h2 className="mt-0">Your Application</h2>
          {myApplication?.applicationApplicantNotes && (
            <>
              <p className="text-sm font-semibold text-text-light mb-1">Message from the team</p>
              <div className="bg-background rounded-lg p-4 mb-4 whitespace-pre-wrap text-sm">
                {myApplication.applicationApplicantNotes}
              </div>
            </>
          )}
          <div className="mb-4">
            <label htmlFor="applicationMessage">Your Application</label>
            <textarea
              id="applicationMessage"
              rows={5}
              minLength={20}
              value={applicationMessage}
              onChange={(e) => setApplicationMessage(e.target.value)}
            />
            {applicationMessage.trim().length < 20 && (
              <p className="text-sm text-text-light mt-1">Please write at least 20 characters.</p>
            )}
          </div>
          <Button
            onClick={handleResubmitApplication}
            disabled={
              updateApplicationMutation.isPending ||
              resubmitMutation.isPending ||
              applicationMessage.trim().length < 20
            }
          >
            {updateApplicationMutation.isPending || resubmitMutation.isPending
              ? 'Resubmitting…'
              : 'Resubmit for Review'}
          </Button>
          <p className="text-sm text-text-light mt-3">
            Update your skills, contact details, or availability below, then resubmit when
            you&apos;re ready: an admin will review your application again.
          </p>
        </div>
      )}

      {activeTab === 'profile' && user.approvalStatus === 'under_review' && (
        <div className="bg-surface rounded-xl shadow p-6 mb-4 max-w-4xl">
          <p className="text-text-light m-0">
            Your application has been resubmitted and is awaiting review. You can still update your
            profile below, but your application won&apos;t need resubmitting again unless an admin
            asks for more information.
          </p>
        </div>
      )}

      {activeTab === 'profile' && (
        <form
          className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word max-w-4xl"
          onSubmit={handleSave}
        >
          <div className="mb-5">
            <label htmlFor="name" className="required">
              Your Name
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="mb-5">
            <label htmlFor="bio">About You</label>
            <aside className="bg-brand-bg border border-brand-border rounded-lg px-4 py-3 mb-2 text-sm text-text-light">
              Shown to other volunteers in the directory if you choose to make your profile visible
              in the Privacy &amp; Data tab.
            </aside>
            <textarea
              id="bio"
              rows={4}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Your background and what brings you to PauseAI…"
            />
          </div>

          <h3 className="mt-6 mb-4">Contact Information</h3>
          <aside className="bg-brand-bg border border-brand-border rounded-lg px-4 py-3 mb-4 text-sm text-text-light">
            Always visible to you and admins. Shared with the people you work with on a project, and
            with anyone whose contact request you accept.
          </aside>
          <div className="grid grid-cols-2 gap-5 mb-5 max-sm:grid-cols-1">
            <div>
              <label htmlFor="discord_handle">Discord Handle</label>
              <input
                type="text"
                id="discord_handle"
                value={discordHandle}
                onChange={(e) => setDiscordHandle(e.target.value)}
                placeholder="e.g. username#1234"
              />
            </div>
            <div>
              <label htmlFor="signal_number">Signal</label>
              <input
                type="text"
                id="signal_number"
                value={signalNumber}
                onChange={(e) => setSignalNumber(e.target.value)}
                placeholder="e.g. +44…"
              />
            </div>
            <div>
              <label htmlFor="whatsapp_number">WhatsApp</label>
              <input
                type="text"
                id="whatsapp_number"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="e.g. +44…"
              />
            </div>
            <div>
              <FilterDropdown
                id="contact_preference"
                label="Preferred Contact Method"
                ariaLabel="Preferred Contact Method"
                value={contactPreference}
                options={contactPrefOptions}
                onChange={setContactPreference}
              />
            </div>
          </div>
          <div className="mb-5">
            <label htmlFor="contact_notes">Contact Notes</label>
            <input
              type="text"
              id="contact_notes"
              value={contactNotes}
              onChange={(e) => setContactNotes(e.target.value)}
              placeholder="e.g. Best to DM me on Discord first"
            />
          </div>

          <h3 className="mt-6 mb-4">Availability</h3>
          <div className="mb-5">
            <label htmlFor="hours">Hours per Week</label>
            <input
              type="number"
              id="hours"
              min={0}
              max={168}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <div className="mb-5">
            <FilterDropdown
              id="locationCountry"
              label="Country"
              ariaLabel="Select country"
              value={countryValue}
              options={COUNTRY_OPTIONS}
              onChange={handleCountryChange}
              searchable
            />
          </div>
          {countryValue && hasLocalGroups && (
            <div className="mb-5">
              <FilterDropdown
                id="locationGroup"
                label="Local Group"
                ariaLabel="Select local group"
                value={localGroupValue}
                options={localGroupOptions}
                onChange={setLocalGroupValue}
                searchable
              />
            </div>
          )}
          {showCityInput && (
            <div className="mb-5">
              <label htmlFor="location">City / Area</label>
              <input
                type="text"
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          )}

          <h3 className="mt-6 mb-4">Your Skills</h3>
          <div className="mb-5">
            <SkillPicker value={skills} onChange={setSkills} />
          </div>
          <div className="mb-5">
            <label htmlFor="other_skills">Other Skills</label>
            <input
              type="text"
              id="other_skills"
              placeholder="Any skills not listed above…"
              value={otherSkills}
              onChange={(e) => setOtherSkills(e.target.value)}
            />
          </div>

          {saveButton}
        </form>
      )}

      {activeTab === 'profile' && (
        <div className="bg-surface rounded-xl shadow p-6 mb-4 border-2 border-brand-border max-w-4xl">
          <h3>Local Groups</h3>
          <p className="text-text-light mb-4">
            Don&apos;t see your local group listed? Suggest a new one.
          </p>
          <Button href="/suggest-local-group" variant="outline">
            Suggest a Local Group
          </Button>
        </div>
      )}

      {activeTab === 'account' && (
        <div className="max-w-4xl">
          <div className="bg-surface rounded-xl shadow p-6 mb-6 overflow-hidden wrap-break-word">
            <h2>Change Email</h2>
            <p className="text-sm text-text-light mb-4">
              Current email: <strong>{user.email}</strong>
            </p>
            <form method="post" onSubmit={handleChangeEmail}>
              <div className="mb-5">
                <label htmlFor="newEmail">New Email Address</label>
                <input
                  type="email"
                  id="newEmail"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
              </div>
              <div className="mb-5">
                <label htmlFor="email_password">Your Password</label>
                <input
                  type="password"
                  id="email_password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={changeEmailMutation.isPending}>
                {changeEmailMutation.isPending ? 'Changing…' : 'Change Email'}
              </Button>
            </form>
          </div>

          <div className="bg-surface rounded-xl shadow p-6 mb-6 overflow-hidden wrap-break-word">
            <h2>Change Password</h2>
            <form method="post" onSubmit={handleChangePassword}>
              <div className="mb-5">
                <label htmlFor="currentPassword">Current Password</label>
                <input
                  type="password"
                  id="currentPassword"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="mb-5">
                <label htmlFor="newPassword">New Password</label>
                <input
                  type="password"
                  id="newPassword"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="mb-5">
                <label htmlFor="confirm_password">Confirm New Password</label>
                <input
                  type="password"
                  id="confirm_password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={changePasswordMutation.isPending}>
                {changePasswordMutation.isPending ? 'Changing…' : 'Change Password'}
              </Button>
            </form>
          </div>

          <div className="bg-surface rounded-xl shadow p-6 mb-6 overflow-hidden wrap-break-word">
            <h2>Sessions</h2>
            <p className="text-text-light mb-4">
              Sign out everywhere except this device — use this if you signed in somewhere you no
              longer trust.
            </p>
            <Button
              variant="outline"
              disabled={logoutOtherSessionsMutation.isPending}
              onClick={() => logoutOtherSessionsMutation.mutate({})}
            >
              {logoutOtherSessionsMutation.isPending
                ? 'Signing out other sessions…'
                : 'Log out of all other sessions'}
            </Button>
          </div>

          <div className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word">
            <h2>Danger Zone</h2>
            <p className="text-text-light mb-4">
              Permanently delete your account and all associated data. This cannot be undone.
            </p>
            <Button variant="danger" onClick={() => setShowDeleteModal(true)}>
              Delete My Account
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <form
          className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word max-w-4xl"
          onSubmit={handleSave}
        >
          <div className="mb-5">
            <FilterDropdown
              id="email_digest"
              label="Keep me in the loop about new projects"
              ariaLabel="Keep me in the loop about new projects"
              value={emailDigest}
              options={emailDigestOptions}
              onChange={setEmailDigest}
            />
          </div>
          <div className="mb-5">
            <Checkbox
              id="notify_remote_projects"
              checked={notifyRemoteProjects}
              onChange={(e) => setNotifyRemoteProjects(e.target.checked)}
            >
              Also alert me about remote-friendly projects outside my own country
            </Checkbox>
            <p className="text-sm text-text-light mt-1 ml-7">
              By default you only hear about projects based in your own country. Turn this on to
              also get alerts for projects elsewhere that are marked remote-friendly worldwide.
            </p>
          </div>
          <fieldset className="mb-5 border-0 p-0">
            <legend className="font-medium mb-2">Also email me</legend>
            <div className="flex flex-col gap-2">
              {MUTABLE_EMAIL_CATEGORIES.map((c) => (
                <Checkbox
                  key={c}
                  id={`email_${c}`}
                  checked={!emailMutedCategories.includes(c)}
                  onChange={(e) =>
                    setEmailMutedCategories((muted) =>
                      e.target.checked ? muted.filter((m) => m !== c) : [...muted, c],
                    )
                  }
                >
                  {EMAIL_CATEGORY_LABELS[c]}
                </Checkbox>
              ))}
            </div>
            <p className="text-sm text-text-light mt-1 ml-7">
              Everything still arrives in your Inbox. Messages from other volunteers are always
              emailed as well.
            </p>
          </fieldset>
          <fieldset className="mb-5 border-0 p-0">
            <legend className="font-medium mb-2">Daily summary</legend>
            <div className="flex flex-col gap-2">
              {DAILY_SUMMARY_CHOICES.map((c) => (
                <Radio
                  key={c.value}
                  name="daily_summary"
                  checked={dailySummary === c.value}
                  onChange={() => setDailySummary(c.value)}
                >
                  {c.label}
                </Radio>
              ))}
            </div>
            <p className="text-sm text-text-light mt-1 ml-7">
              One message a day, only when something needs you: deadlines coming up, work past its
              plan, and news on projects you lead. Turning it off never hides the Overdue flag or
              what is waiting on your Home page.
            </p>
          </fieldset>
          {saveButton}
        </form>
      )}

      {activeTab === 'privacy' && (
        <div className="max-w-4xl">
          <form
            className="bg-surface rounded-xl shadow p-6 mb-6 overflow-hidden wrap-break-word"
            onSubmit={handleSave}
          >
            <h2 className="mt-0">Privacy Settings</h2>
            <div className="mb-5 flex flex-col gap-3">
              <Checkbox
                id="consent_make_profile_visible_in_directory"
                checked={consentMakeProfileVisibleInDirectory}
                onChange={(e) => setConsentMakeProfileVisibleInDirectory(e.target.checked)}
              >
                Show me in the volunteer directory
              </Checkbox>
              <p className="text-sm text-text-light m-0 ml-7">
                Other volunteers can find you and ask to see your contact details; you choose
                whether to accept. People on your projects can always reach you.
              </p>
            </div>

            <h3 className="mt-6 mb-2">Analytics</h3>
            <p className="text-sm text-text-light mb-3">
              Current status: <strong>{me?.cookieConsentAnalytics === false ? 'off' : 'on'}</strong>
            </p>
            <div className="mb-5">
              <Checkbox
                id="consent_analytics"
                checked={consentAnalytics}
                onChange={(e) => setConsentAnalytics(e.target.checked)}
              >
                Allow Google Analytics to help us improve the platform
              </Checkbox>
              <p className="text-sm text-text-light mt-1 ml-7">
                Google, our analytics provider, processes this data on our behalf. We never sell it
                or share it for any other purpose.
              </p>
            </div>
            {saveButton}
          </form>

          <div className="bg-surface rounded-xl shadow p-6 mb-6 overflow-hidden wrap-break-word">
            <h2 className="mt-0">Your Data</h2>
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

          <div className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word">
            <h2 className="mt-0">Privacy Policy</h2>
            <p className="text-text-light mb-4">
              Read our full data practices, GDPR rights, and third-party processor information.
            </p>
            <Link href="/privacy" className="underline font-medium">
              Read Privacy Policy
            </Link>
          </div>
        </div>
      )}

      {activeTab === 'bug-reports' && (
        <div className="max-w-4xl">
          {loadingBugReports ? (
            <div className="text-center py-10 text-text-light">Loading…</div>
          ) : myBugReports.length === 0 ? (
            <p>You haven&apos;t reported anything yet.</p>
          ) : (
            myBugReports.map((r) => (
              <Link
                key={r.id}
                href={`/bugs/${r.id}`}
                className="card block bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word w-full"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="mt-0 mx-0 mb-1">{r.title}</h3>
                    <div className="text-text-light flex gap-2 flex-wrap text-[0.8rem]">
                      {r.category && <span>{r.category}</span>}
                      {r.severity && <span>· {r.severity}</span>}
                      <span>· {r.createdAt ? formatDate(r.createdAt) : ''}</span>
                      {r.assigneeName && <span>· Assigned to: {r.assigneeName}</span>}
                    </div>
                  </div>
                  <Badge variant={BUG_STATUS_VARIANT[r.status] ?? 'neutral'}>
                    {bugStatusLabel(r.status)}
                  </Badge>
                </div>
                <p className="text-text-light mt-0 mx-0 whitespace-pre-wrap">{r.description}</p>
                {r.resolutionNotes && (
                  <p className="mt-3 mx-0 mb-0 text-sm italic">Resolution: {r.resolutionNotes}</p>
                )}
              </Link>
            ))
          )}
        </div>
      )}

      {showDeleteModal && (
        <div
          id="deleteModal"
          role="dialog"
          aria-modal="true"
          aria-label="Delete Account"
          className="fixed inset-0 bg-[rgba(29,53,87,0.5)] flex items-center justify-center z-1000 p-5"
        >
          <div className="bg-surface rounded-xl shadow-lg max-w-125 w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-brand-border flex justify-between items-center">
              <h2 className="m-0 text-xl">Delete Your Account</h2>
            </div>
            <div className="p-6">
              {user.hasPassword && (
                <p className="text-text-light mb-4">
                  This action is permanent and cannot be undone. Please enter your password twice to
                  confirm.
                </p>
              )}
              <form method="post" onSubmit={handleDeleteAccount}>
                {user.hasPassword ? (
                  <>
                    <div className="mb-5">
                      <label htmlFor="delete_password">Enter your password</label>
                      <input
                        type="password"
                        id="delete_password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        required
                      />
                    </div>
                    <div className="mb-5">
                      <label htmlFor="delete_confirm_password">Confirm your password</label>
                      <input
                        type="password"
                        id="delete_confirm_password"
                        value={deleteConfirmPassword}
                        onChange={(e) => setDeleteConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-text-light mb-4">
                      This action is permanent and cannot be undone.
                    </p>
                    <p className="text-text-light mb-4">
                      Type <strong>DELETE</strong> to confirm.
                    </p>
                    <div className="mb-5">
                      <input
                        type="text"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        placeholder="DELETE"
                        required
                      />
                    </div>
                  </>
                )}
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" disabled={deleteAccountMutation.isPending}>
                    {deleteAccountMutation.isPending ? 'Deleting…' : 'Permanently Delete Account'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setShowDeleteModal(false)
                      setDeletePassword('')
                      setDeleteConfirmPassword('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
