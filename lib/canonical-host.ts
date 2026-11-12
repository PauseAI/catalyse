/** Railway's own domain: it stays attached so old links keep resolving, and redirects. */
export const LEGACY_HOST = 'catalyse.up.railway.app'

/**
 * Where a request to the legacy host belongs: the same path and query on `APP_URL`'s origin.
 * Null for any other host, and while `APP_URL` is unset, unparseable or still the legacy
 * host, so changing `APP_URL` is what switches the redirect on.
 */
export function canonicalRedirect(
  requestUrl: URL,
  host: string | null,
  appUrl: string,
): URL | null {
  if (host?.toLowerCase() !== LEGACY_HOST) return null
  let target: URL
  try {
    target = new URL(appUrl)
  } catch {
    return null
  }
  if (target.host === LEGACY_HOST) return null
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, target.origin)
}
