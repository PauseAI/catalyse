import path from 'node:path'
import { serveStorybookFile } from '@/lib/storybook-static'

const STORYBOOK_DIR = path.join(process.cwd(), 'storybook-static')

// Unauthenticated: a component catalogue built from fake data, no more sensitive than the
// rest of the client bundle, and gating it would mean putting the viewer's real session
// token in a shareable URL, since a static build has no way to send an Authorization header.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path: segments } = await params
  return serveStorybookFile(STORYBOOK_DIR, segments)
}
