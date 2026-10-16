'use client'

import Link from 'next/link'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'

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
      <h1>Global admins</h1>
      <p className="text-text-light">
        Global admins run every national chapter and the holding pool. They are set by the
        server&apos;s <code>ADMIN_EMAILS</code> list. To give someone a chapter to run, invite them
        from its page under <Link href="/admin/chapters">National chapters</Link>.
      </p>

      {isLoading ? (
        <div className="text-center py-10 text-text-light">Loading…</div>
      ) : (
        <div id="adminList">
          {admins.map((a) => (
            <div key={a.id} className={`card ${SECTION_CARD} mb-3 overflow-hidden wrap-break-word`}>
              <div className="flex justify-between items-center gap-4">
                <div>
                  <strong>{a.name}</strong>
                  <p className="text-text-light text-sm m-0">{a.email}</p>
                </div>
                <label className="flex items-center gap-2 text-sm whitespace-nowrap shrink-0">
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
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
