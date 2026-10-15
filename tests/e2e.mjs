import { chromium } from 'playwright-core'
import { rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const outDir = join(process.cwd(), '.e2e-temp')
await mkdir(outDir, { recursive: true })
const rate = 16000, seconds = 2.4, samples = Math.floor(rate * seconds)
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, acceptDownloads: true })
  const errors = [], paidRequests = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('request', (req) => { if (/workers.dev|run.app/.test(req.url())) paidRequests.push(req.url()) })
  await page.route('**/local-asr-worker.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: "self.onmessage=({data})=>{self.postMessage({type:'result',id:data.id,captions:[{id:'mock1',start:0,end:2,text:'自动生成中文字幕'}]})}",
  }))
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /让每个声音/ }).waitFor()
  await page.getByText(/全部在本机处理/).waitFor()
  await page.screenshot({ path: join(outDir, 'desktop.png'), fullPage: true })
  await page.locator('input[type="file"][accept^="audio"]').setInputFiles({ name: 'demo.wav', mimeType: 'audio/wav', buffer: wav })
  await page.getByText('demo.wav').first().waitFor()
  await page.getByText('自动生成中文字幕').first().waitFor({ timeout: 12000 })
  await page.getByRole('button', { name: '字幕编辑' }).click()
  await page.getByRole('textbox', { name: '字幕 1' }).waitFor()
  await page.getByRole('combobox', { name: '视频语言' }).selectOption('zh-TW')
  await page.getByText('本机生成视频').waitFor()
  if (await page.getByRole('button', { name: /本机生成视频/ }).isDisabled()) throw new Error('Local video export disabled')
  if (paidRequests.length) throw new Error('Metered API used: ' + paidRequests.join(','))
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  await mobile.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await mobile.screenshot({ path: join(outDir, 'mobile.png'), fullPage: true })
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  if (overflow) throw new Error('iPhone layout has horizontal overflow')
  if (errors.length) throw new Error(errors.join('; '))
  console.log(JSON.stringify({ ok: true, autoCaptionFlow: true, chineseExportOption: true, noPaidApis: true, mobileLayout: true }))
} finally {
  await browser.close()
  await rm(outDir, { recursive: true, force: true })
}
