import { test, expect, getAlert } from '../fixtures'
import type { Page } from '@playwright/test'
import { createSkillViaApi } from '../actions/skills'
import { fake } from '../fake'
import { selectFilterDropdown } from '../actions/ui'

async function navigateToAdminVolunteerDetail(
  baseUrl: string,
  adminPage: Page,
  volunteerName: string,
): Promise<void> {
  await adminPage.goto(`${baseUrl}/volunteers`)
  await expect(
    adminPage.getByRole('heading', { name: 'Volunteer Directory', level: 1 }),
  ).toBeVisible({ timeout: 10_000 })
  await expect(adminPage.locator('#volunteersList .loading')).not.toBeVisible({ timeout: 10_000 })

  await adminPage.getByLabel('Search').fill(volunteerName)

  const volunteerCard = adminPage.locator('.card').filter({ hasText: volunteerName }).first()
  await expect(volunteerCard).toBeVisible({ timeout: 10_000 })

  const href = await volunteerCard.getByRole('link', { name: 'View profile' }).getAttribute('href')
  const id = new URL(href!, baseUrl).pathname.split('/').pop()

  await adminPage.goto(`${baseUrl}/admin/volunteers/${id}`)
  await expect(adminPage.getByRole('heading', { name: volunteerName, level: 1 })).toBeVisible({
    timeout: 10_000,
  })
}

