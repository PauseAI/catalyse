'use client'

import Link from 'next/link'
import { use, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import FilterDropdown from '@/components/FilterDropdown'
import { useRequireStaff } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/format-date'
import { SECTION_CARD } from '@/lib/ui-classes'
import { ChapterAuditAction } from '@/generated/prisma/enums'
import { H1, H2 } from '@/components/Heading'
import { P } from '@/components/Text'
import FormLabel from '@/components/FormLabel'
import Input from '@/components/ui/Input'
import PersonName from '@/components/PersonName'

const ACTION_LABELS: Record<ChapterAuditAction, string> = {
  CHAPTER_CREATED: 'opened the chapter',
  CHAPTER_UPDATED: 'updated the chapter',
  LEAD_APPOINTED: 'made the lead:',
  LEAD_REMOVED: 'removed the lead:',
  DEPUTY_APPOINTED: 'appointed a deputy:',
  DEPUTY_REMOVED: 'removed a deputy:',
  VOLUNTEER_REASSIGNED: 'moved into the chapter:',
  TRANSFER_APPROVED: 'approved a move:',
  TRANSFER_DECLINED: 'declined a move:',
  PROJECT_CHAPTER_CHANGED: 'moved a project',
  TEAM_CHAPTER_CHANGED: 'moved a team',
  ROLE_INVITE_SENT: 'sent a staff invite',
  ROLE_INVITE_ACCEPTED: 'accepted a staff invite:',
  JOINED_FROM_POOL: 'joined from the holding pool',
}

const NONE = ''

/** Muted details after a name, such as the email that tells two same-named accounts apart. */
function Muted({ parts }: { parts: (string | null)[] }) {
  const shown = parts.filter(Boolean)
  if (shown.length === 0) return null
  return <span className="text-text-light text-sm"> · {shown.join(' · ')}</span>
}

/** One chapter's lead, deputies, members and staff invites, and what has changed. */
export default function AdminChapterPage({ params }: { params: Promise<{ id: string }> }) {
  const chapterId = Number(use(params).id)
  const { user, loading } = useRequireStaff()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'LEAD' | 'DEPUTY'>('DEPUTY')

  const { data: chapter, error } = useQuery({
    ...orpc.admin.chapters.get.queryOptions({ input: { chapterId } }),
    enabled: !!user,
  })
  const { data: events = [] } = useQuery({
    ...orpc.admin.chapters.audit.queryOptions({ input: { chapterId } }),
    enabled: !!user,
  })
  const { data: list } = useQuery({
    ...orpc.admin.chapters.list.queryOptions(),
    enabled: !!user?.access.globalAdmin,
  })

  const done = (message: string) => {
    showToast(message, 'success')
    void queryClient.invalidateQueries({ queryKey: orpc.admin.chapters.key() })
  }
  const onError = (err: unknown) =>
    showToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
  const withMessage = { onSuccess: (r: { message: string }) => done(r.message), onError }

  const appointLead = useMutation({
    ...orpc.admin.chapters.appointLead.mutationOptions(),
    ...withMessage,
  })
  const removeLead = useMutation({
    ...orpc.admin.chapters.removeLead.mutationOptions(),
    ...withMessage,
  })
  const appointDeputy = useMutation({
    ...orpc.admin.chapters.appointDeputy.mutationOptions(),
    ...withMessage,
  })
  const removeDeputy = useMutation({
    ...orpc.admin.chapters.removeDeputy.mutationOptions(),
    ...withMessage,
  })
  const reassign = useMutation({
    ...orpc.admin.chapters.reassign.mutationOptions(),
    ...withMessage,
  })
  const invite = useMutation({
    ...orpc.admin.chapters.invite.mutationOptions(),
    onSuccess: (r) => {
      setInviteEmail('')
      done(r.message)
    },
    onError,
  })
  const revokeInvite = useMutation({
    ...orpc.admin.chapters.revokeInvite.mutationOptions(),
    ...withMessage,
  })

  if (loading || !user) return null
  if (error) {
    return (
      <main className="container py-5">
        <H1>Chapter not found</H1>
        <Link className="text-primary-text underline" href="/admin">
          Back to admin
        </Link>
      </main>
    )
  }
  if (!chapter) return null

  const isGlobal = user.access.globalAdmin
  const lead = chapter.members.find((m) => m.role === 'LEAD')
  const deputies = chapter.members.filter((m) => m.role === 'DEPUTY')
  const memberOptions = chapter.members
    .filter((m) => m.role === null && !m.duplicateOf)
    .map((m) => ({ value: String(m.id), label: m.name, description: m.email ?? undefined }))
  const moveOptions = [
    { value: NONE, label: 'Move to…' },
    ...(list?.chapters ?? [])
      .filter((c) => c.id !== chapter.id)
      .map((c) => ({ value: String(c.id), label: c.name })),
    { value: 'pool', label: 'Holding pool' },
  ]

  return (
    <main className="container py-5 pb-15">
      <P className="text-sm m-0">
        <Link
          className="text-primary-text underline"
          href={isGlobal ? '/admin/chapters' : '/admin'}
        >
          {isGlobal ? 'National chapters' : 'Admin'}
        </Link>
      </P>
      <H1>{chapter.name} chapter</H1>

      <section className={`card ${SECTION_CARD} mb-5`}>
        <H2 className="mt-0">Lead</H2>
        {lead ? (
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <span>
              <PersonName id={lead.id} name={lead.name} />
              <Muted parts={[lead.email]} />
            </span>
            {isGlobal && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => removeLead.mutate({ chapterId })}
              >
                Remove as lead
              </Button>
            )}
          </div>
        ) : (
          <P className="text-text-light m-0">No lead yet.</P>
        )}
        {isGlobal && memberOptions.length > 0 && (
          <div className="mt-4">
            <FilterDropdown
              id="appoint-lead"
              label={lead ? 'Make someone else the lead' : 'Appoint a lead'}
              ariaLabel="Appoint a lead"
              value={NONE}
              placeholderLabel="Choose a member"
              options={memberOptions}
              searchable
              onChange={(value) => appointLead.mutate({ chapterId, volunteerId: Number(value) })}
            />
          </div>
        )}
      </section>

      <section className={`card ${SECTION_CARD} mb-5`}>
        <H2 className="mt-0">Deputies</H2>
        {deputies.length === 0 ? (
          <P className="text-text-light m-0">No deputies.</P>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-2">
            {deputies.map((d) => (
              <li key={d.id} className="flex justify-between items-center gap-4 flex-wrap">
                <span>
                  <PersonName id={d.id} name={d.name} />
                  <Muted parts={[d.email]} />
                </span>
                {chapter.canAppointDeputies && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => removeDeputy.mutate({ chapterId, volunteerId: d.id })}
                  >
                    Remove {d.name} as deputy
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {chapter.canAppointDeputies && memberOptions.length > 0 && (
          <div className="mt-4">
            <FilterDropdown
              id="appoint-deputy"
              label="Appoint a deputy"
              ariaLabel="Appoint a deputy"
              value={NONE}
              placeholderLabel="Choose a member"
              options={memberOptions}
              searchable
              onChange={(value) => appointDeputy.mutate({ chapterId, volunteerId: Number(value) })}
            />
          </div>
        )}
      </section>

      {chapter.canAppointDeputies && (
        <section className={`card ${SECTION_CARD} mb-5`}>
          <H2 className="mt-0">Invite by email</H2>
          <P className="text-text-light text-sm">
            For someone not yet a member. Accepting the invite moves them into this chapter.
          </P>
          <form
            className="flex gap-3 items-end flex-wrap"
            onSubmit={(e) => {
              e.preventDefault()
              invite.mutate({ email: inviteEmail.trim(), chapterId, role: inviteRole })
            }}
          >
            <div>
              <FormLabel htmlFor="invite-email">Email address</FormLabel>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            {isGlobal && (
              <FilterDropdown
                id="invite-role"
                label="Role"
                ariaLabel="Role"
                value={inviteRole}
                options={[
                  { value: 'DEPUTY', label: 'Deputy' },
                  { value: 'LEAD', label: 'Lead' },
                ]}
                onChange={setInviteRole}
              />
            )}
            <Button type="submit" disabled={invite.isPending}>
              Send invite
            </Button>
          </form>
          {chapter.invites.length > 0 && (
            <ul className="list-none p-0 mt-4 mb-0 grid gap-2">
              {chapter.invites.map((i) => (
                <li key={i.id} className="flex justify-between items-center gap-4 flex-wrap">
                  <span>
                    {i.email} · {i.role === 'LEAD' ? 'Lead' : 'Deputy'}
                    <span className="text-text-light text-sm">
                      {' '}
                      · invited by {i.invitedByName}, expires {formatDate(i.expiresAt)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => revokeInvite.mutate({ id: i.id })}
                  >
                    Cancel invite to {i.email}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={`card ${SECTION_CARD} mb-5`}>
        <H2 className="mt-0">Members ({chapter.members.length})</H2>
        <ul className="list-none p-0 m-0 grid gap-2">
          {chapter.members.map((m) => (
            <li
              key={m.id}
              className="flex justify-between items-center gap-4 flex-wrap border-b border-brand-border py-2"
            >
              <span>
                <PersonName id={m.id} name={m.name} />
                <Muted parts={[m.email, m.duplicateOf && `duplicate of ${m.duplicateOf.name}`]} />
              </span>
              {isGlobal && (
                <FilterDropdown
                  id={`move-${m.id}`}
                  label={`Move ${m.name} to`}
                  ariaLabel={`Move ${m.name} to`}
                  hideLabel
                  value={NONE}
                  options={moveOptions}
                  onChange={(value) => {
                    if (value === NONE) return
                    reassign.mutate({
                      volunteerId: m.id,
                      chapterId: value === 'pool' ? null : Number(value),
                    })
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={`card ${SECTION_CARD}`}>
        <H2 className="mt-0">History</H2>
        {events.length === 0 ? (
          <P className="text-text-light m-0">Nothing yet.</P>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-1 text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-text-light">{formatDate(e.createdAt)}</span>{' '}
                {e.actorName ?? 'Catalyse'} {ACTION_LABELS[e.action]}{' '}
                {e.action !== ChapterAuditAction.JOINED_FROM_POOL && e.targetName}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
