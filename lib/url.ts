const HTTP_URL_RE = /^https?:\/\/\S+$/i

/** A link the app will render as an href: http(s) only, so it can never run script. */
export const isHttpUrl = (value: string | null | undefined): value is string =>
  typeof value === 'string' && HTTP_URL_RE.test(value)
