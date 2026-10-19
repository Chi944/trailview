import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function scan(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

for (const scheme of ['light', 'dark'] as const) {
  test(`no axe violations on the start screen and viewer (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/')
    expect(await scan(page)).toEqual([])

    await page.getByRole('button', { name: /Research agent/ }).click()
    await page.getByRole('listbox', { name: 'Run timeline' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('complementary')).toBeVisible()
    expect(await scan(page)).toEqual([])

    await page.keyboard.press('?')
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await scan(page)).toEqual([])
  })
}
