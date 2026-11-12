/** Railway's own domain: it stays attached so old links keep resolving, and redirects. */
export const LEGACY_HOST = 'catalyse.up.railway.app'

function hostname(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.replace(/\.$/, '')
  } catch {
    return null
  }
}

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
  if (!host || hostname(host) !== LEGACY_HOST) return null
  let target: URL
  try {
    target = new URL(appUrl)
  } catch {
    return null
  }
  if (target.hostname === LEGACY_HOST) return null
  // Set as parts, so a path like `//elsewhere` can never change the host.
  const url = new URL(target.origin)
  url.pathname = requestUrl.pathname
  url.search = requestUrl.search
  return url
}
