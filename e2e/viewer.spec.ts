import { expect, test } from '@playwright/test'

test('load a sample, filter to errors, open a step with the keyboard and read the totals', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Coding agent: fails a test fix/ }).click()

  const totals = page.getByRole('definition').filter({ hasText: 'est.' })
  await expect(totals).toHaveText(/^\$\d+\.\d{4} est\.$/)
  await expect(page.locator('.totals__item', { hasText: 'Errors' }).locator('dd')).toHaveText('5')

  const timeline = page.getByRole('listbox', { name: 'Run timeline' })
  const options = timeline.getByRole('option')
  const all = await options.count()

  await page.keyboard.press('e')
  await expect(page.getByRole('checkbox', { name: 'Errors only' })).toBeChecked()
  const errors = await options.count()
  expect(errors).toBeGreaterThan(0)
  expect(errors).toBeLessThan(all)
  await expect(page.getByText(`${errors} of ${all} shown`)).toBeVisible()

  await page.keyboard.press('t')
  await expect(timeline).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('k')
  await page.keyboard.press('Enter')

  const detail = page.getByRole('complementary', { name: 'Error: step_limit' })
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('max_steps=6')

  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(timeline).toBeFocused()
})
