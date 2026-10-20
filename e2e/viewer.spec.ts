import { expect, test } from '@playwright/test'

test('load a sample, filter to errors, open a step with the keyboard and read the totals', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Coding agent: fails a test fix/ }).click()

  const totals = page.getByRole('definition').filter({ hasText: 'est.' })
  await expect(totals).toHaveText(/^\$\d+\.\d{4} est\.$/)
  await expect(page.locator('.totals__item', { hasText: 'Errors' }).locator('dd')).toHaveText('4')

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
  await expect(detail).toContainText('max_steps=8')

  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(timeline).toBeFocused()
})

test('open an OpenTelemetry trace and see the approval it waited on', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /OpenTelemetry trace/ }).click()

  await expect(page.getByText('OpenTelemetry (OTLP JSON)')).toBeVisible()
  await expect(page.locator('.totals__item', { hasText: 'Model calls' }).locator('dd')).toHaveText('4')
  await expect(page.locator('.totals__item', { hasText: 'Waiting on approvals' }).locator('dd')).toHaveText('28.9 s')

  await page.getByRole('option', { name: /Approval requested/ }).click()
  await expect(page.getByRole('complementary')).toContainText('refund_over_50')
})

test('open a LangSmith export and see the failed query the agent recovered from', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /LangSmith export/ }).click()

  await expect(page.getByText('LangSmith runs')).toBeVisible()
  await expect(page.locator('.totals__item', { hasText: 'Model calls' }).locator('dd')).toHaveText('7')

  await page.keyboard.press('e')
  const failed = page.getByRole('option', { name: /run_query/ })
  await expect(failed).toHaveCount(1)
  await failed.click()
  await expect(page.getByRole('complementary')).toContainText('category_name does not exist')
})

test('open a run that crashed mid-call and see the call that never finished', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Data backfill agent/ }).click()
  await expect(page.getByText('incomplete', { exact: true }).first()).toBeVisible()

  const row = page.getByRole('option', { name: /run_extract Started but never finished/ })
  await expect(row).toContainText('unfinished')
  await row.click()
  const detail = page.getByRole('complementary', { name: 'run_extract' })
  await expect(detail).toContainText('tool.start · unfinished')
  await expect(detail).toContainText('the log ends before this call returned')
  await expect(detail).toContainText('etl-worker-3')
})

test('compare two versions of an agent and see where they diverge', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Two runs to compare/ }).click()
  await page.getByRole('button', { name: 'Compare' }).click()
  await page.getByRole('button', { name: /run_oncall_9c21/ }).click()

  await expect(page.getByText('The runs first differ at A step 3')).toBeVisible()
  const cost = page.getByRole('table', { name: 'Totals' }).getByRole('row', { name: /^Cost/ })
  await expect(cost).toContainText('$0.0755')
  await expect(cost).toContainText('$0.0507')
  await expect(page.getByRole('table', { name: 'Steps' }).getByRole('row')).toHaveCount(7)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox', { name: 'Run timeline' })).toBeVisible()
})

// Enough steps that the timeline renders only the rows in view.
function longLog(steps: number): Buffer {
  const lines = [JSON.stringify({ type: 'run.start', v: 1, run_id: 'long', id: 's', ts: '2026-10-20T08:00:00.000Z', agent: { name: 'crawler' } })]
  for (let i = 1; i <= steps; i++) {
    const ts = new Date(Date.UTC(2026, 9, 20, 8) + i * 1000).toISOString()
    lines.push(JSON.stringify({ type: 'model.call', run_id: 'long', id: `m${i}`, ts, step: i, provider: 'p', model: 'm', duration_ms: 400, status: 'ok' }))
    lines.push(JSON.stringify({ type: 'tool.call', run_id: 'long', id: `t${i}`, ts, step: i, tool: `fetch_${i}`, duration_ms: 200, status: 'ok' }))
  }
  return Buffer.from(lines.join('\n'))
}

test('a long run stays fast to move through and keeps the selection in view', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles({ name: 'long.jsonl', mimeType: 'application/x-ndjson', buffer: longLog(3000) })

  const timeline = page.getByRole('listbox', { name: 'Run timeline' })
  await expect(page.getByText('6001 of 6001 shown')).toBeVisible()
  expect(await page.getByRole('option').count()).toBeLessThan(100)

  await timeline.focus()
  await page.keyboard.press('End')
  const last = page.getByRole('option', { name: /fetch_3000/ })
  await expect(last).toHaveAttribute('aria-selected', 'true')
  await expect(last).toBeInViewport()
  await expect(last).toHaveAttribute('aria-posinset', '6001')

  await page.keyboard.press('Home')
  await expect(page.getByRole('option', { name: /Run started/ })).toBeInViewport()
  await page.keyboard.press('PageDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary')).toBeVisible()
})