test.describe('Volunteer Management', () => {
  test('Admin searches the volunteers list', async ({ adminPage, volunteer, baseUrl }) => {
    await adminPage.goto(`${baseUrl}/volunteers`)
    await expect(
      adminPage.getByRole('heading', { name: 'Volunteer Directory', level: 1 }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.locator('#volunteersList .loading')).not.toBeVisible({ timeout: 10_000 })

    await adminPage.getByLabel('Search').fill(volunteer.name)

    const volunteerCard = adminPage.locator('.card').filter({ hasText: volunteer.name }).first()
    await expect(volunteerCard).toBeVisible({ timeout: 10_000 })
    await expect(volunteerCard.getByRole('link', { name: 'View profile' })).toBeVisible()
  })

  test('Admin views a comprehensive volunteer profile', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    await navigateToAdminVolunteerDetail(baseUrl, adminPage, volunteer.name)

    // Profile info sections visible
    await expect(
      adminPage.getByRole('heading', { name: 'Skills (Self-Assessed)', level: 3 }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      adminPage.getByRole('heading', { name: 'Verified Skills (Endorsed)', level: 3 }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.getByRole('heading', { name: 'Contact Info', level: 3 })).toBeVisible({
      timeout: 10_000,
    })

    // All tabs present
    await expect(adminPage.getByRole('tab', { name: 'Admin Notes' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByRole('tab', { name: 'Quick Tasks' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByRole('tab', { name: 'Project History' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(adminPage.getByRole('tab', { name: 'Endorse skill' })).toBeVisible({
      timeout: 10_000,
    })

    // Contact info shows the volunteer's email
    await expect(adminPage.locator('#contactInfo')).toContainText(volunteer.email)

    // Quick Tasks tab shows empty state
    await adminPage.getByRole('tab', { name: 'Quick Tasks' }).click()
    await expect(adminPage.getByText('No Quick Tasks assigned yet.')).toBeVisible({
      timeout: 10_000,
    })

    // Project History tab shows empty state
    await adminPage.getByRole('tab', { name: 'Project History' }).click()
    await expect(adminPage.getByText('No project history.')).toBeVisible({ timeout: 10_000 })
  })

  test('Admin adds an admin note (skill_feedback category)', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const noteContent = fake.note()

    await navigateToAdminVolunteerDetail(baseUrl, adminPage, volunteer.name)

    await selectFilterDropdown(adminPage, 'Category', 'Skill Feedback')
    await adminPage.getByLabel('Note', { exact: true }).fill(noteContent)
    await adminPage.getByRole('button', { name: 'Add note' }).click()

    await expect(getAlert(adminPage)).toContainText('Note added.', { timeout: 10_000 })

    const notesList = adminPage.locator('#notesList')
    await expect(notesList).toContainText(noteContent, { timeout: 10_000 })
    await expect(notesList).toContainText('skill feedback', { timeout: 10_000 })
  })

  test('Admin adds an admin note (reliability category); both notes visible', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const noteContent1 = fake.note()
    const noteContent2 = fake.note()

    await navigateToAdminVolunteerDetail(baseUrl, adminPage, volunteer.name)

    // First note: skill_feedback
    await selectFilterDropdown(adminPage, 'Category', 'Skill Feedback')
    await adminPage.getByLabel('Note', { exact: true }).fill(noteContent1)
    await adminPage.getByRole('button', { name: 'Add note' }).click()
    await expect(getAlert(adminPage)).toContainText('Note added.', { timeout: 10_000 })

    // Second note: reliability
    await selectFilterDropdown(adminPage, 'Category', 'Reliability')
    await adminPage.getByLabel('Note', { exact: true }).fill(noteContent2)
    await adminPage.getByRole('button', { name: 'Add note' }).click()
    await expect(getAlert(adminPage)).toContainText('Note added.', { timeout: 10_000 })

    const notesList = adminPage.locator('#notesList')
    await expect(notesList).toContainText(noteContent1, { timeout: 10_000 })
    await expect(notesList).toContainText(noteContent2, { timeout: 10_000 })
    await expect(notesList).toContainText('skill feedback', { timeout: 10_000 })
    await expect(notesList).toContainText('reliability', { timeout: 10_000 })
  })

  test('Admin edits an admin note', async ({ adminPage, volunteer, baseUrl }) => {
    const originalContent = fake.note()
    const updatedContent = fake.note()

    await navigateToAdminVolunteerDetail(baseUrl, adminPage, volunteer.name)

    await adminPage.getByLabel('Note', { exact: true }).fill(originalContent)
    await adminPage.getByRole('button', { name: 'Add note' }).click()
    await expect(getAlert(adminPage)).toContainText('Note added.', { timeout: 10_000 })

    const notesList = adminPage.locator('#notesList')
    await expect(notesList).toContainText(originalContent, { timeout: 10_000 })

    await notesList.getByRole('button', { name: 'Edit', exact: true }).click()
    await adminPage.getByLabel('Edit note').fill(updatedContent)
    await notesList.getByRole('button', { name: 'Save' }).click()

    await expect(getAlert(adminPage)).toContainText('Note updated.', { timeout: 10_000 })
    await expect(notesList).toContainText(updatedContent, { timeout: 10_000 })
    await expect(notesList).not.toContainText(originalContent, { timeout: 10_000 })
  })

  test('Admin deletes an admin note', async ({ adminPage, volunteer, baseUrl }) => {
    const noteContent = fake.note()

    await navigateToAdminVolunteerDetail(baseUrl, adminPage, volunteer.name)

    await adminPage.getByLabel('Note', { exact: true }).fill(noteContent)
    await adminPage.getByRole('button', { name: 'Add note' }).click()
    await expect(getAlert(adminPage)).toContainText('Note added.', { timeout: 10_000 })

    const notesList = adminPage.locator('#notesList')
    await expect(notesList).toContainText(noteContent, { timeout: 10_000 })

    await notesList.getByRole('button', { name: 'Delete' }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Delete note' }).click()

    await expect(getAlert(adminPage)).toContainText('Note deleted.', { timeout: 10_000 })
    await expect(notesList).not.toContainText(noteContent, { timeout: 10_000 })
  })

  test('Admin creates a skill endorsement for a volunteer', async ({
    adminPage,
    volunteer,
    baseUrl,
  }) => {
    const skill = await createSkillViaApi(baseUrl)

    await navigateToAdminVolunteerDetail(baseUrl, adminPage, volunteer.name)

    await adminPage.getByRole('tab', { name: 'Endorse skill' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Endorse a Skill', level: 3 })).toBeVisible(
      { timeout: 5_000 },
    )

    await selectFilterDropdown(adminPage, 'Skill', skill.optionLabel)
    await selectFilterDropdown(adminPage, 'Rating', 'Verified - Can deliver')
    await selectFilterDropdown(adminPage, 'Based On', 'Direct Observation')
    await adminPage.getByRole('button', { name: 'Endorse skill' }).click()

    await expect(getAlert(adminPage)).toContainText('Skill endorsed!', { timeout: 10_000 })

    // Endorsement appears in Verified Skills section on the admin detail page
    await expect(adminPage.locator('#endorsements')).toContainText(skill.name, { timeout: 10_000 })

    // Navigate to the volunteer's public profile to confirm the endorsement is visible there too
    const volunteerId = new URL(adminPage.url()).pathname.split('/').pop()
    await adminPage.goto(`${baseUrl}/volunteers/${volunteerId}`)
    await expect(adminPage.getByRole('heading', { name: 'Verified Skills', level: 2 })).toBeVisible(
      { timeout: 10_000 },
    )
    await expect(adminPage.locator('#endorsementsList')).toContainText(skill.name, {
      timeout: 10_000,
    })
  })
})
