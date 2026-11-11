'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'
import { H1, H2 } from '@/components/Heading'
import { P } from '@/components/Text'
import FormLabel from '@/components/FormLabel'
import Button from '@/components/Button'
import FullVolunteerSelect from '@/components/FullVolunteerSelect'
import Input from '@/components/ui/Input'

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Failed to update')

/** Coordinators put out calls to volunteers in every chapter; only a global admin names them. */
function Coordinators() {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [volunteerId, setVolunteerId] = useState('')
  const [remit, setRemit] = useState('')
  const { data: coordinators = [] } = useQuery(orpc.admin.coordinators.list.queryOptions())
  const onSuccess = (data: { message: string }) => {
    showToast(data.message, 'success')
    void queryClient.invalidateQueries({ queryKey: orpc.admin.coordinators.list.key() })
  }
  const appoint = useMutation({
    ...orpc.admin.coordinators.appoint.mutationOptions(),
    onSuccess: (data) => {
      onSuccess(data)
      setVolunteerId('')
      setRemit('')
    },
    onError: (err) => showToast(errorText(err), 'error'),
  })
  const remove = useMutation({
    ...orpc.admin.coordinators.remove.mutationOptions(),
    onSuccess,
    onError: (err) => showToast(errorText(err), 'error'),
  })

  return (
    <section aria-labelledby="coordinators-heading" className="mt-8">
      <H2 id="coordinators-heading">Coordinators</H2>
      <P className="text-text-light">
        A coordinator puts out calls to volunteers in every chapter, such as for photos of events,
        and reads the answers. They can see and message every approved volunteer, including those
        hidden from the directory, but get no admin powers.
      </P>
      <div id="coordinatorList">
        {coordinators.map((c) => (
          <div
            key={c.volunteerId}
            className={`card ${SECTION_CARD} mb-3 overflow-hidden wrap-break-word`}
          >
            <div className="flex justify-between items-center gap-4">
              <div>
                <strong>{c.name}</strong>
                {c.remit && <span className="text-text-light"> · {c.remit}</span>}
                <P className="text-text-light text-sm m-0">{c.email}</P>
              </div>
              <Button
                size="sm"
                variant="warning"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ volunteerId: c.volunteerId })}
                aria-label={`Remove ${c.name} as a coordinator`}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
      <form
        className={`${SECTION_CARD} flex flex-wrap items-end gap-3`}
        onSubmit={(e) => {
          e.preventDefault()
          appoint.mutate({ volunteerId: Number(volunteerId), remit: remit.trim() || null })
        }}
      >
        <div className="flex-1 min-w-60">
          <FullVolunteerSelect
            id="coordinator-volunteer"
            label="Make a coordinator"
            ariaLabel="Volunteer to make a coordinator"
            value={volunteerId}
            onChange={setVolunteerId}
          />
        </div>
        <div className="flex-1 min-w-40">
          <FormLabel htmlFor="coordinator-remit">What they coordinate</FormLabel>
          <Input
            id="coordinator-remit"
            value={remit}
            maxLength={100}
            onChange={(e) => setRemit(e.target.value)}
            placeholder="Media"
          />
        </div>
        <Button type="submit" size="sm" disabled={!volunteerId || appoint.isPending}>
          Appoint
        </Button>
      </form>
    </section>
  )
}

/** The global admins, who are set by ADMIN_EMAILS and so are listed here, not managed. */
export default function AdminTeamPage() {
  const { user, loading } = useRequireAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const { data: admins = [], isLoading } = useQuery({
    ...orpc.admin.admins.list.queryOptions(),
    enabled: !!user?.isAdmin,
  })

  const setTechnicalAdminMutation = useMutation({
    ...orpc.admin.admins.setTechnicalAdmin.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.admin.admins.list.key() })
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Failed to update', 'error')
    },
  })

  if (loading || !user?.isAdmin) return null

  return (
    <main className="container py-5 pb-15">
      <H1>Global admins</H1>
      <P className="text-text-light">
        Global admins run every national chapter and the holding pool. They are set by the
        server&apos;s <code>ADMIN_EMAILS</code> list. To give someone a chapter to run, invite them
        from its page under{' '}
        <Link className="text-primary-text underline" href="/admin/chapters">
          National chapters
        </Link>
        .
      </P>

      {isLoading ? (
        <div className="text-center py-10 text-text-light">Loading…</div>
      ) : (
        <div id="adminList">
          {admins.map((a) => (
            <div key={a.id} className={`card ${SECTION_CARD} mb-3 overflow-hidden wrap-break-word`}>
              <div className="flex justify-between items-center gap-4">
                <div>
                  <strong>{a.name}</strong>
                  <P className="text-text-light text-sm m-0">{a.email}</P>
                </div>
                <FormLabel className="flex items-center gap-2 text-sm whitespace-nowrap shrink-0">
                  <input
                    type="checkbox"
                    checked={a.isTechnicalAdmin}
                    disabled={setTechnicalAdminMutation.isPending}
                    onChange={(e) =>
                      setTechnicalAdminMutation.mutate({
                        id: a.id,
                        isTechnicalAdmin: e.target.checked,
                      })
                    }
                  />
                  Notify of bug reports
                </FormLabel>
              </div>
            </div>
          ))}
        </div>
      )}
      <Coordinators />
    </main>
  )
}
