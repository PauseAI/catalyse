'use client'

import { useState, useEffect, useCallback, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Script from 'next/script'
import { useQuery, useMutation } from '@tanstack/react-query'
import Button from '@/components/Button'
import FilterDropdown, { useFilterOptions } from '@/components/FilterDropdown'
import Radio from '@/components/Radio'
import SignupSkills from '@/components/SignupSkills'
import { useAuth } from '@/lib/auth-context'
import { orpc } from '@/lib/orpc'
import {
  COUNTRY_OPTIONS,
  NO_LOCAL_GROUP,
  buildLocalGroupOptionsForCountry,
  type LocalGroupOption,
} from '@/lib/filter-options'

interface SelectedSkill {
  skillId: number
  proficiencyLevel: string
}

// Holds the verified Google identity between the initial "Sign up with Google" click
// and the application form submission. No volunteer row exists yet at this point — it's
// only created once completeGoogleSignup succeeds, so an abandoned application never
// leaves a blank ghost row in the admin queue.
interface PendingGoogleAuth {
  credential?: string
  stub?: boolean
  name: string
  email: string
}

// Each step reads its fields from the submitted DOM via FormData rather than React state,
// so browser/password-manager autofill that sets input.value without firing a React-visible
// change event can't silently drop a value (autofill bypasses onChange, but never bypasses
// what's actually in the DOM at submit time).
function textField(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

const DRAFT_KEY = 'signup_draft'
const STEPS = ['Account', 'About you', 'Skills and privacy'] as const
type Step = 1 | 2 | 3

type ContactMethod = 'email' | 'discord' | 'signal' | 'whatsapp'

function PreferredRadio({
  method,
  contactPref,
  onPrefChange,
  disabled,
}: {
  method: ContactMethod
  contactPref: string
  onPrefChange: (v: ContactMethod) => void
  disabled?: boolean
}) {
  return (
    <div className={`mt-1 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <Radio
        name="contactPreference"
        checked={contactPref === method}
        disabled={disabled}
        onChange={() => onPrefChange(method)}
      >
        <span className="text-text-light">Preferred contact method</span>
      </Radio>
    </div>
  )
}

/** Guidance for a field, styled so it can't be mistaken for text already typed into one. */
function FieldHint({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p
      id={id}
      className="flex gap-2 rounded-md bg-accent/50 px-3 py-2 mb-2 text-sm text-text-light"
    >
      <span aria-hidden="true">ℹ</span>
      <span>{children}</span>
    </p>
  )
}

export default function SignupPage() {
  const router = useRouter()
  const { user, loading, setToken } = useAuth()
  const [error, setError] = useState('')
  // The error shows above the form, so pressing Next at the bottom would otherwise hide it.
  useEffect(() => {
    if (error) document.getElementById('signup-error')?.scrollIntoView({ block: 'center' })
  }, [error])
  const [submitting, setSubmitting] = useState(false)
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleStub, setGoogleStub] = useState(false)
  const [skills, setSkills] = useState<SelectedSkill[]>([])
  const [step, setStep] = useState<Step>(1)
  const [restored, setRestored] = useState(false)
  const [draftRecovered, setDraftRecovered] = useState(false)

  // Form fields
  const [applicationPending, setApplicationPending] = useState(false)
  const [pendingGoogleAuth, setPendingGoogleAuth] = useState<PendingGoogleAuth | null>(null)
  const [resendSent, setResendSent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [bio, setBio] = useState('')
  const [discord, setDiscord] = useState('')
  const [signal, setSignal] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [contactPref, setContactPref] = useState<ContactMethod | ''>('')
  const [contactNotes, setContactNotes] = useState('')
  const [availability, setAvailability] = useState('')
  const [location, setLocation] = useState('')
  const [countryValue, setCountryValue] = useState('')
  const [localGroupValue, setLocalGroupValue] = useState('')
  const [otherSkills, setOtherSkills] = useState('')
  const [applicationMessage, setApplicationMessage] = useState('')
  const [consentVisible, setConsentVisible] = useState(true)
  const [consentAnalytics, setConsentAnalytics] = useState(false)
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
    'match',
  )
  const isGoogle = pendingGoogleAuth !== null

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [user, loading, router])

  const { data: localGroupsData } = useQuery(orpc.localGroups.list.queryOptions({ input: {} }))
  const allLocalGroups: LocalGroupOption[] = localGroupsData?.groups ?? []

  // Restore a pending Google identity and the answers so far (both survive a refresh). The
  // password is never kept, so an email sign-up resumes at the first step.
  useEffect(() => {
    let google: PendingGoogleAuth | null = null
    const storedAuth = sessionStorage.getItem('google_pending_auth')
    if (storedAuth) {
      try {
        google = JSON.parse(storedAuth) as PendingGoogleAuth
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPendingGoogleAuth(google)
        setName(google.name)
        setStep(2)
      } catch {
        sessionStorage.removeItem('google_pending_auth')
      }
    }
    const storedDraft = sessionStorage.getItem(DRAFT_KEY)
    if (storedDraft) {
      try {
        const d = JSON.parse(storedDraft) as Record<string, unknown>
        const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '')
        if (!google) setName(str('name'))
        setEmail(str('email'))
        setApplicationMessage(str('applicationMessage'))
        setBio(str('bio'))
        setDiscord(str('discord'))
        setSignal(str('signal'))
        setWhatsapp(str('whatsapp'))
        setContactPref(str('contactPref') as ContactMethod | '')
        setContactNotes(str('contactNotes'))
        setAvailability(str('availability'))
        setLocation(str('location'))
        setCountryValue(str('countryValue'))
        setLocalGroupValue(str('localGroupValue'))
        setOtherSkills(str('otherSkills'))
        if (Array.isArray(d.skills)) setSkills(d.skills as SelectedSkill[])
        if (typeof d.consentVisible === 'boolean') setConsentVisible(d.consentVisible)
        if (typeof d.consentAnalytics === 'boolean') setConsentAnalytics(d.consentAnalytics)
        if (typeof d.emailDigest === 'string') setEmailDigest(d.emailDigest)
        if (google && (d.step === 2 || d.step === 3)) setStep(d.step)
        setDraftRecovered(true)
      } catch {
        sessionStorage.removeItem(DRAFT_KEY)
      }
    }
    setRestored(true)
    // setEmailDigest is stable for this purpose: the draft is read once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the answers so far, without the password, for the length of the browser session.
  useEffect(() => {
    if (!restored || applicationPending) return
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step,
        name,
        email,
        applicationMessage,
        bio,
        discord,
        signal,
        whatsapp,
        contactPref,
        contactNotes,
        availability,
        location,
        countryValue,
        localGroupValue,
        otherSkills,
        skills,
        consentVisible,
        consentAnalytics,
        emailDigest,
      }),
    )
  }, [
    restored,
    applicationPending,
    step,
    name,
    email,
    applicationMessage,
    bio,
    discord,
    signal,
    whatsapp,
    contactPref,
    contactNotes,
    availability,
    location,
    countryValue,
    localGroupValue,
    otherSkills,
    skills,
    consentVisible,
    consentAnalytics,
    emailDigest,
  ])

  // Persist/clear pending Google identity in sessionStorage
  useEffect(() => {
    if (pendingGoogleAuth) {
      sessionStorage.setItem('google_pending_auth', JSON.stringify(pendingGoogleAuth))
    } else {
      sessionStorage.removeItem('google_pending_auth')
    }
  }, [pendingGoogleAuth])

  // Warn before leaving while a Google application is open
  useEffect(() => {
    if (!pendingGoogleAuth) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [pendingGoogleAuth])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const { data: googleClientIdData } = useQuery({
    ...orpc.auth.googleClientId.queryOptions(),
    staleTime: Infinity,
  })
  useEffect(() => {
    if (googleClientIdData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGoogleClientId(googleClientIdData.clientId)
      if (googleClientIdData.stub) setGoogleStub(true)
    }
  }, [googleClientIdData])

  const resendMutation = useMutation({ ...orpc.auth.resendVerification.mutationOptions() })
  const googleAuthMutation = useMutation({
    ...orpc.auth.google.mutationOptions(),
    onSuccess: async (data, variables) => {
      if (data.isPending) {
        setPendingGoogleAuth({
          credential: variables.credential,
          stub: variables.stub,
          name: data.name,
          email: data.email,
        })
        setName(data.name)
        setError('')
        setStep(2)
      } else if (data.token) {
        await setToken(data.token)
        router.push('/dashboard')
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Google sign-up failed'),
  })
  const completeGoogleSignupMutation = useMutation({
    ...orpc.auth.completeGoogleSignup.mutationOptions(),
  })
  const signupMutation = useMutation({ ...orpc.auth.signup.mutationOptions() })

  async function handleResend() {
    await resendMutation.mutateAsync({ email }).catch(() => {})
    setResendSent(true)
    setResendCooldown(60)
  }

  const handleGoogleResponse = useCallback(
    (response: { credential: string }) => {
      googleAuthMutation.mutate({ credential: response.credential })
    },
    [googleAuthMutation],
  )

  function handleGoogleStub() {
    googleAuthMutation.mutate(
      { stub: true },
      {
        onError: (err) => setError(err instanceof Error ? err.message : 'Google stub failed'),
      },
    )
  }

  const localGroupOptions = countryValue
    ? buildLocalGroupOptionsForCountry(countryValue, allLocalGroups)
    : []
  const hasLocalGroups = localGroupOptions.some((o) => o.value && o.value !== NO_LOCAL_GROUP)
  const showCityInput = localGroupValue === NO_LOCAL_GROUP || (!!countryValue && !hasLocalGroups)

  function handleCountryChange(value: string) {
    setCountryValue(value)
    setLocalGroupValue('')
  }

  function goTo(next: Step) {
    setError('')
    setStep(next)
    window.scrollTo?.({ top: 0 })
  }

  function handleAccountStep(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const nameValue = textField(fd, 'name').trim()
    const emailValue = textField(fd, 'email').trim()
    const passwordValue = textField(fd, 'password')
    setName(nameValue)
    setEmail(emailValue)
    setPassword(passwordValue)
    setPasswordConfirm(textField(fd, 'password_confirm'))
    if (!nameValue) return setError('Your name is required')
    if (!/^\S+@\S+\.\S+$/.test(emailValue)) return setError('Enter a valid email address')
    if (passwordValue !== textField(fd, 'password_confirm')) {
      return setError('Passwords do not match')
    }
    if (passwordValue.length < 8) return setError('Password must be at least 8 characters')
    goTo(2)
  }

  function handleAboutStep(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const application = textField(fd, 'applicationMessage')
    const bioValue = textField(fd, 'bio')
    const availabilityValue = textField(fd, 'availabilityHoursPerWeek')
    setApplicationMessage(application)
    setBio(bioValue)
    setDiscord(textField(fd, 'discordHandle'))
    setSignal(textField(fd, 'signalNumber'))
    setWhatsapp(textField(fd, 'whatsappNumber'))
    setContactNotes(textField(fd, 'contactNotes'))
    setAvailability(availabilityValue)
    setLocation(textField(fd, 'location'))
    if (application.trim().length < 20) {
      return setError('Your application must be at least 20 characters')
    }
    if (bioValue.trim().length < 20) return setError('About You must be at least 20 characters')
    if (!availabilityValue) return setError('Availability is required')
    if (!countryValue) return setError('Country is required')
    goTo(3)
  }

  async function handleFinish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    const otherSkillsValue = textField(fd, 'otherSkills')
    setOtherSkills(otherSkillsValue)
    const optional = (v: string) => v || undefined
    // Owners can always reach the people on their project, so sign-up no longer asks; the
    // contact rule itself is settled in R-11.
    const application = {
      applicationMessage,
      bio,
      discordHandle: optional(discord),
      signalNumber: optional(signal),
      whatsappNumber: optional(whatsapp),
      contactPreference: contactPref || undefined,
      contactNotes: optional(contactNotes),
      availabilityHoursPerWeek: Number(availability),
      location: optional(location),
      country: countryValue,
      localGroup:
        localGroupValue && localGroupValue !== NO_LOCAL_GROUP ? localGroupValue : undefined,
      otherSkills: optional(otherSkillsValue),
      skillIds: skills.map((s) => s.skillId),
      consentMakeProfileVisibleInDirectory: consentVisible,
      consentContactableByProjectOwners: true,
      consentShareContactInfoWithProjectOwner: false,
      cookieConsentAnalytics: consentAnalytics,
      emailDigest,
    }

    setSubmitting(true)
    try {
      const data = pendingGoogleAuth
        ? await completeGoogleSignupMutation.mutateAsync({
            credential: pendingGoogleAuth.credential,
            stub: pendingGoogleAuth.stub,
            ...application,
          })
        : await signupMutation.mutateAsync({ name, email, password, ...application })
      sessionStorage.removeItem(DRAFT_KEY)
      if (data.pending) {
        setApplicationPending(true)
      } else if (data.token) {
        sessionStorage.removeItem('google_pending_auth')
        await setToken(data.token)
        router.push('/dashboard')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setSubmitting(false)
    }
  }

  const initGoogleButton = useCallback(() => {
    const win = window as Window &
      typeof globalThis & {
        google?: {
          accounts: {
            id: {
              initialize: (c: unknown) => void
              renderButton: (el: Element | null, opts: unknown) => void
            }
          }
        }
      }
    if (!win.google?.accounts?.id || !googleClientId) return
    win.google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleResponse })
    const btnEl = document.getElementById('g_signup_btn')
    const btnWidth = Math.min(400, Math.max(200, btnEl?.offsetWidth ?? 350))
    win.google.accounts.id.renderButton(btnEl, {
      theme: 'outline',
      size: 'large',
      width: btnWidth,
      text: 'sign_up_with',
    })
  }, [googleClientId, handleGoogleResponse])

  useEffect(() => {
    initGoogleButton()
  }, [initGoogleButton])

  // The About you step, shared by both routes; `prefix` keeps the element ids of the email
  // and Google forms apart. A plain function rather than a component, so its inputs keep
  // focus across the page's re-renders.
  function aboutFields(prefix: string, contactEmail: string) {
    const contactField = (
      method: 'discord' | 'signal' | 'whatsapp',
      label: string,
      name: string,
      value: string,
      setValue: (v: string) => void,
      placeholder: string,
      autoComplete: string,
    ) => (
      <div className="mb-5">
        <label htmlFor={`${prefix}${method}`}>{label}</label>
        <input
          type="text"
          id={`${prefix}${method}`}
          name={name}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (e.target.value.trim() === '' && contactPref === method) setContactPref('')
          }}
        />
        <PreferredRadio
          method={method}
          contactPref={contactPref}
          onPrefChange={setContactPref}
          disabled={value.trim() === ''}
        />
      </div>
    )
    return (
      <>
        <div className="mb-5">
          <label htmlFor={`${prefix}applicationMessage`} className="required">
            Your Application
          </label>
          <FieldHint id={`${prefix}applicationMessage-hint`}>
            Tell us your connection to PauseAI (if you&apos;re already in the WhatsApp or Discord,
            how we know you), why the mission matters to you, and how you&apos;d like to help. Only
            admins read this; it isn&apos;t on your public profile.
          </FieldHint>
          <textarea
            id={`${prefix}applicationMessage`}
            name="applicationMessage"
            autoComplete="off"
            required
            minLength={20}
            rows={6}
            aria-describedby={`${prefix}applicationMessage-hint`}
            placeholder="e.g. I joined the Discord in March and would like to help run local events…"
            value={applicationMessage}
            onChange={(e) => setApplicationMessage(e.target.value)}
          />
        </div>

        <div className="mb-5">
          <label htmlFor={`${prefix}bio`} className="required">
            About You
          </label>
          <FieldHint id={`${prefix}bio-hint`}>
            Shown to other volunteers in the directory if you choose to make your profile visible.
            Tell us about your background and what brings you to PauseAI.
          </FieldHint>
          <textarea
            id={`${prefix}bio`}
            name="bio"
            autoComplete="off"
            required
            minLength={20}
            aria-describedby={`${prefix}bio-hint`}
            placeholder="Your background and what brings you to PauseAI…"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>

        <h3 className="mt-6">Contact Preferences</h3>
        <p className="text-sm text-text-light mt-1 mb-4">
          Add ways for the people you work with to reach you. All optional.
        </p>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
          {contactField(
            'discord',
            'Discord Handle',
            'discordHandle',
            discord,
            setDiscord,
            'username#1234',
            'off',
          )}
          {contactField('signal', 'Signal', 'signalNumber', signal, setSignal, '+44…', 'tel')}
          {contactField(
            'whatsapp',
            'WhatsApp',
            'whatsappNumber',
            whatsapp,
            setWhatsapp,
            '+44…',
            'tel',
          )}
          <div className="mb-5">
            <label htmlFor={`${prefix}email_display`}>Contact Email</label>
            <input
              type="text"
              id={`${prefix}email_display`}
              value={contactEmail}
              placeholder="The email you sign up with"
              disabled
            />
            <PreferredRadio
              method="email"
              contactPref={contactPref}
              onPrefChange={setContactPref}
              disabled={contactEmail.trim() === ''}
            />
          </div>
        </div>

        <div className="mb-5">
          <label htmlFor={`${prefix}contactNotes`}>Contact Notes</label>
          <input
            type="text"
            id={`${prefix}contactNotes`}
            name="contactNotes"
            autoComplete="off"
            placeholder="e.g., Best to DM me on Discord first"
            value={contactNotes}
            onChange={(e) => setContactNotes(e.target.value)}
          />
        </div>

        <h3 className="mt-6">Availability</h3>
        <div className="mb-5">
          <label htmlFor={`${prefix}availability`} className="required">
            Hours per week you can give (1–40)
          </label>
          <input
            type="number"
            id={`${prefix}availability`}
            name="availabilityHoursPerWeek"
            autoComplete="off"
            required
            min={1}
            max={40}
            placeholder="e.g., 5"
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
          />
          <p className="text-sm text-text-light mt-1">
            A rough guess is fine, and you can change it later.
          </p>
        </div>
        <div className="mb-5">
          <FilterDropdown
            id={`${prefix}locationCountry`}
            label="Country"
            ariaLabel="Select country"
            value={countryValue}
            options={COUNTRY_OPTIONS}
            onChange={handleCountryChange}
            searchable
            required
          />
        </div>
        {countryValue && hasLocalGroups && (
          <div className="mb-5">
            <FilterDropdown
              id={`${prefix}locationGroup`}
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
            <label htmlFor={`${prefix}location`}>City / Area</label>
            <input
              type="text"
              id={`${prefix}location`}
              name="location"
              autoComplete="address-level2"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
        )}

        <h3 className="mt-6">Email Notifications</h3>
        <div className="mb-5">
          <FilterDropdown
            id={`${prefix}emailDigest`}
            label="Keep me in the loop about new projects"
            ariaLabel="Keep me in the loop about new projects"
            value={emailDigest}
            options={emailDigestOptions}
            onChange={setEmailDigest}
          />
        </div>
      </>
    )
  }

  const stepIndicator = (
    <ol aria-label="Sign-up steps" className="flex flex-wrap gap-2 list-none p-0 mb-4 text-sm">
      {STEPS.map((label, i) => {
        const n = (i + 1) as Step
        const done = n < step || (n === 1 && isGoogle)
        return (
          <li
            key={label}
            aria-current={n === step ? 'step' : undefined}
            className={`px-3 py-1 rounded-full border ${
              n === step
                ? 'border-primary text-primary font-semibold'
                : done
                  ? 'border-brand-border text-text-light'
                  : 'border-brand-border text-text-light opacity-70'
            }`}
          >
            {done ? '✓ ' : `${n}. `}
            {n === 1 && isGoogle ? 'Account (Google)' : label}
          </li>
        )
      })}
    </ol>
  )

  const errorAlert = error && (
    <div
      id="signup-error"
      role="alert"
      className="flex items-center gap-3 p-4 rounded-lg mb-4 bg-red-100 text-red-800 border border-red-300 dark:bg-red-900 dark:text-red-300 dark:border-red-600"
    >
      {error}
    </div>
  )

  const footer = (
    <p className="text-center text-sm text-text-light mt-6">
      <Link href="/privacy" className="text-text-light">
        Privacy Policy
      </Link>
      {' · '}
      <a href="mailto:matilda@pauseai.info" className="text-text-light">
        Contact Support
      </a>
    </p>
  )

  const formCard = 'bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word'
  const prefix = isGoogle ? 'g_' : ''

  if (loading) return null

  if (applicationPending) {
    return (
      <main className="container py-5 pb-15">
        <div className="max-w-2xl mx-auto">
          {/* role="status" so a screen reader announces that the form went through. */}
          <div role="status" className="bg-surface rounded-xl shadow p-8 text-center">
            <h1>Application received</h1>
            <p className="text-text-light mt-4 mb-2">
              Thanks for applying! A member of the team usually reviews applications within a few
              days, and we email you when yours is approved.
            </p>
            {isGoogle ? (
              <p className="text-text-light">Your Google email is already confirmed.</p>
            ) : (
              <>
                <p className="text-text-light">
                  Meanwhile, confirm your email: we&#39;ve sent a link to {email}.
                </p>
                <div className="mt-6 pt-6 border-t border-border">
                  {resendSent ? (
                    <p className="text-text-light text-sm">
                      {resendCooldown > 0
                        ? `Email sent! You can request another in ${resendCooldown}s.`
                        : 'Email sent! Check your inbox.'}
                    </p>
                  ) : (
                    <p className="text-text-light text-sm">
                      Didn&#39;t receive it?{' '}
                      <button
                        onClick={handleResend}
                        disabled={resendCooldown > 0}
                        className="underline disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Resend confirmation email
                      </button>
                    </p>
                  )}
                </div>
              </>
            )}
            <p className="text-text-light text-sm mt-4">
              Questions? Contact{' '}
              <a href="mailto:uk@pauseai.info" className="underline">
                uk@pauseai.info
              </a>
            </p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <>
      {googleClientId && (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={initGoogleButton}
        />
      )}
      <main className="container py-5 pb-15">
        <div className="max-w-2xl mx-auto">
          <h1>{isGoogle ? 'Complete your application' : 'Join Catalyse'}</h1>
          <p className="text-text-light mb-6">
            {isGoogle
              ? 'Your Google account is verified. Fill in your details to apply.'
              : 'Connect with PauseAI projects and fellow volunteers.'}
          </p>

          {stepIndicator}
          {errorAlert}
          {draftRecovered && !isGoogle && step === 1 && (
            <p className="text-sm text-text-light">
              Your answers so far were kept. Enter your password again to carry on.
            </p>
          )}

          {step === 1 && (googleClientId || googleStub) && (
            <>
              <div className={`${formCard} text-center`}>
                <p className="text-text-light mb-4">Quick sign up with your Google account:</p>
                {googleClientId && <div id="g_signup_btn" className="flex justify-center" />}
                {googleStub && (
                  <button
                    type="button"
                    onClick={handleGoogleStub}
                    className="inline-flex items-center gap-2 border border-border rounded px-4 py-2 text-sm font-medium text-text-light hover:bg-accent transition-colors"
                  >
                    <span>G</span> Sign up with Google (dev stub)
                  </button>
                )}
              </div>
              <div className="flex items-center my-4 gap-4">
                <hr className="flex-1 border-none border-t border-brand-border" />
                <span className="text-text-light text-sm">or sign up with email</span>
                <hr className="flex-1 border-none border-t border-brand-border" />
              </div>
            </>
          )}

          {step === 1 && (
            <form method="post" className={formCard} onSubmit={handleAccountStep} noValidate>
              <h2 className="mt-0">Account</h2>
              <div className="mb-5">
                <label htmlFor="name" className="required">
                  Your Name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  placeholder="How should we call you?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="mb-5">
                <label htmlFor="email" className="required">
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (e.target.value.trim() === '' && contactPref === 'email') setContactPref('')
                  }}
                />
                <p className="text-sm text-text-light mt-1">
                  Used for login and notifications. Not shown publicly. We send a link to confirm it
                  as soon as you apply.
                </p>
              </div>

              <div className="mb-5">
                <label htmlFor="password" className="required">
                  Password
                </label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="mb-5">
                <label htmlFor="password_confirm" className="required">
                  Confirm Password
                </label>
                <input
                  type="password"
                  id="password_confirm"
                  name="password_confirm"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="Type your password again"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                />
              </div>

              <Button type="submit" className="w-full">
                Next: About you
              </Button>
              <p className="text-center text-text-light mt-4">
                Already have an account? <Link href="/login">Login</Link>
              </p>
            </form>
          )}

          {step === 2 && (
            <form className={formCard} onSubmit={handleAboutStep} noValidate>
              <h2 className="mt-0">About you</h2>
              {isGoogle && (
                <div className="mb-5">
                  <label htmlFor="g_name">Your Name</label>
                  <input type="text" id="g_name" value={name} disabled />
                  <p className="text-sm text-text-light mt-1">
                    From your Google account. To use a different name, change it on your Google
                    account or update it later in your profile settings.
                  </p>
                </div>
              )}
              {aboutFields(prefix, pendingGoogleAuth?.email ?? email)}
              <div className="flex gap-2 mt-3">
                {!isGoogle && (
                  <Button type="button" variant="secondary" onClick={() => goTo(1)}>
                    Back
                  </Button>
                )}
                <Button type="submit" className="flex-1">
                  Next: Skills and privacy
                </Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form className={formCard} onSubmit={handleFinish} noValidate>
              <h2 className="mt-0">Skills and privacy</h2>
              <p className="text-sm text-text-light mt-1 mb-3">
                Pick skills you can contribute. This helps match you with projects.
              </p>
              <SignupSkills value={skills} onChange={setSkills} />

              <div className="mb-5 mt-4">
                <label htmlFor={`${prefix}otherSkills`}>Other Skills</label>
                <input
                  type="text"
                  id={`${prefix}otherSkills`}
                  name="otherSkills"
                  autoComplete="off"
                  placeholder="Any skills not listed above…"
                  value={otherSkills}
                  onChange={(e) => setOtherSkills(e.target.value)}
                />
              </div>

              <h3 className="mt-6">Privacy</h3>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="flex items-center gap-2 font-normal m-0">
                    <input
                      type="checkbox"
                      checked={consentVisible}
                      onChange={(e) => setConsentVisible(e.target.checked)}
                    />
                    Show me in the volunteer directory
                  </label>
                  <p className="text-sm text-text-light mt-1 mb-0 ml-6">
                    Other volunteers can find you and ask to see your contact details. Turn this off
                    and they can&apos;t.
                  </p>
                </div>
                <div>
                  <label className="flex items-center gap-2 font-normal m-0">
                    <input
                      type="checkbox"
                      id={`${prefix}consent_analytics`}
                      checked={consentAnalytics}
                      onChange={(e) => setConsentAnalytics(e.target.checked)}
                    />
                    Allow Google Analytics (recommended)
                  </label>
                  <p className="text-sm text-text-light mt-1 mb-0 ml-6">
                    Anonymous usage figures that help us improve the platform.
                  </p>
                </div>
              </div>
              <p className="text-sm text-text-light mt-3">
                People on the projects you join can always reach you. You can change these settings
                or delete your account at any time.{' '}
                <Link href="/privacy" target="_blank">
                  Read our privacy policy
                </Link>
              </p>

              <div className="flex gap-2 mt-3">
                <Button type="button" variant="secondary" onClick={() => goTo(2)}>
                  Back
                </Button>
                <Button type="submit" className="flex-1" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit Application'}
                </Button>
              </div>
            </form>
          )}

          {footer}
        </div>
      </main>
    </>
  )
}
