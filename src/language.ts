import { Converter } from 'opencc-js'
import type { Caption } from './types'

export type OutputLocale = 'zh-CN' | 'zh-TW' | 'en'
export type RecognitionLanguage = 'zh' | 'en' | 'auto'

const toTraditional = Converter({ from: 'cn', to: 'tw' })

export const OUTPUT_LOCALES: { value: OutputLocale; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English（不自动翻译字幕）' },
]

export const RECOGNITION_LANGUAGES: { value: RecognitionLanguage; label: string }[] = [
  { value: 'zh', label: '普通话 / 中文' },
  { value: 'auto', label: '自动检测语言' },
  { value: 'en', label: 'English' },
]

export function localizeText(text: string, locale: OutputLocale): string {
  return locale === 'zh-TW' ? toTraditional(text) : text
}

export function localizeCaptions(captions: Caption[], locale: OutputLocale): Caption[] {
  return captions.map(c => ({ ...c, text: localizeText(c.text, locale) }))
}

export function overlayLabels(locale: OutputLocale): { header: string; footer: string; fallback: string } {
  if (locale === 'zh-CN') return { header: '声音故事 / 001', footer: '音频成片', fallback: '让声音成为画面。' }
  if (locale === 'zh-TW') return { header: '聲音故事 / 001', footer: '音頻成片', fallback: '讓聲音成為畫面。' }
  return { header: 'AUDIO STORIES / 001', footer: 'AUDIO2VIDEO', fallback: 'Turn your voice into video.' }
}
