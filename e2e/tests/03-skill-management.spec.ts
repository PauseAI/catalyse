import { test, expect, getAlert } from '../fixtures'
import { fake } from '../fake'

test.describe('Admin: Skill Management', () => {
  test('Admin creates a skill category', async ({ adminPage, baseUrl }) => {
    const categoryName = fake.skillCategory()

    await adminPage.goto(`${baseUrl}/admin/skills`)
    await expect(adminPage.getByRole('button', { name: '+ Add category' })).toBeVisible({
      timeout: 10_000,
    })

    await adminPage.getByRole('button', { name: '+ Add category' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Add category', level: 2 })).toBeVisible({
      timeout: 5_000,
    })

    await adminPage.getByLabel('Category Name').fill(categoryName)
    await adminPage.getByRole('button', { name: 'Save category' }).click()

    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(adminPage)).toContainText('Category created!')
    await expect(adminPage.getByRole('heading', { name: categoryName, level: 3 })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Admin creates a skill within a category', async ({ adminPage, baseUrl }) => {
    const categoryName = fake.skillCategory()
    const skillName = fake.skillName()

    await adminPage.goto(`${baseUrl}/admin/skills`)
    await expect(adminPage.getByRole('button', { name: '+ Add category' })).toBeVisible({
      timeout: 10_000,
    })

    // Create a fresh category to add the skill into
    await adminPage.getByRole('button', { name: '+ Add category' }).click()
    await adminPage.getByLabel('Category Name').fill(categoryName)
    await adminPage.getByRole('button', { name: 'Save category' }).click()
    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(adminPage)).toContainText('Category created!')

    // Add a skill under that category
    const categoryCard = adminPage.locator('.category-card').filter({ hasText: categoryName })
    await categoryCard.getByRole('button', { name: '+ Add skill' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Add skill', level: 2 })).toBeVisible({
      timeout: 5_000,
    })

    await adminPage.getByLabel('Skill Name').fill(skillName)
    await adminPage.getByRole('button', { name: 'Save skill' }).click()

    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(adminPage)).toContainText('Skill created!')
    await expect(categoryCard.getByRole('heading', { name: skillName, level: 4 })).toBeVisible({
      timeout: 10_000,
    })

    // Skill appears in profile skill picker
    await adminPage.goto(`${baseUrl}/profile`)
    await expect(adminPage.locator('.skill-option').filter({ hasText: skillName })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Admin edits a skill name', async ({ adminPage, baseUrl }) => {
    const categoryName = fake.skillCategory()
    const skillName = fake.skillName()
    const updatedSkillName = fake.skillName()

    await adminPage.goto(`${baseUrl}/admin/skills`)
    await expect(adminPage.getByRole('button', { name: '+ Add category' })).toBeVisible({
      timeout: 10_000,
    })

    // Create category and skill
    await adminPage.getByRole('button', { name: '+ Add category' }).click()
    await adminPage.getByLabel('Category Name').fill(categoryName)
    await adminPage.getByRole('button', { name: 'Save category' }).click()
    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })

    const categoryCard = adminPage.locator('.category-card').filter({ hasText: categoryName })
    await categoryCard.getByRole('button', { name: '+ Add skill' }).click()
    await adminPage.getByLabel('Skill Name').fill(skillName)
    await adminPage.getByRole('button', { name: 'Save skill' }).click()
    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(adminPage)).toContainText('Skill created!')

    // Edit the skill name
    const skillItem = categoryCard.locator('.skill-item').filter({ hasText: skillName })
    await skillItem.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(adminPage.getByRole('heading', { name: 'Edit skill', level: 2 })).toBeVisible({
      timeout: 5_000,
    })

    await adminPage.getByLabel('Skill Name').fill(updatedSkillName)
    await adminPage.getByRole('button', { name: 'Save skill' }).click()

    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(adminPage)).toContainText('Skill updated!')

    // Updated name appears in skill picker; old name is gone
    await adminPage.goto(`${baseUrl}/profile`)
    await expect(
      adminPage.locator('.skill-option').filter({ hasText: updatedSkillName }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      adminPage.locator('.skill-option').filter({ hasText: skillName }),
    ).not.toBeVisible()
  })

  test('Admin deletes an unused skill', async ({ adminPage, baseUrl }) => {
    const categoryName = fake.skillCategory()
    const skillName = fake.skillName()

    await adminPage.goto(`${baseUrl}/admin/skills`)
    await expect(adminPage.getByRole('button', { name: '+ Add category' })).toBeVisible({
      timeout: 10_000,
    })

    // Create category and skill
    await adminPage.getByRole('button', { name: '+ Add category' }).click()
    await adminPage.getByLabel('Category Name').fill(categoryName)
    await adminPage.getByRole('button', { name: 'Save category' }).click()
    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })

    const categoryCard = adminPage.locator('.category-card').filter({ hasText: categoryName })
    await categoryCard.getByRole('button', { name: '+ Add skill' }).click()
    await adminPage.getByLabel('Skill Name').fill(skillName)
    await adminPage.getByRole('button', { name: 'Save skill' }).click()
    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(adminPage)).toContainText('Skill created!')

    // Delete the skill and confirm
    const skillItem = categoryCard.locator('.skill-item').filter({ hasText: skillName })
    await skillItem.getByRole('button', { name: 'Del' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Confirm Delete', level: 2 })).toBeVisible({
      timeout: 5_000,
    })
    await adminPage.locator('#deleteModal').getByRole('button', { name: 'Delete' }).click()

    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(adminPage)).toContainText('Skill deleted!')

    // Skill no longer appears in profile skill picker
    await adminPage.goto(`${baseUrl}/profile`)
    await expect(adminPage.locator('.skill-option').first()).toBeVisible({ timeout: 10_000 })
    await expect(
      adminPage.locator('.skill-option').filter({ hasText: skillName }),
    ).not.toBeVisible()
  })

  test('Admin deletes a skill category', async ({ adminPage, baseUrl }) => {
    const categoryName = fake.skillCategory()

    await adminPage.goto(`${baseUrl}/admin/skills`)
    await expect(adminPage.getByRole('button', { name: '+ Add category' })).toBeVisible({
      timeout: 10_000,
    })

    // Create an empty category
    await adminPage.getByRole('button', { name: '+ Add category' }).click()
    await adminPage.getByLabel('Category Name').fill(categoryName)
    await adminPage.getByRole('button', { name: 'Save category' }).click()
    await expect(getAlert(adminPage)).toBeVisible({ timeout: 10_000 })
    await expect(getAlert(adminPage)).toContainText('Category created!')
    await expect(adminPage.getByRole('heading', { name: categoryName, level: 3 })).toBeVisible({
      timeout: 10_000,
    })

    // Delete the category and confirm
    const categoryCard = adminPage.locator('.category-card').filter({ hasText: categoryName })
    await categoryCard.getByRole('button', { name: 'Delete' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Confirm Delete', level: 2 })).toBeVisible({
      timeout: 5_000,
    })
    await adminPage.locator('#deleteModal').getByRole('button', { name: 'Delete' }).click()

    // Category no longer appears in the skills tree
    await expect(adminPage.getByRole('heading', { name: categoryName, level: 3 })).not.toBeVisible({
      timeout: 10_000,
    })
  })
})
