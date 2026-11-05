import Link from 'next/link'
import Button from '@/components/Button'
import { H2, H3 } from '@/components/Heading'
import SectionCard from '@/components/SectionCard'
import { P } from '@/components/Text'
import TrackRecord from '@/components/TrackRecord'
import { plural } from '@/lib/plural'

// Things anyone can do for PauseAI without an approved Catalyse account. The links are
// PauseAI's own evergreen pages, so they stay right as campaigns and events come and go.
const SUPPORTER_ACTIONS: { title: string; detail: string; href: string; action: string }[] = [
  {
    title: 'Sign the PauseAI statement',
    detail: 'Add your name to the call for an international treaty to pause frontier AI.',
    href: 'https://pauseai.info/statement',
    action: 'Sign',
  },
  {
    title: 'Email your representatives',
    detail: 'Our email builder helps you write to your elected representatives in ten minutes.',
    href: 'https://pauseai.info/email-builder',
    action: 'Write',
  },
  {
    title: 'Join the PauseAI Discord',
    detail: 'Meet other volunteers and see what the movement is talking about today.',
    href: 'https://discord.gg/2XXWXvErfA',
    action: 'Join',
  },
  {
    title: 'Find a local group or event',
    detail: 'Meetups, flyering, letter-writing nights and protests near you.',
    href: 'https://pauseai.info/communities',
    action: 'Find',
  },
]

const TOUR: { title: string; body: string }[] = [
  {
    title: 'Projects',
    body: 'Campaigns, policy, organising and creative work, each run by a volunteer owner. Join one that fits your skills, or propose your own.',
  },
  {
    title: 'Quick tasks',
    body: 'Small, self-contained jobs you can pick up and finish in an evening, like a design, a translation or some research.',
  },
  {
    title: 'Teams and local groups',
    body: 'Standing teams look after ongoing work, and local groups organise in person. Your home page gathers everything you are part of.',
  },
]

export interface Waiting {
  projects: number
  matching: number
  quickTasks: number
}

/** "12 projects (3 using your skills) and 5 quick tasks", or null when nothing is open. */
function waitingSummary({ projects, matching, quickTasks }: Waiting): string | null {
  const parts = [
    projects > 0 &&
      `${plural(projects, 'project')} looking for volunteers${matching > 0 ? ` (${matching} using your skills)` : ''}`,
    quickTasks > 0 && plural(quickTasks, 'quick task'),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' and ') : null
}

/**
 * Home for someone whose application is still waiting on a review: what they can do for
 * PauseAI meanwhile, what Catalyse holds for them, and what PauseAI's work has achieved.
 */
export default function ApplicantWelcome({
  name,
  chapterName,
  waiting,
  hasSkills,
}: {
  name: string
  chapterName: string | null
  waiting: Waiting
  hasSkills: boolean
}) {
  const firstName = name.trim().split(/\s+/)[0]
  const summary = waitingSummary(waiting)
  return (
    <div className="flex flex-col gap-6 mb-8">
      <SectionCard
        title={firstName ? `Thanks for applying, ${firstName}!` : 'Thanks for applying!'}
        description="A member of the team usually reviews applications within a few days, and we email you when yours is approved. You don't have to wait to start helping, though."
      >
        {summary && (
          <P className="rounded-md bg-accent/50 px-3 py-2 mb-4 text-sm">
            <strong>Waiting for you{chapterName ? ` in ${chapterName}` : ''}:</strong> {summary}.
          </P>
        )}
        <H3 id="supporter-actions" className="text-lg">
          Things you can do today
        </H3>
        <ul aria-labelledby="supporter-actions" className="list-none p-0 m-0">
          {SUPPORTER_ACTIONS.map((a) => (
            <li
              key={a.href}
              className="flex items-center justify-between gap-3 py-3 border-b border-brand-border last:border-0"
            >
              <div className="min-w-0">
                <strong>{a.title}</strong>
                <P className="text-sm text-text-light m-0 mt-1">{a.detail}</P>
              </div>
              <Button
                href={a.href}
                target="_blank"
                rel="noopener noreferrer"
                size="sm"
                variant="secondary"
                aria-label={`${a.title} (opens in a new tab)`}
              >
                {a.action}
              </Button>
            </li>
          ))}
        </ul>
        <P className="text-sm text-text-light mt-4 mb-0">
          {hasSkills ? (
            <>
              Your{' '}
              <Link className="text-primary-text underline" href="/settings">
                skills and availability
              </Link>{' '}
              decide which projects we suggest to you first. Keep them up to date.
            </>
          ) : (
            <>
              <Link className="text-primary-text underline" href="/settings">
                Add your skills
              </Link>{' '}
              so the projects that need them are waiting at the top of your list.
            </>
          )}
        </P>
      </SectionCard>

      <section aria-labelledby="catalyse-tour">
        <H2 id="catalyse-tour">What you&apos;ll find here</H2>
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-5 list-none p-0 m-0">
          {TOUR.map((step) => (
            <li
              key={step.title}
              className="bg-surface border border-brand-border rounded-xl p-4 sm:p-6"
            >
              <H3 className="text-lg mb-2">{step.title}</H3>
              <P className="text-sm text-text-light mb-0">{step.body}</P>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="track-record">
        <H2 id="track-record">What PauseAI volunteers have done</H2>
        <TrackRecord background="bg-surface" />
      </section>
    </div>
  )
}
