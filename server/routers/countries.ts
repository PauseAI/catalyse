import { listCountries } from '@/lib/countries-server'
import { publicProcedure } from '../procedures'

export const countriesRouter = {
  /** Every country, enabled or not, so a stored one that is disabled still shows its name. */
  list: publicProcedure.handler(() => listCountries()),
}
