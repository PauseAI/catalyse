'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Button from '@/components/Button'
import Checkbox from '@/components/Checkbox'
import FilterDropdown from '@/components/FilterDropdown'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { API_TOKEN_SCOPES, type ApiTokenScope } from '@/lib/api-token-scopes'
import { formatDate } from '@/lib/format-date'
import { useRequireAdmin } from '@/lib/hooks/auth'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { SECTION_CARD } from '@/lib/ui-classes'
import { H1, H2 } from '@/components/Heading'
import { P } from '@/components/Text'
import FormLabel from '@/components/FormLabel'
import Input from '@/components/ui/Input'

const ALL_SCOPES = Object.keys(API_TOKEN_SCOPES) as ApiTokenScope[]

const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'Never' },
]

/** A global admin's API tokens, which let a program such as an AI agent act as them. */
export default function AdminApiTokensPage() {
  const { user, loading } = useRequireAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiTokenScope[]>(ALL_SCOPES)
  const [expiry, setExpiry] = useState('90')
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null)
  const [revoking, setRevoking] = useState<{ id: number; name: string } | null>(null)

  const { data: tokens = [], isLoading } = useQuery({
    ...orpc.admin.apiTokens.list.queryOptions(),
    enabled: !!user?.isAdmin,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.apiTokens.list.key() })

  const create = useMutation({
    ...orpc.admin.apiTokens.create.mutationOptions(),
    onSuccess: ({ token }) => {
      setCreated({ name: name.trim(), token })
      setName('')
      void refresh()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to create token', 'error'),
  })

  const revoke = useMutation({
    ...orpc.admin.apiTokens.revoke.mutationOptions(),
    onSuccess: (data) => {
      showToast(data.message, 'success')
      setRevoking(null)
      void refresh()
    },
    onError: (err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Failed to revoke token', 'error'),
  })

  if (loading || !user?.isAdmin) return null

  const mcpCommand =
    created &&
    `claude mcp add --transport http catalyse ${window.location.origin}/api/mcp --header "Authorization: Bearer ${created.token}"`

  return (
    <main className="container py-5 pb-15">
      <H1>API tokens</H1>
      <P className="text-text-light">
        A token lets a program, such as an AI agent connected to the MCP server at{' '}
        <code>/api/mcp</code>, act as you within the permissions you give it. Anyone holding it can
        do the same, so keep it secret and revoke it if it leaks.
      </P>

      {created && (
        <section className={`${SECTION_CARD} mb-6`} aria-label="New token">
          <H2 className="mt-0">{created.name}</H2>
          <P>Copy this token now. It is not shown again.</P>
          <pre className="bg-black/5 dark:bg-white/5 rounded-lg p-3 whitespace-pre-wrap break-all">
            <code>{created.token}</code>
          </pre>
          <P className="text-text-light text-sm">To connect Claude Code:</P>
          <pre className="bg-black/5 dark:bg-white/5 rounded-lg p-3 whitespace-pre-wrap break-all text-sm mb-4">
            <code>{mcpCommand}</code>
          </pre>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(created.token)
                showToast('Token copied', 'success')
              }}
            >
              Copy token
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </section>
      )}

      <section className={`${SECTION_CARD} mb-6`}>
        <H2 className="mt-0">New token</H2>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate({
              name,
              scopes,
              expiresInDays: expiry === 'never' ? null : Number(expiry),
            })
          }}
        >
          <div>
            <FormLabel htmlFor="token-name">Name</FormLabel>
            <Input
              type="text"
              id="token-name"
              value={name}
              placeholder="What will use it, e.g. Orca agents"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend>Permissions</legend>
            {ALL_SCOPES.map((scope) => (
              <Checkbox
                key={scope}
                checked={scopes.includes(scope)}
                onChange={(e) =>
                  setScopes(
                    e.target.checked ? [...scopes, scope] : scopes.filter((s) => s !== scope),
                  )
                }
              >
                {API_TOKEN_SCOPES[scope]}
              </Checkbox>
            ))}
          </fieldset>
          <FilterDropdown
            id="token-expiry"
            label="Expires after"
            ariaLabel="Expires after"
            value={expiry}
            options={EXPIRY_OPTIONS}
            onChange={setExpiry}
          />
          <div>
            <Button
              type="submit"
              disabled={!name.trim() || scopes.length === 0 || create.isPending}
            >
              Create token
            </Button>
          </div>
        </form>
      </section>

      <section className={SECTION_CARD}>
        <H2 className="mt-0">Your tokens</H2>
        {isLoading ? (
          <P className="text-text-light">Loading…</P>
        ) : tokens.length === 0 ? (
          <P className="text-text-light">You have no tokens.</P>
        ) : (
          <ul className="list-none p-0 m-0 flex flex-col gap-4">
            {tokens.map((t) => (
              <li
                key={t.id}
                aria-label={t.name}
                className="flex justify-between items-start gap-4 flex-wrap"
              >
                <div className="min-w-0 wrap-break-word">
                  <strong>{t.name}</strong>
                  <P className="text-sm m-0">
                    {t.scopes.map((s) => API_TOKEN_SCOPES[s as ApiTokenScope] ?? s).join(' · ')}
                  </P>
                  <P className="text-text-light text-sm m-0">
                    Created {formatDate(t.createdAt)} ·{' '}
                    {t.lastUsedAt ? `Last used ${formatDate(t.lastUsedAt)}` : 'Never used'} ·{' '}
                    {t.expiresAt ? `Expires ${formatDate(t.expiresAt)}` : 'Never expires'}
                  </P>
                </div>
                <Button
                  size="sm"
                  variant="warning"
                  onClick={() => setRevoking({ id: t.id, name: t.name })}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        id="confirm-revoke-token"
        isOpen={revoking !== null}
        title={`Revoke '${revoking?.name}'?`}
        body="Anything using it is refused from now on."
        confirmLabel="Revoke"
        busyLabel="Revoking…"
        busy={revoke.isPending}
        danger
        onConfirm={() => revoking && revoke.mutate({ id: revoking.id })}
        onClose={() => setRevoking(null)}
      />
    </main>
  )
}
