import { Page, expect } from '@playwright/test'
import { getAlert, readAdminToken } from '../fixtures'
import { createApiClient } from '../client'
import { fake } from '../fake'

export interface SkillInfo {
  name: string
  optionLabel: string
  // Only populated by createSkillViaApi — the UI flow doesn't surface the created skill's id.
  id?: number
}

export async function createSkill(baseUrl: string, adminPage: Page): Promise<SkillInfo> {
  const categoryName = fake.skillCategory()
  const skillName = fake.skillName()

  await adminPage.goto(`${baseUrl}/admin/skills`)
  await expect(adminPage.getByRole('button', { name: '+ Add category' })).toBeVisible({
    timeout: 10_000,
  })

  await adminPage.getByRole('button', { name: '+ Add category' }).click()
  await adminPage.getByLabel('Category name').fill(categoryName)
  await adminPage.getByRole('button', { name: 'Save category' }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })

  const categoryCard = adminPage.locator('.category-card').filter({ hasText: categoryName })
  await categoryCard.getByRole('button', { name: '+ Add skill' }).click()
  await adminPage.getByLabel('Skill name').fill(skillName)
  await adminPage.getByRole('button', { name: 'Save skill' }).click()
  await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })

  return { name: skillName, optionLabel: `${skillName} (${categoryName})` }
}

// API-equivalent of createSkill, for tests that need "a skill that exists" purely as setup —
// the category+skill create UI flow itself is already proven end-to-end in
// 03-skill-management.spec.ts.
export async function createSkillViaApi(baseUrl: string): Promise<SkillInfo> {
  const categoryName = fake.skillCategory()
  const skillName = fake.skillName()

  const adminApi = createApiClient(baseUrl, readAdminToken(baseUrl))
  const categoryResult = await adminApi.admin.skillCategories.create({
    body: { name: categoryName },
  })
  if (categoryResult.status !== 200)
    throw new Error(`Skill category creation failed: ${JSON.stringify(categoryResult.body)}`)
  const { id: categoryId } = categoryResult.body as { id: number }

  const skillResult = await adminApi.admin.skills.create({
    body: { name: skillName, categoryId },
  })
  if (skillResult.status !== 200)
    throw new Error(`Skill creation failed: ${JSON.stringify(skillResult.body)}`)
  const { id: skillId } = skillResult.body as { id: number }

  return { name: skillName, optionLabel: `${skillName} (${categoryName})`, id: skillId }
}
