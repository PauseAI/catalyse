import { requiredActionsFor } from '@/lib/required-actions'
import { authedProcedure } from '../procedures'

export const requiredActionsRouter = {
  list: authedProcedure.handler(({ context }) => requiredActionsFor(context.volunteer)),
}
