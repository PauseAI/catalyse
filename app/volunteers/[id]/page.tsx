'use client'

import { use } from 'react'
import { useRequireAuth } from '@/lib/hooks/auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import Button from '@/components/Button'
import { Badge } from '@/components/Badge'
import { STATUS_LABELS, projectStatusVariant } from '@/components/ProjectCard'
import ContactButton from '@/components/ContactButton'
import ActiveDot from '@/components/ActiveDot'
import Linkify from '@/components/Linkify'
import { useToast } from '@/lib/toast'
import { volunteerLocation } from '@/lib/filter-options'
import { orpc } from '@/lib/orpc'

export default function VolunteerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, loading } = useRequireAuth()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const respond = useMutation({
    ...orpc.contacts.respond.mutationOptions(),
    onSuccess: (_data, variables) => {
      showToast(
        variables.accept
          ? 'Connected. You can now message each other.'
          : 'Request declined. They are not told.',
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: orpc.volunteers.getById.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.notifications.key() })
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to answer the request', 'error'),
  })

  const {
    data: volunteer,
    isLoading: loadingProfile,
    isError,
  } = useQuery({
    ...orpc.volunteers.getById.queryOptions({ input: { id: parseInt(id, 10) } }),
    enabled: !!user,
  })

  if (loading || !user) return null

  if (loadingProfile) {
    return (
      <>
        <main className="container py-5 pb-15">
          <div className="text-center py-10 text-text-light">Loading profile…</div>
        </main>
      </>
    )
  }

  if (isError || !volunteer) {
    return (
      <>
        <main className="container py-5 pb-15">
          <p className="text-error">Volunteer not found.</p>
          <Button href="/volunteers" variant="secondary" className="mt-4">
            Back to Volunteers
          </Button>
        </main>
      </>
    )
  }

  const skills = volunteer.skills ?? []
  const endorsements = volunteer.endorsements ?? []
  const endorsedSkillIds = new Set(endorsements.map((e) => e.skillId))
  const isMe = volunteer.id === user.id
  const incoming = volunteer.incomingContactRequest

  return (
    <>
      <main className="container py-5 pb-15">
        <div className="mb-5">
          <Link href="/volunteers" className="text-text-light">
            &larr; Back to Volunteers
          </Link>
        </div>

        <div id="profileContent">
          {incoming && (
            <section
              aria-label="Contact request"
              className="bg-surface rounded-xl shadow p-6 mb-4 border-l-4 border-primary"
            >
              <h2 className="text-lg m-0 mb-2">{volunteer.name} would like to connect</h2>
              <p className="m-0 mb-3 whitespace-pre-wrap">
                <Linkify text={incoming.message} />
              </p>
              <p className="text-sm text-text-light m-0 mb-3">
                Accepting lets you both see each other&apos;s contact details and message each
                other. Declining is quiet: they are not told.
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ id: incoming.id, accept: true })}
                >
                  Accept
                </Button>
                <Button
                  variant="secondary"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ id: incoming.id, accept: false })}
                >
                  Decline
                </Button>
              </div>
            </section>
          )}
          <div className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word">
            <div className="flex items-center mb-2">
              <h1 id="volunteerName" className="m-0">
                {volunteer.name}
              </h1>
              {volunteer.activeRecently && <ActiveDot />}
            </div>

            {volunteerLocation(volunteer) && (
              <p className="text-text-light mb-4 text-sm">📍 {volunteerLocation(volunteer)}</p>
            )}

            <div id="volunteerBio" className="whitespace-pre-wrap mb-5">
              {volunteer.bio || <em className="text-text-light">No bio provided</em>}
            </div>

            <h3>Skills</h3>
            <div id="volunteerSkills" className="flex flex-wrap gap-1.5 mb-5">
              {skills.length > 0 ? (
                skills.map((s) => (
                  <span
                    key={s.id}
                    className={`inline-flex items-center px-3 py-1 bg-accent text-secondary-dark rounded-full text-sm font-medium dark:bg-gray-700 dark:text-gray-300${endorsedSkillIds.has(s.id) ? ' matched' : ''}`}
                  >
                    {s.name}
                    {endorsedSkillIds.has(s.id) ? ' ✓' : ''}
                  </span>
                ))
              ) : (
                <em className="text-text-light">No skills listed</em>
              )}
            </div>

            {volunteer.otherSkills && (
              <div className="mb-5">
                <h4 className="text-text-light">Other Skills</h4>
                <p>{volunteer.otherSkills}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mt-5 max-[600px]:grid-cols-1">
              {volunteer.availabilityHoursPerWeek && (
                <div>
                  <h4 className="text-text-light">Availability</h4>
                  <p id="availabilityText">{volunteer.availabilityHoursPerWeek} hours/week</p>
                </div>
              )}

              {!isMe && (
                <div id="contactInfo">
                  <h4 className="text-text-light">Contact</h4>
                  <div>
                    {volunteer.discordHandle && <div>Discord: {volunteer.discordHandle}</div>}
                    {volunteer.signalNumber && <div>Signal: {volunteer.signalNumber}</div>}
                    {volunteer.whatsappNumber && <div>WhatsApp: {volunteer.whatsappNumber}</div>}
                    {volunteer.contactNotes && (
                      <div>
                        <em>{volunteer.contactNotes}</em>
                      </div>
                    )}
                    <div className="mt-2">
                      <ContactButton
                        volunteerId={volunteer.id}
                        name={volunteer.name}
                        canMessage={volunteer.canMessage}
                        canRequestContact={volunteer.canRequestContact}
                        contactRequested={volunteer.contactRequested}
                      />
                      {!volunteer.canMessage &&
                        !volunteer.canRequestContact &&
                        !volunteer.contactRequested && (
                          <p className="text-sm text-text-light m-0">
                            You can reach them once you work on a project together.
                          </p>
                        )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {endorsements.length > 0 && (
            <div
              id="endorsementsSection"
              className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word"
            >
              <h2>Verified Skills</h2>
              <p className="text-text-light mb-3">
                Skills verified through completed work on the platform.
              </p>
              <div id="endorsementsList" className="flex flex-wrap gap-1.5">
                {endorsements.map((e) => (
                  <span
                    key={e.skillId}
                    className={`inline-flex items-center px-3 py-1 bg-accent text-secondary-dark rounded-full text-sm font-medium dark:bg-gray-700 dark:text-gray-300 border-l-[3px] ${e.rating === 'strong' ? 'border-l-success' : 'border-l-secondary'}`}
                  >
                    {e.skillName}{' '}
                    <small className={e.rating === 'strong' ? 'text-success' : 'text-text-light'}>
                      {e.rating}
                    </small>
                  </span>
                ))}
              </div>
            </div>
          )}

          {volunteer.completedTasks.length > 0 && (
            <div className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word">
              <h2>Completed Quick Tasks</h2>
              {volunteer.completedTasks.map((t, i) => (
                <div key={i} className="py-3 border-b border-brand-border">
                  <div className="flex justify-between items-center">
                    <strong>{t.title}</strong>
                    <span
                      className={`text-sm font-medium ${t.reviewRating === 'excellent' ? 'text-success' : 'text-text-light'}`}
                    >
                      {t.reviewRating}
                    </span>
                  </div>
                  {t.skillName && (
                    <span className="inline-flex items-center px-3 py-1 bg-accent text-secondary-dark rounded-full text-sm font-medium dark:bg-gray-700 dark:text-gray-300 mt-1">
                      {t.skillName}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {volunteer.projects.length > 0 && (
            <div className="bg-surface rounded-xl shadow p-6 mb-4 overflow-hidden wrap-break-word">
              <h2>Project History</h2>
              {volunteer.projects.map((p) => (
                <div key={p.id} className="py-3 border-b border-brand-border">
                  <div className="flex justify-between items-center">
                    <Link href={`/projects/${p.id}`} className="font-semibold text-primary-dark">
                      {p.title}
                    </Link>
                    <Badge variant={projectStatusVariant(p.status)}>
                      {STATUS_LABELS[p.status] ?? p.status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <p className="text-sm text-text-light mt-1">
                    {p.role === 'owner' ? 'Project owner' : 'Proposer'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
