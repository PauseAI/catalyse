import { z } from 'zod'

/** What an API token may do. Its owner's own permissions still apply on top. */
export const API_TOKEN_SCOPES = {
  'bug_reports:read': 'Read bug reports and their comments',
  'bug_reports:write': 'Comment on bug reports and change their status',
} as const

export type ApiTokenScope = keyof typeof API_TOKEN_SCOPES

export const ApiTokenScopeSchema = z.enum(
  Object.keys(API_TOKEN_SCOPES) as [ApiTokenScope, ...ApiTokenScope[]],
)
