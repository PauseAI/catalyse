// A top-level page card bleeds to a full-width square section on phones and is a rounded card
// inside the gutter from `sm`. The -mx-4 cancels the 1rem phone gutter of `container`, so use it
// only on a card sitting directly in the page column.
export const BLEED = '-mx-4 sm:mx-0 rounded-none sm:rounded-xl'

export const SECTION_CARD = `bg-surface shadow p-4 sm:p-6 ${BLEED}`
