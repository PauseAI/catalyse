'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams, usePathname } from 'next/navigation'

function useSetParam() {
  // Deliberately depends on nothing: the setter must keep a stable identity for the
  // life of the component. Directory pages list it (via setPageParam) in the deps of
  // their "reset to page 1 when a filter changes" effect — a setter that churned on
  // every URL change would re-fire that effect right after a pagination click and
  // snap the list straight back to page 1.
  //
  // Reads the live URL at call time rather than closing over useSearchParams(), and
  // writes with history.replaceState (which Next patches to sync
  // usePathname/useSearchParams) instead of router.replace() — matching
  // useUrlSearchInput below. router.replace() with a query-only relative URL did not
  // reliably update useSearchParams() here, which is why paging never advanced.
  return useCallback((key: string, value: string) => {
    const params = new URLSearchParams(window.location.search)
    if (value) params.set(key, value)
    else params.delete(key)
    const qs = params.toString()
    const { pathname } = window.location
    // A write that changes nothing would still dispatch a router restore (see
    // useUrlSearchInput), which can cancel a click on a result made just before it.
    if (qs === window.location.search.replace(/^\?/, '')) return
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
  }, [])
}

/**
 * Reads a URL search param and returns an immediate setter (no debounce).
 * Suitable for dropdown filters.
 */
export function useUrlParam(key: string): [string, (value: string) => void] {
  const searchParams = useSearchParams()
  const setParam = useSetParam()
  const value = searchParams.get(key) ?? ''
  const setValue = useCallback((v: string) => setParam(key, v), [key, setParam])
  return [value, setValue]
}

/**
 * Manages a text search input whose value lives in the URL.
 *
 * Returns [inputValue, setInputValue, committedValue] where:
 * - inputValue / setInputValue drive the <input> element directly
 * - committedValue is the debounced value to pass to API queries
 *
 * The URL is written on every keystroke, not on a timer. Next patches history.replaceState
 * to dispatch a router restore, and a restore dispatched while a navigation is pending
 * discards that navigation (dispatchAction in next/dist/client/components/app-router-instance).
 * A debounced write could fire just after the user clicked a result and cancel the click;
 * a write made in the input's own event handler is always ordered before that click.
 */
export function useUrlSearchInput(
  key: string,
  delayMs = 300,
): [string, (value: string) => void, string] {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const urlValue = searchParams.get(key) ?? ''
  const [input, setInputState] = useState(urlValue)
  const [committed, setCommitted] = useState(urlValue)

  const setInput = useCallback(
    (value: string) => {
      setInputState(value)
      const params = new URLSearchParams(window.location.search)
      if (value) params.set(key, value)
      else params.delete(key)
      const qs = params.toString()
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
    },
    [key, pathname],
  )

  // Debounces the query, and follows the URL when back/forward changes it.
  useEffect(() => {
    if (urlValue === committed) return
    const t = setTimeout(() => setCommitted(urlValue), delayMs)
    return () => clearTimeout(t)
  }, [urlValue, committed, delayMs])

  return [input, setInput, committed]
}
