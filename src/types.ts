export type Caption = { id: string; start: number; end: number; text: string }
export type ThemeId = 'noir' | 'sunset' | 'lavender' | 'paper'
export type FormatId = 'portrait' | 'square' | 'landscape'
export const THEMES: { id: ThemeId; name: string; description: string; colors: [string, string] }[] = [
  { id: 'noir', name: '夜色电台', description: '沉静 · 播客', colors: ['#131a32', '#485187'] },
  { id: 'sunset', name: '日落时分', description: '温暖 · 故事', colors: ['#543254', '#e78d76'] },
  { id: 'lavender', name: '梦境手记', description: '柔和 · 朗读', colors: ['#7d6bc6', '#d9b8f4'] },
  { id: 'paper', name: '留白日记', description: '极简 · 知识', colors: ['#f3eadd', '#d7c8b5'] },
]
export const FORMATS: { id: FormatId; name: string; ratio: string; width: number; height: number }[] = [
  { id: 'portrait', name: '抖音 / Reels', ratio: '9:16', width: 720, height: 1280 },
  { id: 'square', name: '方形', ratio: '1:1', width: 720, height: 720 },
  { id: 'landscape', name: '横屏', ratio: '16:9', width: 1280, height: 720 },
]
