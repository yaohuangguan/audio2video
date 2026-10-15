import { describe, expect, it } from 'vitest'
import { localizeCaptions, localizeText, overlayLabels } from './language'

describe('output language', () => {
  it('converts simplified to traditional Chinese without altering timestamps', () => {
    expect(localizeText('简体中文 自动字幕 视频', 'zh-TW')).toBe('簡體中文 自動字幕 視頻')
    expect(localizeCaptions([{ id: 'x', start: 1, end: 3, text: '自动字幕' }], 'zh-TW'))
      .toEqual([{ id: 'x', start: 1, end: 3, text: '自動字幕' }])
  })
  it('preserves simplified and English and localizes overlay labels', () => {
    expect(localizeText('欢迎', 'zh-CN')).toBe('欢迎')
    expect(localizeText('Hello', 'en')).toBe('Hello')
    expect(overlayLabels('zh-CN').header).toContain('声音')
    expect(overlayLabels('zh-TW').footer).toContain('音頻')
    expect(overlayLabels('en').header).toContain('AUDIO')
  })
})
