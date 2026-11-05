import type { Metadata } from 'next'
import Link from 'next/link'
import { H1, H2, H3 } from '@/components/Heading'
import LandingCTA from '@/components/LandingCTA'
import TrackRecord from '@/components/TrackRecord'
import { P } from '@/components/Text'
import TextLink from '@/components/TextLink'

export const metadata: Metadata = {
  title: 'Volunteer with PauseAI',
  description:
    'Catalyse is the volunteer platform for PauseAI. Find campaign, policy, organising and creative work that matches your skills.',
}

/**
 * Public landing page.
 *
 * Deliberately contains no project data. Individual projects are only visible
 * to approved volunteers at /projects; this page describes what the movement
 * does so a prospective volunteer can decide whether to apply.
 */

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Apply',
    body: 'Tell us about your interest in PauseAI, what you’re good at and how much time you have.',
  },
  {
    title: 'Get matched',
    body: 'Once you’re approved you can view open projects. Projects that match your skills or location are highlighted.',
  },
  {
    title: 'Contribute',
    body: 'Start working on something useful to make AI safer! You can also propose your project, if you have an idea you’re excited to work on with other volunteers.',
  },
]

export default function LandingPage() {
  return (
    <main>
      {/* Hero */}
      <section className="border-b border-brand-border bg-surface">
        <div className="container py-14 md:py-20">
          <div className="max-w-3xl mx-auto md:text-center">
            {/*
              No size utilities here: globals.css styles `h1` outside a cascade
              layer, so `text-*` classes on a heading are silently ignored.
            */}
            <H1>Volunteer for PauseAI</H1>
            <P className="text-lg text-text-light mb-8">
              Catalyse is the volunteer platform for PauseAI. It allows anyone to join projects or
              complete tasks that help advance our mission. You can also propose your own projects
              to get help from other volunteers on things that you want to work on.
            </P>
            <div className="md:flex md:justify-center">
              <LandingCTA />
            </div>
            <P className="text-sm text-text-light mt-4 mb-0">
              Already applied?{' '}
              <Link className="text-primary-text underline" href="/login">
                Log in to check your application status
              </Link>
              .
            </P>
          </div>
        </div>
      </section>

      {/* What PauseAI is */}
      <section className="container py-12 md:py-16">
        <div className="max-w-3xl">
          <H2>Who we are</H2>
          <P className="text-text-light">
            PauseAI is a civic movement, which means that we help citizens organise to take
            collective actions and make their voice heard. Our volunteers engage with their elected
            representatives about AI safety, march in protests, join conferences about AI safety and
            gather signatures for open letters.
          </P>
          <P className="text-text-light mb-0">
            PauseAI is focused on the risks of superhuman AI. This focus is the thing that is unique
            about PauseAI and distinguishes us from other movements.
          </P>
        </div>
      </section>

      {/* Track record */}
      <section className="bg-surface border-y border-brand-border">
        <div className="container py-12 md:py-16">
          <div className="max-w-3xl mb-8">
            <H2>Where that work has led</H2>
          </div>
          <TrackRecord />
        </div>
      </section>

      {/* How it works */}
      <section className="container py-12 md:py-16">
        <div className="max-w-3xl mb-8">
          <H2>How Catalyse works</H2>
        </div>
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-5 list-none p-0 m-0">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="bg-brand-bg border border-brand-border rounded-xl p-4 sm:p-6"
            >
              <span
                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-[#111827] font-bold mb-3"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <H3 className="text-lg mb-2">
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </H3>
              <P className="text-sm text-text-light mb-0">{step.body}</P>
            </li>
          ))}
        </ol>
      </section>

      {/* Expectations */}
      <section className="bg-surface border-y border-brand-border">
        <div className="container py-12 md:py-16">
          <div className="max-w-3xl">
            <H2>Before you apply</H2>
            <ul className="text-text-light space-y-2 pl-5 list-disc marker:text-primary">
              <li>
                Applications are reviewed by one of the PauseAI paid staff, so there is a short wait
                before you can access the full site. We will email you either way.
              </li>
              <li>
                There is no minimum commitment. Just an hour here and there can go a long way.
              </li>
              <li>You can control what information other volunteers can see about you.</li>
              <li>
                Catalyse is for coordinating volunteer tasks. To see upcoming events, see the{' '}
                <TextLink href="https://luma.com/PauseAI" target="_blank" rel="noopener noreferrer">
                  calendar
                </TextLink>
                . For other information go to{' '}
                <TextLink href="https://pauseai.info" target="_blank" rel="noopener noreferrer">
                  pauseai.info
                </TextLink>
                .
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="container border-t border-brand-border py-14 md:py-20">
        <div className="max-w-2xl">
          <H2>Ready to start?</H2>
          <P className="text-text-light mb-6">Sign up now to view open projects.</P>
          <LandingCTA />
        </div>
      </section>
    </main>
  )
}
