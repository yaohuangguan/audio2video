import { activeCaption, formatClock } from './captions'
import type { Caption, ThemeId } from './types'
import type { OutputLocale } from './language'
import { localizeText, overlayLabels } from './language'

export type RenderConfig = {
  theme: ThemeId
  title: string
  creator: string
  accent: string
  captions: Caption[]
  duration: number
  time: number
  peaks: number[]
  cover: HTMLImageElement | null
  showWave: boolean
  showCaptions: boolean
  locale: OutputLocale
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const char of Array.from(text)) {
    const candidate = current + char
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current)
      current = char
      if (lines.length >= maxLines - 1) break
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  const consumed = lines.join('').length
  if (consumed < Array.from(text).length && lines.length) {
    let end = lines.length - 1
    while (ctx.measureText(lines[end] + '…').width > maxWidth && lines[end].length > 0) lines[end] = lines[end].slice(0, -1)
    lines[end] += '…'
  }
  return lines
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const ratio = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const dw = img.naturalWidth * ratio
  const dh = img.naturalHeight * ratio
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

export function drawVideoFrame(ctx: CanvasRenderingContext2D, w: number, h: number, config: RenderConfig) {
  const { theme, title, creator, captions, duration, time, peaks, cover, accent, showWave, showCaptions, locale } = config
  const labels = overlayLabels(locale)
  const dark = theme !== 'paper'
  const palettes: Record<ThemeId, [string, string, string]> = {
    noir: ['#111729', '#28264f', '#6653ae'],
    sunset: ['#3a2348', '#9d5c65', '#e6a078'],
    lavender: ['#554d97', '#a68bce', '#e8c5ed'],
    paper: ['#f6f0e7', '#e9e0d2', '#cab6aa'],
  }
  const [a, b, c] = palettes[theme]
  const scale = w / 720
  ctx.save()
  const bg = ctx.createLinearGradient(0, 0, w, h)
  bg.addColorStop(0, a)
  bg.addColorStop(0.62, b)
  bg.addColorStop(1, c)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  if (cover?.complete && cover.naturalWidth) {
    ctx.save()
    ctx.globalAlpha = theme === 'paper' ? 0.35 : 0.55
    drawCover(ctx, cover, w, h)
    ctx.restore()
    const shade = ctx.createLinearGradient(0, 0, 0, h)
    shade.addColorStop(0, dark ? 'rgba(7,9,24,.56)' : 'rgba(246,240,231,.55)')
    shade.addColorStop(.5, dark ? 'rgba(7,9,24,.20)' : 'rgba(246,240,231,.30)')
    shade.addColorStop(1, dark ? 'rgba(7,9,24,.82)' : 'rgba(246,240,231,.87)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, w, h)
  } else {
    ctx.globalAlpha = theme === 'paper' ? .1 : .2
    ctx.fillStyle = dark ? '#e4bcff' : '#947d78'
    ctx.beginPath()
    ctx.arc(w * .93, h * .25, w * .55, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(w * -.34, h * .82, w * .58, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  const fg = dark ? '#ffffff' : '#342e37'
  const dim = dark ? 'rgba(255,255,255,.69)' : 'rgba(52,46,55,.62)'
  const left = w * .105
  const maxWidth = w * .79
  const top = h * .115
  ctx.fillStyle = accent
  rounded(ctx, left, top, 45 * scale, 6 * scale, 4 * scale)
  ctx.fill()
  ctx.font = '600 ' + Math.round(21 * scale) + 'px system-ui, sans-serif'
  ctx.fillStyle = dim
  ctx.fillText(labels.header, left, top + 52 * scale)
  ctx.font = '700 ' + Math.round(55 * scale) + 'px system-ui, "PingFang SC", sans-serif'
  ctx.fillStyle = fg
  const titleLines = wrapText(ctx, localizeText(title || labels.fallback, locale), maxWidth, 3)
  titleLines.forEach((line, index) => ctx.fillText(line, left, top + 160 * scale + index * 80 * scale))
  const titleBottom = top + 160 * scale + Math.max(titleLines.length - 1, 0) * 80 * scale
  ctx.font = '400 ' + Math.round(23 * scale) + 'px system-ui, sans-serif'
  ctx.fillStyle = dim
  ctx.fillText(localizeText(creator || '我的声音电台', locale), left, titleBottom + 50 * scale)
  const waveY = Math.min(h * .64, Math.max(h * .48, titleBottom + 235 * scale))
  if (showWave) {
    const count = 49
    const step = maxWidth / count
    const barWidth = Math.max(2, step * .46)
    const progress = duration > 0 ? Math.min(1, time / duration) : 0
    for (let i = 0; i < count; i++) {
      const amp = peaks[i] ?? (0.2 + .7 * Math.abs(Math.sin(i * 1.91) * Math.cos(i * .35)))
      const movement = .86 + .14 * Math.sin(time * 4 + i * .48)
      const height = (16 + 86 * Math.max(.05, amp) * movement) * scale
      ctx.fillStyle = i / count < progress ? accent : (dark ? 'rgba(255,255,255,.52)' : 'rgba(52,46,55,.38)')
      rounded(ctx, left + i * step, waveY - height / 2, barWidth, height, barWidth / 2)
      ctx.fill()
    }
  }
  if (showCaptions) {
    const text = localizeText(activeCaption(captions, time)?.text ?? '', locale)
    if (text) {
      ctx.font = '600 ' + Math.round(32 * scale) + 'px system-ui, "PingFang SC", sans-serif'
      const rows = wrapText(ctx, text, maxWidth, 3)
      const lineHeight = 48 * scale
      const y = h * .78 - rows.length * lineHeight / 2
      ctx.fillStyle = fg
      rows.forEach((row, i) => {
        ctx.textAlign = 'center'
        ctx.fillText(row, w / 2, y + i * lineHeight)
      })
      ctx.textAlign = 'left'
    }
  }
  const footerY = h * .92
  ctx.fillStyle = dark ? 'rgba(255,255,255,.22)' : 'rgba(52,46,55,.2)'
  rounded(ctx, left, footerY, maxWidth, 3 * scale, 2 * scale)
  ctx.fill()
  ctx.fillStyle = accent
  rounded(ctx, left, footerY, Math.max(2, maxWidth * Math.max(0, Math.min(1, duration ? time / duration : 0))), 3 * scale, 2 * scale)
  ctx.fill()
  ctx.font = '500 ' + Math.round(18 * scale) + 'px system-ui, sans-serif'
  ctx.fillStyle = dim
  ctx.fillText(labels.footer, left, footerY + 37 * scale)
  ctx.textAlign = 'right'
  ctx.fillText(formatClock(time) + '  /  ' + formatClock(duration), left + maxWidth, footerY + 37 * scale)
  ctx.restore()
}
