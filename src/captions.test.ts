import { describe, expect, it } from 'vitest'
import { activeCaption, exportSrt, formatClock, parseSubtitles, splitTranscript } from './captions'

describe('caption handling', () => {
  it('parses SRT and VTT timestamps', () => {
    const srt = '1\n00:00:01,250 --> 00:00:03,500\n你好世界\n\n2\n00:00:04,000 --> 00:00:06,000\n第二句'
    const parsed = parseSubtitles(srt)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ start: 1.25, end: 3.5, text: '你好世界' })
    expect(parseSubtitles('WEBVTT\n\n00:01.200 --> 00:02.800\nHello')[0].end).toBe(2.8)
  })
  it('rejects malformed subtitle blocks', () => {
    expect(parseSubtitles('junk\n\n00:02.000 --> 00:01.000\nBackwards')).toEqual([])
  })
  it('splits text proportionally and ends exactly at duration', () => {
    const parts = splitTranscript('你好，今天是星期三。我有一个故事。', 60)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0].start).toBe(0)
    expect(parts.at(-1)?.end).toBe(60)
    expect(activeCaption(parts, 59.9)).toBeDefined()
  })
  it('roundtrips SRT and formats clock', () => {
    const original = parseSubtitles('1\n00:00:01,200 --> 00:00:02,800\nHi')
    expect(parseSubtitles(exportSrt(original))[0].text).toBe('Hi')
    expect(formatClock(125)).toBe('02:05')
  })
})
