import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getCurrentVolunteer } from '@/lib/auth'
import { env } from '@/lib/env'

export const STORYBOOK_SESSION_COOKIE = 'storybook_session'
const COOKIE_PATH = '/admin/storybook/view'
const COOKIE_MAX_AGE_SECONDS = 60 * 60

// Next redirects any request for this path with a trailing slash to the slash-less form
// (trailingSlash defaults to false), so the browser's address bar can never be relied on to
// end in `/`. Storybook's own HTML resolves its scripts and stylesheets with relative paths,
// which would then resolve one directory too high. A `<base>` tag fixes the resolution root
// regardless of what the address bar shows.
const BASE_HREF = `${COOKIE_PATH}/`

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream'
}

/** The named cookie's value from a `Cookie` request header, or null if absent. */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

/** Resolves `segments` to a file inside `rootDir`, refusing anything that would escape it. */
function resolveFile(rootDir: string, segments: string[] | undefined): string | null {
  const relative = segments && segments.length > 0 ? segments.join('/') : 'index.html'
  const root = path.normalize(rootDir)
  const resolved = path.normalize(path.join(root, relative))
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

const NOT_FOUND = new Response('Not found', { status: 404 })

/**
 * Serves the Storybook static build from `rootDir` to global admins only. A static build has
 * no way to attach the Authorization header the app's own API calls use, so a valid admin
 * token passed once as `?token=` (the one already in the browser's `localStorage`) mints a
 * short-lived cookie that every later request for this path carries automatically.
 */
export async function serveStorybookFile(
  rootDir: string,
  request: Request,
  segments: string[] | undefined,
): Promise<Response> {
  const queryToken = new URL(request.url).searchParams.get('token')
  const cookieToken = readCookie(request, STORYBOOK_SESSION_COOKIE)
  const token = cookieToken ?? queryToken
  const volunteer = await getCurrentVolunteer(token ? `Bearer ${token}` : null)
  if (!volunteer?.isAdmin) return NOT_FOUND

  const filePath = resolveFile(rootDir, segments)
  if (!filePath) return NOT_FOUND

  let body: Buffer
  try {
    body = await readFile(filePath)
  } catch {
    return NOT_FOUND
  }

  const contentType = contentTypeFor(filePath)
  const outBody = contentType.startsWith('text/html') ? injectBaseHref(body) : body

  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store',
  })
  if (!cookieToken && queryToken) {
    const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
    headers.append(
      'Set-Cookie',
      `${STORYBOOK_SESSION_COOKIE}=${encodeURIComponent(queryToken)}; Path=${COOKIE_PATH}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
    )
  }
  return new Response(new Uint8Array(outBody), { headers })
}

function injectBaseHref(body: Buffer): Buffer {
  const html = body.toString('utf-8')
  const withBase = html.replace(
    /<head(\s[^>]*)?>/i,
    (match) => `${match}<base href="${BASE_HREF}">`,
  )
  return Buffer.from(withBase, 'utf-8')
}
