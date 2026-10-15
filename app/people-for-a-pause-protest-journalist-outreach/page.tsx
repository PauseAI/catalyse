'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ORPCError } from '@orpc/client'
import { client } from '@/lib/client'
import { useToast } from '@/lib/toast'
import { useAuth } from '@/lib/auth-context'
import {
  CLAIM_MINUTES,
  OUTREACH_SESSION_EXPIRED,
  OUTREACH_TOKEN_STORAGE_KEY,
  PRESS_EMAIL,
  canSwitchTemplate,
  composeLinks,
  fullName,
  otherLeaning,
  renderEmail,
} from '@/lib/journalist-outreach'
import Button from '@/components/Button'
import Modal from '@/components/ui/Modal'
import { Badge } from '@/components/Badge'

// Kept only in this browser, so volunteers don't retype them; never sent to the server.
const NAME_STORAGE_KEY = 'outreachName'
const PHONE_STORAGE_KEY = 'outreachPhone'

type Task = NonNullable<Awaited<ReturnType<typeof client.journalistOutreach.claimNext>>>
type Leaning = Task['leaning']

const card = 'bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word'

function RequestLinkForm({ onSignIn }: { onSignIn: (token: string) => void }) {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const mutation = useMutation({
    mutationFn: (email: string) => client.journalistOutreach.requestLink({ email }),
  })
  const catalyseSignIn = useMutation({
    mutationFn: () => client.journalistOutreach.catalyseSignIn(),
    onSuccess: (res) => onSignIn(res.token),
  })

  if (mutation.isSuccess) {
    return (
      <div className={`${card} text-center`}>
        <h3>Check your inbox</h3>
        <p className="text-text-light my-4">
          We&apos;ve sent a sign-in link to <strong>{email}</strong>. It expires in an hour.
        </p>
        <Button variant="ghost" onClick={() => mutation.reset()}>
          Use a different email
        </Button>
      </div>
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate(email)
  }

  return (
    <form className={card} onSubmit={handleSubmit}>
      <p className="mb-4">
        Help get People for a Pause in the news. We&apos;ll give you one journalist at a time and a
        ready-made email to send them from your own address.
      </p>
      {user && (
        <div className="bg-brand-bg rounded-lg p-3 mb-4 text-sm">
          <p className="mb-2">You&apos;re logged in to Catalyse, so you can skip the link.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={catalyseSignIn.isPending}
            onClick={() => catalyseSignIn.mutate()}
          >
            Continue as {user.email}
          </Button>
        </div>
      )}
      {(mutation.error ?? catalyseSignIn.error) && (
        <p role="alert" className="text-error mb-4">
          {(mutation.error ?? catalyseSignIn.error)?.message}
        </p>
      )}
      <div className="mb-5">
        <label htmlFor="outreach-email" className="required">
          Your email
        </label>
        <input
          id="outreach-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <p className="text-sm text-text-light mt-1">
          We only use this to send you a sign-in link and to keep track of who emailed whom.
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Sending…' : 'Send me a link'}
      </Button>
    </form>
  )
}

function CopyField({
  label,
  value,
  html,
  children,
}: {
  label: string
  value: string
  /** When given, copied alongside the plain text so pasting into a mail client keeps links. */
  html?: string
  /** Rendered in place of the plain value, in a multi-line box. */
  children?: React.ReactNode
}) {
  const showToast = useToast()
  const copy = () =>
    (html && typeof ClipboardItem !== 'undefined'
      ? navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([value], { type: 'text/plain' }),
          }),
        ])
      : navigator.clipboard.writeText(value)
    ).then(
      () => showToast(`${label} copied`, 'success'),
      () => showToast(`Couldn't copy — select the text instead`, 'error'),
    )
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{label}</span>
        <Button size="sm" variant="ghost" onClick={copy} aria-label={`Copy ${label}`}>
          Copy
        </Button>
      </div>
      {children ? (
        <pre className="whitespace-pre-wrap font-sans bg-brand-bg rounded-lg p-3 text-sm">
          {children}
        </pre>
      ) : (
        <div className="bg-brand-bg rounded-lg px-3 py-2 text-sm">{value}</div>
      )}
    </div>
  )
}

function useSecondsLeft(until: Date) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [until])
  return Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000))
}

const LEANING_LABEL: Record<Leaning, string> = {
  REPUBLICAN: 'Republican',
  DEMOCRAT: 'Democrat',
}

