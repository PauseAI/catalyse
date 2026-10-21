'use client'

import { useRequireAdmin } from '@/lib/hooks/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { useToast } from '@/lib/toast'
import { useCountries } from '@/lib/hooks/countries'
import Toggle from '@/components/Toggle'
import { H1, H2 } from '@/components/Heading'
import { P } from '@/components/Text'

export default function PlatformSettingsPage() {
  const { user, loading } = useRequireAdmin()
  const showToast = useToast()
  const queryClient = useQueryClient()

  const { data: settings, isLoading: loadingData } = useQuery({
    ...orpc.admin.platformSettings.get.queryOptions(),
    enabled: !!user?.isAdmin,
  })
  const { countries } = useCountries()
  const { data: chapters = [] } = useQuery(orpc.chapters.list.queryOptions())
  const chapterCountries = new Set(chapters.map((c) => c.country))

  const updateMutation = useMutation({
    ...orpc.admin.platformSettings.update.mutationOptions(),
    onSuccess: () => {
      showToast('Settings saved', 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.admin.platformSettings.get.key() })
      void queryClient.invalidateQueries({ queryKey: orpc.maintenance.status.key() })
    },
    onError: () => showToast('Failed to save settings', 'error'),
  })

  const countryMutation = useMutation({
    ...orpc.admin.countries.setEnabled.mutationOptions(),
    onSuccess: (country) => {
      showToast(`${country.name} ${country.enabled ? 'enabled' : 'disabled'}`, 'success')
      void queryClient.invalidateQueries({ queryKey: orpc.countries.list.key() })
    },
    onError: () => showToast('Failed to save settings', 'error'),
  })

  if (loading || loadingData || !user?.isAdmin) return null

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <H1 className="text-2xl font-bold mb-6">Platform settings</H1>

      <div className="border-y sm:border border-brand-border -mx-4 sm:mx-0 rounded-none sm:rounded-lg p-4 sm:p-6">
        <div className="flex items-center justify-between gap-6 mb-3">
          <H2 className="text-lg font-semibold m-0!">Application approval</H2>
          <Toggle
            aria-label="Require application approval"
            checked={settings?.requireApplicationApproval ?? true}
            disabled={updateMutation.isPending}
            onChange={(e) =>
              updateMutation.mutate({ requireApplicationApproval: e.target.checked })
            }
          />
        </div>
        <P className="text-text-light text-sm">
          When enabled, new volunteers must be reviewed and approved by an admin before gaining
          access. When disabled, volunteers are automatically approved after verifying their email.
        </P>
      </div>

      <div className="border-y sm:border border-brand-border -mx-4 sm:mx-0 rounded-none sm:rounded-lg p-4 sm:p-6 mt-6">
        <div className="flex items-center justify-between gap-6 mb-3">
          <H2 className="text-lg font-semibold m-0!">Maintenance mode</H2>
          <Toggle
            aria-label="Maintenance mode"
            checked={settings?.maintenanceMode ?? false}
            disabled={updateMutation.isPending}
            onChange={(e) => updateMutation.mutate({ maintenanceMode: e.target.checked })}
          />
        </div>
        <P className="text-text-light text-sm">
          When enabled, everyone except super admins is shown a &ldquo;down for maintenance&rdquo;
          page and locked out until it is turned off again. Super admins can still log in and use
          the site as normal.
        </P>
      </div>

      <section
        aria-labelledby="countries-heading"
        className="border-y sm:border border-brand-border -mx-4 sm:mx-0 rounded-none sm:rounded-lg p-4 sm:p-6 mt-6"
      >
        <H2 id="countries-heading" className="text-lg font-semibold m-0! mb-3!">
          Countries
        </H2>
        <P className="text-text-light text-sm">
          The countries people can choose when they sign up, set their location or ask to move.
          Disabling one takes it out of those lists; anyone who already gave it keeps it. Approving
          a local group or opening a chapter in a disabled country enables it.
        </P>
        <ul className="divide-y divide-brand-border mt-4">
          {countries.map((c) => (
            <li key={c.code} className="flex items-center justify-between gap-6 py-2">
              <span>
                {c.name}
                {chapterCountries.has(c.code) && (
                  <span className="text-text-light text-sm"> · has a chapter</span>
                )}
              </span>
              <Toggle
                aria-label={c.name}
                checked={c.enabled}
                disabled={countryMutation.isPending && countryMutation.variables.code === c.code}
                onChange={(e) =>
                  countryMutation.mutate({ code: c.code, enabled: e.target.checked })
                }
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
