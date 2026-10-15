import { createContext } from '@/server/context'
import { createHandler } from '@/server/handler'

const handler = createHandler()

async function handle(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: await createContext(request),
  })
  return response ?? new Response('Not found', { status: 404 })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
