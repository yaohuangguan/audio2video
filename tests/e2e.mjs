import { chromium } from 'playwright-core'
import { rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const outputDir = join(process.cwd(), '.e2e-temp')
await mkdir(outputDir, { recursive: true })
const rate = 22050, duration = 2.4, samples = Math.floor(rate * duration)
const wav = Buffer.alloc(44 + samples * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4)
wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28)
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 8000), 44 + i * 2)
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /让每个声音/ }).waitFor()
  await page.screenshot({ path: join(outputDir, 'desktop.png'), fullPage: true })
  await page.locator('input[type="file"][accept^="audio"]').setInputFiles({ name: 'demo.wav', mimeType: 'audio/wav', buffer: wav })
  await page.getByText('demo.wav').first().waitFor()
  await page.getByRole('button', { name: '字幕编辑' }).click()
  await page.getByPlaceholder(/把录音的文稿/).fill('你好，欢迎来到声音转视频。这个演示正在测试真实的声音和画面。')
  await page.getByRole('button', { name: /生成分段字幕/ }).click()
  await page.getByText('字幕时间轴').waitFor()
  const ready = page.getByRole('button', { name: /生成视频/ })
  await ready.waitFor({ state: 'visible' })
  if (await ready.isDisabled()) throw new Error('Export button should be enabled')
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  await mobile.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await mobile.screenshot({ path: join(outputDir, 'mobile.png'), fullPage: true })
  const horizontalOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  if (horizontalOverflow) throw new Error('Mobile layout overflows horizontally')
  if (errors.length) throw new Error('Browser JavaScript errors: ' + errors.join(' | '))
  console.log(JSON.stringify({ ok: true, upload: true, captions: true, mobileNoOverflow: true, videoExport: 'requires real media playback environment' }))
} finally {
  await browser.close()
  await rm(outputDir, { recursive: true, force: true })
}
