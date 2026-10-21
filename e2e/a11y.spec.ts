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
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Close file' }).click()
    await page.getByRole('button', { name: /Coding lead with sub-agents/ }).click()
    await page.getByRole('option', { name: /Sub-agent: explorer/ }).click()
    await expect(page.getByRole('complementary')).toBeVisible()
    expect(await scan(page)).toEqual([])

    await page.getByRole('button', { name: 'Close file' }).click()
    await page.getByRole('button', { name: /Two runs to compare/ }).click()
    await page.getByRole('button', { name: 'Compare' }).click()
    expect(await scan(page)).toEqual([])
    await page.getByRole('button', { name: /run_oncall_9c21/ }).click()
    await expect(page.getByRole('table', { name: 'Steps' })).toBeVisible()
    expect(await scan(page)).toEqual([])
  })

  test(`no axe violations while a link waits for its file (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/#file=mine.jsonl&run=r2&event=b2')
    await expect(page.getByRole('status')).toBeVisible()
    expect(await scan(page)).toEqual([])
  })

  test(`no axe violations on a long timeline that renders only the rows in view (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/')
    const lines = [JSON.stringify({ type: 'run.start', v: 1, run_id: 'long', id: 's', ts: '2026-10-20T08:00:00.000Z', agent: { name: 'crawler' } })]
    for (let i = 1; i <= 500; i++) {
      lines.push(JSON.stringify({ type: 'log', run_id: 'long', id: `l${i}`, ts: '2026-10-20T08:00:01.000Z', step: i, message: `page ${i}` }))
    }
    await page.getByTestId('file-input').setInputFiles({ name: 'long.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(lines.join('\n')) })
    await page.getByRole('listbox', { name: 'Run timeline' }).focus()
    await page.keyboard.press('PageDown')
    expect(await scan(page)).toEqual([])
  })
}
