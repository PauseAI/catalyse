import { outstandingActions } from '@/lib/required-actions'
import { adminProcedure } from '../../procedures'

export const adminRequiredActionsRouter = {
  /** Who has each kind of required action still waiting. */
  outstanding: adminProcedure.handler(() => outstandingActions()),
}
