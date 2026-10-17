import { test, expect } from '../fixtures'
import { fake } from '../fake'
import { submitBugReportViaApi } from '../actions/bugs'

/** Calls one MCP tool on the running server, as an agent holding `token` would. */
async function callTool(baseUrl: string, token: string, name: string, args: object) {
  return fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
}

test.describe('API tokens and the MCP server', () => {
  test('Admin creates a token, an agent reads and resolves a bug report with it, and the admin revokes it', async ({
    adminPage,
    volunteer,
    baseUrl,
    snap,
  }) => {
    const title = fake.bugTitle()
    const reportId = await submitBugReportViaApi(
      baseUrl,
      volunteer.page,
      title,
      'The page goes blank after saving.',
    )
    const tokenName = `Agent ${title}`

    await adminPage.goto(`${baseUrl}/admin/api-tokens`)
    await expect(adminPage.getByRole('heading', { name: 'API tokens' })).toBeVisible({
      timeout: 10_000,
    })
    await adminPage.getByLabel('Name').fill(tokenName)
    await adminPage.getByRole('button', { name: 'Create token' }).click()
    const shown = adminPage.getByRole('region', { name: 'New token' })
    await expect(shown).toContainText('It is not shown again.')
    const token = (await shown.getByText(/^cat_/).textContent())!
    await snap(adminPage, 'new token shown')

    const read = await callTool(baseUrl, token, 'get_bug_report', { id: reportId })
    expect(read.status).toBe(200)
    expect(JSON.stringify(await read.json())).toContain(title)

    const resolved = await callTool(baseUrl, token, 'update_bug_report', {
      id: reportId,
      status: 'resolved',
    })
    expect((await resolved.json()).result.content[0].text).toBe('Bug report updated')

    await adminPage.goto(`${baseUrl}/bugs/${reportId}`)
    await expect(adminPage.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 })
    await expect(adminPage.getByRole('button', { name: 'Status' })).toContainText('Resolved')

    await adminPage.goto(`${baseUrl}/admin/api-tokens`)
    const row = adminPage.getByRole('listitem', { name: tokenName })
    await expect(row).toContainText('Last used')
    await snap(adminPage, 'token used')
    await row.getByRole('button', { name: 'Revoke' }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
    await expect(row).toBeHidden()

    expect((await callTool(baseUrl, token, 'get_bug_report', { id: reportId })).status).toBe(401)
  })

  test('A volunteer is sent away from the API tokens page', async ({ volunteer, baseUrl }) => {
    await volunteer.page.goto(`${baseUrl}/admin/api-tokens`)
    await expect(volunteer.page).toHaveURL(/\/projects$/, { timeout: 10_000 })
  })
})
