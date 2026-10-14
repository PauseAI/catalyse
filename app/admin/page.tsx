'use client'

import Link from 'next/link'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { Badge } from '@/components/Badge'
import Button from '@/components/Button'

interface AdminLink {
  href: string
  label: string
  superAdminOnly?: boolean
  count?: number
}

interface AdminGroup {
  title: string
  links: AdminLink[]
}

export default function AdminLandingPage() {
  const { user, loading } = useRequireAdmin()
  const queryClient = useQueryClient()

  const { data: counts } = useQuery({
    ...orpc.admin.overview.counts.queryOptions(),
    enabled: !!user?.isAdmin,
  })

  const { data: stats, isLoading: loadingStats } = useQuery({
    ...orpc.admin.stats.get.queryOptions(),
    enabled: !!user?.isAdmin,
  })

  const { data: notifications = [], isLoading: loadingNotifications } = useQuery({
    ...orpc.admin.notifications.list.queryOptions(),
    enabled: !!user?.isAdmin,
  })

  const readAllMutation = useMutation({
    ...orpc.admin.notifications.readAll.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.admin.notifications.list.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.admin.overview.counts.key() })
    },
  })

  const markReadMutation = useMutation({
    ...orpc.admin.notifications.markRead.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.admin.notifications.list.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.admin.overview.counts.key() })
    },
  })

  if (loading || !user?.isAdmin) return null

  const unreadCount = notifications.filter((n) => !n.readAt).length

  const groups: AdminGroup[] = [
    {
      title: 'People',
      links: [
        {
          href: '/admin/applications',
          label: 'Manage Applications',
          superAdminOnly: true,
          count: counts?.pendingApplications,
        },
        { href: '/admin/team', label: 'Admin Team' },
      ],
    },
    {
      title: 'Projects',
      links: [
        { href: '/admin/triage', label: 'Triage Queue', count: counts?.pendingTriage },
        { href: '/admin/projects', label: 'Org Projects' },
      ],
    },
    {
      title: 'Content & Support',
      links: [
        { href: '/admin/skills', label: 'Manage Skills' },
        { href: '/admin/local-groups', label: 'Manage Local Groups' },
        { href: '/admin/teams', label: 'Manage Teams' },
        { href: '/admin/bugs', label: 'Bug Reports', count: counts?.openBugReports },
        {
          href: '/admin/people-for-a-pause-protest-journalist-outreach',
          label: 'Journalist Outreach',
        },
      ],
    },
    {
      title: 'Platform',
      links: [
        { href: '/admin/platform-settings', label: 'Platform Settings', superAdminOnly: true },
        { href: '/admin/cron-runs', label: 'Cron Job Runs', superAdminOnly: true },
      ],
    },
  ]

  return (
    <main className="container-wide py-5 pb-15">
      <h1>{user.isSuperAdmin ? 'Super Admin' : 'Admin'}</h1>

      {!loadingStats && stats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6 max-[500px]:grid-cols-1">
          <div className="bg-surface rounded-xl shadow p-4 sm:p-6 overflow-hidden">
            <h2 className="mt-0">Volunteers</h2>
            <div className="grid grid-cols-2 gap-5 mt-4">
              <div>
                <div className="text-4xl font-bold text-primary mb-1">{stats.volunteers.total}</div>
                <div className="text-text-light">Total Registered</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-success mb-1">
                  {stats.volunteers.last30Days}
                </div>
                <div className="text-text-light">Joined last 30 days</div>
              </div>
            </div>
            <div className="mt-4">
              {[
                { label: 'Approved', value: stats.volunteers.approved, color: 'text-success' },
                { label: 'Pending', value: stats.volunteers.pending, color: undefined },
                { label: 'Under Review', value: stats.volunteers.underReview, color: undefined },
                {
                  label: 'Needs Info',
                  value: stats.volunteers.needsInfo,
                  color: 'text-warning-text',
                },
              ].map((row, i, arr) => (
                <div
                  key={row.label}
                  className={`flex justify-between py-2${i < arr.length - 1 ? ' border-b border-brand-border' : ''}`}
                >
                  <span className={row.color}>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface rounded-xl shadow p-4 sm:p-6 overflow-hidden">
            <h2 className="mt-0">Projects</h2>
            <div className="mt-4">
              {[
                { label: 'Total', value: stats.projects.total, color: undefined },
                {
                  label: 'Seeking Help',
                  value: stats.projects.seekingHelp,
                  color: 'text-brand-text',
                },
                { label: 'In Progress', value: stats.projects.inProgress, color: undefined },
                { label: 'Completed', value: stats.projects.completed, color: 'text-success' },
              ].map((row, i, arr) => (
                <div
                  key={row.label}
                  className={`flex justify-between py-2${i < arr.length - 1 ? ' border-b border-brand-border' : ''}`}
                >
                  <span className={row.color}>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface rounded-xl shadow p-4 sm:p-6 overflow-hidden">
            <h2 className="mt-0">Volunteer interest</h2>
            <div className="grid grid-cols-2 gap-5 mt-4">
              <div>
                <div className="text-4xl font-bold text-brand-text mb-1">
                  {stats.interests.total}
                </div>
                <div className="text-text-light">Total Interests</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-warning-text mb-1">
                  {stats.interests.pending}
                </div>
                <div className="text-text-light">Pending Response</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[2fr_minmax(0,1fr)]">
        <div className="border border-brand-border rounded-lg p-5 h-fit">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-light m-0">
              Notifications
            </h2>
            {unreadCount > 0 && (
              <Button size="sm" onClick={() => readAllMutation.mutate({})}>
                Mark all as read
              </Button>
            )}
          </div>
          {loadingNotifications ? (
            <p className="text-text-light text-sm m-0">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="text-text-light text-sm m-0">No notifications.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`bg-surface rounded-lg p-4 wrap-break-word ${!n.readAt ? 'border-l-4 border-primary' : ''}`}
                >
                  <strong className={!n.readAt ? 'text-brand-text' : 'text-text-light'}>
                    {n.title}
                  </strong>
                  <p className="text-sm mt-1 mb-0 text-text-light max-w-3xl">{n.body}</p>
                  <div className="flex items-center gap-4 mt-2">
                    {n.link && (
                      <Link href={n.link} className="text-sm underline">
                        View
                      </Link>
                    )}
                    {!n.readAt && (
                      <button
                        onClick={() => markReadMutation.mutate({ id: n.id })}
                        className="text-sm underline text-text-light bg-transparent border-none cursor-pointer p-0"
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-5 content-start">
          {groups.map((group) => {
            const links = group.links.filter((l) => !l.superAdminOnly || user.isSuperAdmin)
            if (links.length === 0) return null
            return (
              <div key={group.title} className="border border-brand-border rounded-lg p-5 h-fit">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-text-light m-0 mb-3">
                  {group.title}
                </h2>
                <div className="flex flex-col gap-1 -mx-2">
                  {links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="flex items-center justify-between gap-3 px-2 py-2 rounded-md no-underline text-brand-text hover:bg-accent transition-colors"
                    >
                      <span>{link.label}</span>
                      {!!link.count && (
                        <Badge variant={link.count > 0 ? 'info' : 'neutral'}>{link.count}</Badge>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
