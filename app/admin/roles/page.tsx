'use client'

import { useRequireStaff } from '@/lib/hooks/auth'
import { PERMISSIONS, ROLES, type Permission, type Role, type Scope } from '@/lib/permissions'
import { SECTION_CARD } from '@/lib/ui-classes'
import { Badge } from '@/components/Badge'
import { H1, H2, H3 } from '@/components/Heading'
import { P } from '@/components/Text'

const SCOPE_LABEL: Record<Scope, string> = {
  global: 'Everywhere',
  chapter: 'Their chapter',
  project: 'One project',
  task: 'One task',
}

const roles = Object.keys(ROLES) as Role[]
const permissions = Object.keys(PERMISSIONS) as Permission[]
const grants = (role: Role, permission: Permission) =>
  (ROLES[role].grants as readonly Permission[]).includes(permission)

/** What each role may do, read from the catalogue the server checks against (lib/permissions.ts). */
export default function AdminRolesPage() {
  const { user, loading } = useRequireStaff()
  if (loading || !user) return null

  return (
    <main className="container py-5 pb-15">
      <H1>Roles and permissions</H1>
      <P className="text-text-light">
        Who may do what to projects and their tasks. A person can hold several roles at once and may
        do anything any of them allows. Whether a thing can be done at all still depends on its
        state: nothing on a completed or archived project changes until it is reopened.
      </P>
      <P className="text-text-light">
        Chapters, teams, volunteers and quick tasks are not described here yet: their rules are
        still written into the pages that use them.
      </P>

      <section aria-labelledby="by-role" className="mt-6">
        <H2 id="by-role">By role</H2>
        <div className="grid gap-4 md:grid-cols-2">
          {roles.map((role) => {
            const info = ROLES[role]
            return (
              <section key={role} aria-label={info.name} className={SECTION_CARD}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <H3 className="m-0">{info.name}</H3>
                  <Badge variant="neutral">{SCOPE_LABEL[info.scope]}</Badge>
                </div>
                <P className="text-sm text-text-light">{info.heldBy}</P>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {info.grants.map((p) => (
                    <li key={p}>{PERMISSIONS[p].summary}</li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </section>

      <section aria-labelledby="by-permission" className="mt-8">
        <H2 id="by-permission">By permission</H2>
        <div className={`${SECTION_CARD} overflow-x-auto`}>
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th scope="col" className="text-left p-2 align-bottom">
                  Permission
                </th>
                {roles.map((role) => (
                  <th key={role} scope="col" className="p-2 align-bottom font-semibold">
                    {ROLES[role].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((permission) => (
                <tr key={permission} className="border-t border-brand-border">
                  <th scope="row" className="text-left p-2 font-normal min-w-56">
                    <code className="text-xs">{permission}</code>
                    <div className="text-text-light">{PERMISSIONS[permission].summary}</div>
                  </th>
                  {roles.map((role) => (
                    <td key={role} className="p-2 text-center">
                      {grants(role, permission) ? (
                        <>
                          <span aria-hidden="true">✓</span>
                          <span className="sr-only">Yes</span>
                        </>
                      ) : (
                        <span className="sr-only">No</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
