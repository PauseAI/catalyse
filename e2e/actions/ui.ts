import { expect, type Page, type Locator } from '@playwright/test'

export async function selectFilterDropdown(
  page: Page,
  ariaLabel: string,
  optionLabel: string,
  scope?: Locator | Page,
): Promise<void> {
  await (scope ?? page).getByLabel(ariaLabel, { exact: true }).click()
  // Searchable dropdowns replace the trigger with a search input — type to filter
  const searchInput = page.locator(`input[type="search"][aria-label="${ariaLabel}"]`)
  if (await searchInput.isVisible({ timeout: 300 }).catch(() => false)) {
    await searchInput.fill(optionLabel)
  }
  await page.getByRole('option', { name: optionLabel, exact: true }).click()
}

/**
 * Posts a comment and waits until the server has it. React mirrors a textarea's value into its
 * text, so the typed words are on screen before the post lands; the box empties only once it has.
 */
export async function postComment(scope: Page | Locator, text: string): Promise<void> {
  const box = scope.getByLabel('Add a comment')
  await box.fill(text)
  await scope.getByRole('button', { name: 'Post comment' }).click()
  await expect(box).toHaveValue('', { timeout: 10_000 })
}
