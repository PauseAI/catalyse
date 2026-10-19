import path from 'node:path'
import { serveStorybookFile } from '@/lib/storybook-static'

const STORYBOOK_DIR = path.join(process.cwd(), 'storybook-static')

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path: segments } = await params
  return serveStorybookFile(STORYBOOK_DIR, request, segments)
}
