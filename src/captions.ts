import type { Caption } from './types'

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds)
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
}

export function formatSrtTime(seconds: number): string {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.floor(safe % 60)
  const millis = Math.round((safe % 1) * 1000)
  return [hours, minutes, secs].map((n) => String(n).padStart(2, '0')).join(':') + ',' + String(millis).padStart(3, '0')
}

function parseTimestamp(value: string): number | null {
  const numbers = value.replace(',', '.').trim().split(':').map(Number)
  if (numbers.some((number) => !Number.isFinite(number)) || numbers.length < 2 || numbers.length > 3) return null
  const [hours, minutes, seconds] = numbers.length === 3 ? numbers : [0, ...numbers]
  if (minutes >= 60 || seconds >= 60 || hours < 0 || minutes < 0 || seconds < 0) return null
  return hours * 3600 + minutes * 60 + seconds
}

export function parseSubtitles(source: string): Caption[] {
  const normalized = source.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').trim()
  const blocks = normalized.replace(/^WEBVTT[^\n]*\n/i, '').split(/\n\s*\n/)
  const captions: Caption[] = []
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    const index = lines.findIndex((line) => line.includes('-->'))
    if (index < 0) continue
    const match = lines[index].match(/([\d:,.]+)\s*-->\s*([\d:,.]+)/)
    if (!match) continue
    const start = parseTimestamp(match[1])
    const end = parseTimestamp(match[2])
    const text = lines.slice(index + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    if (start !== null && end !== null && end > start && text) {
      captions.push({ id: 'srt-' + captions.length, start, end, text })
    }
  }
  return captions.sort((a, b) => a.start - b.start)
}

export function splitTranscript(text: string, duration: number): Caption[] {
  const pieces = text
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?；;，,])\s*|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      if (part.length <= 28) return [part]
      const result: string[] = []
      for (let index = 0; index < part.length; index += 24) result.push(part.slice(index, index + 24))
      return result
    })
  if (!pieces.length) return []
  const validDuration = Number.isFinite(duration) && duration > 0 ? duration : pieces.length * 3
  const weights = pieces.map((part) => Math.max(4, Array.from(part).length))
  const sum = weights.reduce((a, b) => a + b, 0)
  let cursor = 0
  return pieces.map((part, index) => {
    const start = cursor
    cursor = index === pieces.length - 1 ? validDuration : Math.min(validDuration, cursor + weights[index] / sum * validDuration)
    return { id: 'segment-' + index, start, end: cursor, text: part }
  })
}

export function exportSrt(captions: Caption[]): string {
  return captions.map((item, index) => [
    index + 1,
    formatSrtTime(item.start) + ' --> ' + formatSrtTime(item.end),
    item.text,
  ].join('\n')).join('\n\n') + '\n'
}

export function activeCaption(captions: Caption[], time: number): Caption | undefined {
  return captions.find((caption) => time >= caption.start && time < caption.end)
}
