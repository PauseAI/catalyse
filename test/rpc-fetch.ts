import type { RPCHandler } from '@orpc/server/fetch'

/**
 * Routes the browser-side oRPC client (`lib/client.ts`, which speaks over `fetch`) straight
 * into the real router and the test file's own SQLite database — exactly what
 * `app/api/rpc/[...orpc]/route.ts` does, minus the network.
 *
 * The router is loaded on the first request rather than when the setup file runs, so a test
 * file's `vi.mock` of a server-side module (an email sender, Google's token check) is
 * registered before the server code that imports it is evaluated.
 */
let handler:
  | Promise<{
      rpc: RPCHandler<Record<never, never>>
      createContext: (r: Request) => Promise<unknown>
    }>
  | undefined

async function load() {
  const [{ createHandler }, { createContext }] = await Promise.all([
    import('@/server/handler'),
    import('@/server/context'),
  ])
  return { rpc: createHandler(), createContext }
}

export async function rpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith('/api/rpc')) {
    throw new Error(`Unexpected fetch in a component test: ${request.method} ${request.url}`)
  }
  handler ??= load()
  const { rpc, createContext } = await handler
  const { response } = await rpc.handle(request, {
    prefix: '/api/rpc',
    context: (await createContext(request)) as Record<never, never>,
  })
  // A real fetch rejects once its signal is aborted; react-query relies on that to discard a
  // cancelled refetch's result rather than let a stale response overtake a newer one.
  if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  return response ?? new Response('Not found', { status: 404 })
}

export function installRpcFetch(): void {
  globalThis.fetch = rpcFetch as typeof fetch
}
