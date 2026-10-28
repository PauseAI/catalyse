/** Where Back goes when a page was opened with nothing before it, such as from a notification. */
const PARENTS: [RegExp, string][] = [
  [/^\/projects\/([^/]+)\/(edit|import|tasks\/[^/]+)$/, '/projects/$1'],
  [/^\/projects\/[^/]+$/, '/projects'],
  [/^\/quick-tasks\/[^/]+$/, '/quick-tasks'],
  [/^\/volunteers\/[^/]+$/, '/volunteers'],
  [/^\/teams\/[^/]+$/, '/teams'],
  [/^\/inbox\/messages\/[^/]+$/, '/inbox'],
  [/^\/templates\/new$/, '/templates'],
  [/^\/suggest\/new$/, '/suggest'],
  [/^\/admin\/(applications|chapters|projects|teams)\/[^/]+$/, '/admin/$1'],
  [/^\/admin\/.+$/, '/admin'],
]

/** The page above `pathname`, or null for a top-level page. */
export function parentPage(pathname: string): string | null {
  for (const [pattern, parent] of PARENTS) {
    if (pattern.test(pathname)) return pathname.replace(pattern, parent)
  }
  return null
}
