const url = process.env.CRON_URL ?? 'https://catalyse.up.railway.app/api/cron/daily'
const secret = process.env.CRON_SECRET

console.log(`[cron-trigger] POST ${url}`)

if (!secret) {
  console.error('[cron-trigger] CRON_SECRET is not set')
  process.exit(1)
}

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    // The call waits for every job due this hour, a backup included.
    signal: AbortSignal.timeout(15 * 60_000),
  })
  const body = await res.text()
  console.log(`[cron-trigger] HTTP ${res.status}`)
  console.log(body)
  process.exit(res.ok ? 0 : 1)
} catch (err) {
  console.error('[cron-trigger] request failed:', err)
  process.exit(1)
}
