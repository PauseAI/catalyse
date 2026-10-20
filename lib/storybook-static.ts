import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Next redirects any request for this path with a trailing slash to the slash-less form
// (trailingSlash defaults to false), so the browser's address bar can never be relied on to
// end in `/`. Storybook's own HTML resolves its scripts and stylesheets with relative paths,
// which would then resolve one directory too high. A `<base>` tag fixes the resolution root
// regardless of what the address bar shows.
const BASE_HREF = '/admin/storybook/view/'

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

/** Resolves `segments` to a file inside `rootDir`, refusing anything that would escape it. */
function resolveFile(rootDir: string, segments: string[] | undefined): string | null {
  const relative = segments && segments.length > 0 ? segments.join('/') : 'index.html'
  const root = path.normalize(rootDir)
  const resolved = path.normalize(path.join(root, relative))
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

const NOT_FOUND = new Response('Not found', { status: 404 })

/** Serves the Storybook static build from `rootDir`. */
export async function serveStorybookFile(
  rootDir: string,
  segments: string[] | undefined,
): Promise<Response> {
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

  return new Response(new Uint8Array(outBody), {
    headers: { 'Content-Type': contentType },
  })
}

function injectBaseHref(body: Buffer): Buffer {
  const html = body.toString('utf-8')
  const withBase = html.replace(
    /<head(\s[^>]*)?>/i,
    (match) => `${match}<base href="${BASE_HREF}">`,
  )
  return Buffer.from(withBase, 'utf-8')
}
