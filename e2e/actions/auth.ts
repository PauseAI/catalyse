import { Page } from '@playwright/test'
import { selectFilterDropdown } from './ui'

export async function signup(
  baseUrl: string,
  page: Page,
  name: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}/signup`)
  await page.getByLabel('Your Name').fill(name)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm Password').fill(password)
  await page.getByRole('button', { name: 'Next: About you' }).click()
  await page.getByLabel('Your Application').fill('e2e test application message')
  await page.getByLabel('About You').fill('e2e test bio, at least twenty characters long')
  await page.getByLabel('Hours per Week').fill('5')
  await selectFilterDropdown(page, 'Select country', 'United Kingdom')
  await page.getByRole('button', { name: 'Next: Skills and privacy' }).click()
  await page.getByRole('button', { name: 'Submit Application' }).click()
}

export async function login(
  baseUrl: string,
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}/login`)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${baseUrl}/dashboard`, { timeout: 15_000 })
}