function TaskCard({
  task,
  templateLeaning,
  sender,
  onSwitchTemplate,
  onSent,
  onSkip,
  onExpired,
}: {
  task: Task
  templateLeaning: Leaning
  sender: { name: string; phone: string }
  onSwitchTemplate: () => void
  onSent: () => void
  onSkip: () => void
  onExpired: (task: Task) => void
}) {
  const [confirming, setConfirming] = useState(false)
  // Written for this journalist only; the card is remounted for the next one.
  const [intro, setIntro] = useState('')
  const cancelConfirm = () => setConfirming(false)
  const secondsLeft = useSecondsLeft(task.claimExpiresAt)
  const expired = secondsLeft === 0
  const switched = templateLeaning !== task.leaning
  const { subject, body, html, parts } = renderEmail(
    { ...task, leaning: templateLeaning },
    { ...sender, intro },
  )
  const links = composeLinks(task.email, subject, body)

  useEffect(() => {
    if (expired) onExpired(task)
  }, [expired, onExpired, task])

  const mm = Math.floor(secondsLeft / 60)
  const ss = String(secondsLeft % 60).padStart(2, '0')
  const name = fullName(task)

  return (
    <div className={card}>
      <div className="mb-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0">{name}</h2>
          <span className="text-sm text-text-light whitespace-nowrap" aria-label="Time left">
            {`${mm}:${ss} left`}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
          <p className="text-text-light m-0">
            {task.organisation}
            {task.medium && ` · ${task.medium}`}
            {task.website && (
              <>
                {' · '}
                <a href={task.website} target="_blank" rel="noreferrer">
                  Website
                </a>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={task.leaning === 'REPUBLICAN' ? 'danger' : 'info'}>
              {LEANING_LABEL[task.leaning]}-leaning
            </Badge>
            {task.leaningConfidence && (
              <Badge variant="neutral">{task.leaningConfidence.toLowerCase()} confidence</Badge>
            )}
          </div>
        </div>
      </div>
      {task.interests && <p className="text-sm mb-2">Covers: {task.interests}</p>}
      {task.notes && <p className="text-sm mb-4">Note: {task.notes}</p>}

      {canSwitchTemplate(task.leaningConfidence) && (
        <div className="bg-brand-bg rounded-lg p-3 mb-4 text-sm">
          <p className="mb-2">
            {switched
              ? `You're using the ${LEANING_LABEL[templateLeaning]} template.`
              : `We're not sure ${fullName(task)} leans ${LEANING_LABEL[task.leaning]}.`}{' '}
            Skim a recent piece of theirs; if the other template fits better, switch.
          </p>
          <Button size="sm" variant="outline" onClick={onSwitchTemplate}>
            {switched
              ? `Switch back to the ${LEANING_LABEL[task.leaning]} template`
              : `Use the ${LEANING_LABEL[otherLeaning(task.leaning)]} template instead`}
          </Button>
        </div>
      )}

      <ol className="list-decimal pl-5 mb-4 text-sm space-y-1">
        <li>
          Send this <strong>from your own email address</strong>.
        </li>
        <li>
          CC <strong>{PRESS_EMAIL}</strong>.
        </li>
        <li>Make it yours with a personal opening sentence below.</li>
        <li>
          If {name} replies and drops {PRESS_EMAIL} from the thread, add it back in.
        </li>
      </ol>

      <div className="mb-4">
        <label htmlFor="outreach-intro">Your personal opening sentence</label>
        <textarea
          id="outreach-intro"
          rows={3}
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          placeholder={`Perhaps pick up on other AI articles ${task.organisation} has covered, or whether ${name} has written about AI extinction risk.`}
        />
        {!intro.trim() && (
          <p className="text-sm text-warning-text mt-1 mb-0">
            No personal opening yet. The email starts straight after “Dear {task.firstName},” until
            you add one.
          </p>
        )}
        <p className="text-sm text-text-light mt-1">
          Only used to fill in this email. It isn&apos;t saved or sent to our server.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Button size="sm" variant="outline" href={links.mailto}>
          Open in mail app
        </Button>
        <Button size="sm" variant="outline" href={links.gmail} target="_blank" rel="noreferrer">
          Open in Gmail
        </Button>
        <Button size="sm" variant="outline" href={links.outlook} target="_blank" rel="noreferrer">
          Open in Outlook
        </Button>
      </div>

      <CopyField label="To" value={task.email} />
      <CopyField label="CC" value={PRESS_EMAIL} />
      <CopyField label="Subject" value={subject} />
      <CopyField label="Body" value={body} html={html}>
        {parts.map((p, i) =>
          typeof p === 'string' ? (
            p
          ) : (
            <a key={i} href={p.url} target="_blank" rel="noreferrer">
              {p.text}
            </a>
          ),
        )}
      </CopyField>
      <p className="text-sm text-text-light -mt-2 mb-3">
        Tip: use Copy and paste into your email to keep the links. The open-in-mail buttons can only
        carry plain text, so links appear as web addresses there.
      </p>

      <div className="flex flex-wrap justify-between gap-2 mt-5">
        <Button variant="ghost" onClick={onSkip}>
          Skip this journalist
        </Button>
        <Button onClick={() => setConfirming(true)}>I have sent it</Button>
      </div>

      <Modal
        id="confirm-sent"
        title="Definitely sent?"
        isOpen={confirming && !expired}
        onClose={cancelConfirm}
      >
        <p className="mb-4">
          We&apos;ll mark {name} as contacted so nobody else emails them. Only confirm once the
          email has gone, with {PRESS_EMAIL} in CC.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={cancelConfirm}>
            Not yet
          </Button>
          <Button
            onClick={() => {
              setConfirming(false)
              onSent()
            }}
          >
            Yes, it&apos;s sent
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function Outreach({ onSignOut }: { onSignOut: () => void }) {
  const showToast = useToast()
  const [name, setName] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem(NAME_STORAGE_KEY) ?? '') : '',
  )
  const [phone, setPhone] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem(PHONE_STORAGE_KEY) ?? '') : '',
  )
  const [justSent, setJustSent] = useState<number | null>(null)
  const [lastSent, setLastSent] = useState<{ id: number; name: string } | null>(null)
  const [expiredTask, setExpiredTask] = useState<Task | null>(null)
  const closeExpired = () => setExpiredTask(null)
  const [exhausted, setExhausted] = useState(false)
  // Keyed by journalist so a switch never carries over to the next task.
  const [switchedTemplateFor, setSwitchedTemplateFor] = useState<number | null>(null)
  const templateLeaning = (t: Task): Leaning =>
    switchedTemplateFor === t.id ? otherLeaning(t.leaning) : t.leaning

  const current = useQuery({
    queryKey: ['journalistOutreach', 'current'],
    queryFn: () => client.journalistOutreach.current(),
    retry: false,
  })
  const sessionExpired =
    current.error instanceof ORPCError && current.error.code === OUTREACH_SESSION_EXPIRED
  useEffect(() => {
    if (sessionExpired) onSignOut()
  }, [sessionExpired, onSignOut])

  const onError = (err: Error) => showToast(err.message, 'error')

  const claim = useMutation({
    mutationFn: () => client.journalistOutreach.claimNext(),
    onSuccess: (task) => {
      setJustSent(null)
      setLastSent(null)
      setExpiredTask(null)
      setExhausted(task === null)
      return current.refetch()
    },
    onError,
  })
  const markSent = useMutation({
    mutationFn: (t: Task) =>
      client.journalistOutreach.markSent({ journalistId: t.id, sentLeaning: templateLeaning(t) }),
    onSuccess: (res, t) => {
      setExpiredTask(null)
      setJustSent(res.contactedCount)
      setLastSent({ id: t.id, name: fullName(t) })
      return current.refetch()
    },
    onError,
  })
  const reportBounce = useMutation({
    mutationFn: (journalistId: number) => client.journalistOutreach.reportBounce({ journalistId }),
    onSuccess: () => {
      setLastSent(null)
      showToast('Thanks, flagged for review', 'success')
    },
    onError,
  })
  const release = useMutation({
    mutationFn: (journalistId: number) => client.journalistOutreach.release({ journalistId }),
    onSuccess: () => current.refetch(),
    onError,
  })

  const task = current.data?.task ?? null
  const { mutate: releaseClaim } = release
  const handleExpired = useCallback(
    (expired: Task) => {
      setExpiredTask(expired)
      releaseClaim(expired.id)
    },
    [releaseClaim],
  )

  const saveName = (value: string) => {
    setName(value)
    localStorage.setItem(NAME_STORAGE_KEY, value)
  }
  const savePhone = (value: string) => {
    setPhone(value)
    localStorage.setItem(PHONE_STORAGE_KEY, value)
  }

  if (current.isPending) return <p className="text-center py-10 text-text-light">Loading…</p>
  if (!current.data) return null
  const { email, contactedCount, availableCount } = current.data

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 text-sm text-text-light">
        <span>
          Signed in as {email} · you&apos;ve contacted {contactedCount}
        </span>
        <Button size="sm" variant="ghost" onClick={onSignOut}>
          Sign out
        </Button>
      </div>

      <div className={card}>
        <div className="mb-4">
          <label htmlFor="outreach-name" className="required">
            Your name (signs the email)
          </label>
          <input
            id="outreach-name"
            value={name}
            onChange={(e) => saveName(e.target.value)}
            placeholder="Jane Smith"
            maxLength={100}
          />
        </div>
        <label htmlFor="outreach-phone">Your phone number (optional)</label>
        <input
          id="outreach-phone"
          type="tel"
          value={phone}
          onChange={(e) => savePhone(e.target.value)}
          placeholder="Only if you're happy for journalists to call you"
          maxLength={40}
        />
        <p className="text-sm text-text-light mt-2 mb-0">
          Your name and phone number are only used to fill in the email on this page. They&apos;re
          remembered in this browser so you don&apos;t have to retype them, and are never sent to or
          stored on our server.
        </p>
      </div>

      {task ? (
        <TaskCard
          key={task.id}
          task={task}
          templateLeaning={templateLeaning(task)}
          sender={{ name, phone }}
          onSwitchTemplate={() =>
            setSwitchedTemplateFor(switchedTemplateFor === task.id ? null : task.id)
          }
          onSent={() => markSent.mutate(task)}
          onSkip={() => release.mutate(task.id)}
          onExpired={handleExpired}
        />
      ) : (
        <div className={`${card} text-center`}>
          {justSent !== null && (
            <>
              <h3>Thank you!</h3>
              <p className="my-2">
                That&apos;s {justSent} journalist{justSent === 1 ? '' : 's'} you&apos;ve contacted.
              </p>
              {lastSent && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={reportBounce.isPending}
                  onClick={() => reportBounce.mutate(lastSent.id)}
                >
                  It bounced / wrong email for {lastSent.name}
                </Button>
              )}
            </>
          )}
          {exhausted ? (
            <p className="text-text-light my-4">
              Every journalist is taken right now. Check back later — claims expire after{' '}
              {CLAIM_MINUTES} minutes.
            </p>
          ) : (
            <p className="text-text-light my-4">
              {availableCount} journalist{availableCount === 1 ? '' : 's'} waiting. You&apos;ll have{' '}
              {CLAIM_MINUTES} minutes to send each email.
            </p>
          )}
          <Button onClick={() => claim.mutate()} disabled={claim.isPending || !name.trim()}>
            {justSent !== null ? 'Do another' : 'Get a journalist'}
          </Button>
          {!name.trim() && <p className="text-sm text-text-light mt-2">Add your name first.</p>}
        </div>
      )}

      <Modal
        id="claim-expired"
        title="Journalist released"
        isOpen={expiredTask !== null}
        onClose={closeExpired}
      >
        <p className="mb-4">
          It&apos;s been {CLAIM_MINUTES} minutes, so we&apos;ve released{' '}
          {expiredTask && fullName(expiredTask)} back to other volunteers. Would you like to
          continue?
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => expiredTask && markSent.mutate(expiredTask)}>
            I already sent it
          </Button>
          <Button variant="ghost" onClick={closeExpired}>
            Done for now
          </Button>
          <Button onClick={() => claim.mutate()} disabled={!name.trim() || release.isPending}>
            Get another
          </Button>
        </div>
      </Modal>
    </>
  )
}

export default function JournalistOutreachPage() {
  const [token, setToken] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(OUTREACH_TOKEN_STORAGE_KEY) : null,
  )
  const signOut = useCallback(() => {
    localStorage.removeItem(OUTREACH_TOKEN_STORAGE_KEY)
    setToken(null)
  }, [])
  const signIn = (t: string) => {
    localStorage.setItem(OUTREACH_TOKEN_STORAGE_KEY, t)
    setToken(t)
  }

  const status = useQuery({
    queryKey: ['journalistOutreach', 'status'],
    queryFn: () => client.journalistOutreach.status(),
  })

  return (
    <main className="container py-5 pb-15">
      <div className="max-w-[720px] my-10 mx-auto">
        <h1 className="text-center">People for a Pause: journalist outreach</h1>
        {status.data?.paused ? (
          <div className={`${card} text-center`}>
            <p className="my-2">
              We&apos;re adjusting our approach to contacting journalists. Come back soon.
            </p>
          </div>
        ) : token ? (
          <Outreach onSignOut={signOut} />
        ) : (
          <RequestLinkForm onSignIn={signIn} />
        )}
      </div>
    </main>
  )
}
