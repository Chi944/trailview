// Records the README GIF: run `npm run build && npm run preview -- --port 4173`
// in one terminal, then `node scripts/record-demo.mjs` (needs ffmpeg).
// Set PW_CHROMIUM to use an existing Chromium build.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.DEMO_URL ?? 'http://localhost:4173/'
const OUT = 'docs/media/demo.gif'
const size = { width: 1280, height: 860 }
const dir = mkdtempSync(join(tmpdir(), 'trailview-demo-'))

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
const context = await browser.newContext({ viewport: size, colorScheme: 'light', recordVideo: { dir, size } })
const page = await context.newPage()
const pause = (ms) => page.waitForTimeout(ms)
const key = async (k, ms = 350) => {
  await page.keyboard.press(k)
  await pause(ms)
}

await page.goto(URL)
await pause(1200)
await page.getByRole('button', { name: /Coding lead with sub-agents/ }).click()
await pause(1500)

// Move down the timeline into the sub-agents and open one.
await key('t')
for (let i = 0; i < 3; i++) await key('j')
await key('Enter', 1800)
await key('Escape', 500)

// Where the money went.
await key('c', 2600)
await key('c', 500)

// Search inside every event, then clear it.
const search = page.getByRole('searchbox', { name: 'Search events' })
await search.click()
await pause(300)
await search.pressSequentially('comma', { delay: 120 })
await pause(2400)
await search.fill('')
await pause(500)

// Compare with another version of the same agent.
await page.getByRole('button', { name: 'Close file' }).click()
await pause(600)
await page.getByRole('button', { name: /Two runs to compare/ }).click()
await pause(1000)
await page.getByRole('button', { name: 'Compare' }).click()
await pause(700)
await page.getByRole('button', { name: /run_oncall_9c21/ }).click()
await pause(2800)

await context.close()
await browser.close()

const video = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')))
const palette = join(dir, 'palette.png')
const filters = 'fps=6,scale=860:-1:flags=lanczos,mpdecimate'
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `${filters},palettegen=max_colors=96:stats_mode=diff`, palette])
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', palette, '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=none:diff_mode=rectangle`, '-fps_mode', 'vfr', OUT])
console.log(`Wrote ${OUT}`)
