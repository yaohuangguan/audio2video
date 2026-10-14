import { Buffer } from 'node:buffer'
import { parseSubtitles } from '../src/captions'

interface Env {
  AI: { run: (model: string, data: Record<string, unknown>) => Promise<unknown> }
  DB: D1Database
  RATE: { limit: (args: { key: string }) => Promise<{ success: boolean }> }
  ACCESS_KEY: string
  RENDER_SECRET?: string
  RENDER_URL?: string
}
const ORIGINS = new Set(['https://audio2video.pages.dev', 'http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_UPLOAD = 6 * 1024 * 1024
const DAILY_LIMIT = 12

const headersFor = (request: Request) => {
  const origin = request.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'https://audio2video.pages.dev',
    'Access-Control-Allow-Headers': 'Content-Type, X-Audio2Video-Key',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  }
}
function respond(request: Request, data: unknown, status = 200) {
  return Response.json(data, { status, headers: headersFor(request) })
}
function equal(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}
function sanitizeCaptions(entries: unknown[]) {
  return entries.slice(0, 1000).flatMap((candidate, i) => {
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as Record<string, unknown>
    if (typeof item.start !== 'number' || typeof item.end !== 'number' || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start || item.end > 100000 || typeof item.text !== 'string') return []
    const text = item.text.trim().slice(0, 250)
    return text ? [{ id: String(i), start: item.start, end: item.end, text }] : []
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headersFor(request) })
    const path = new URL(request.url).pathname
    if (path === '/health' && request.method === 'GET') return respond(request, { status: 'ok', transcription: true, cloudMp4: Boolean(env.RENDER_URL) })
    if (request.method !== 'POST' || !['/transcribe', '/render'].includes(path)) return respond(request, { error: 'Not found' }, 404)
    const origin = request.headers.get('origin')
    if (origin && !ORIGINS.has(origin)) return respond(request, { error: 'Forbidden origin' }, 403)
    if (!equal(request.headers.get('x-audio2video-key') || '', env.ACCESS_KEY)) return respond(request, { error: '请输入正确的内测访问码' }, 401)
    const length = Number(request.headers.get('content-length') || 0)
    if (length > MAX_UPLOAD + 1024 * 128) return respond(request, { error: '文件过大，单次限制 6MB' }, 413)
    const rate = await env.RATE.limit({ key: 'owner-costly-api' })
    if (!rate.success) return respond(request, { error: '请求太频繁，请稍后重试' }, 429)
    const day = new Date().toISOString().slice(0, 10)
    const quota = await env.DB.prepare(
      'INSERT INTO daily_usage(day, used) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET used = used + 1 WHERE used < ?2 RETURNING used'
    ).bind(day, DAILY_LIMIT).first<{ used: number }>()
    if (!quota) return respond(request, { error: '今日云端试用额度已用完（12次），请明天重试' }, 429)
    try {
      const body = await request.formData()
      const file = body.get('file')
      if (!(file instanceof File) || !file.size || file.size > MAX_UPLOAD) return respond(request, { error: '请选择不超过 6MB 的音频' }, 400)
      if (!/^audio\/|^video\/mp4$|^application\/octet-stream$/.test(file.type) && !/\.(mp3|wav|m4a|aac|ogg|webm|mp4)$/i.test(file.name)) {
        return respond(request, { error: '不支持的音频格式' }, 415)
      }
      if (path === '/transcribe') {
        const bytes = Buffer.from(await file.arrayBuffer())
        const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
          audio: bytes.toString('base64'),
          task: 'transcribe',
          language: String(body.get('language') || 'zh'),
          vad_filter: false,
        }) as { segments?: unknown[]; vtt?: string; text?: string }
        const segments = sanitizeCaptions(Array.isArray(result.segments) ? result.segments : [])
        const fallback = !segments.length && typeof result.vtt === 'string' ? parseSubtitles(result.vtt) : []
        if (!segments.length && !fallback.length) return respond(request, { error: '模型未返回有效时间戳，请更换音频重试' }, 422)
        return respond(request, { captions: segments.length ? segments : fallback, text: result.text || '', remaining: Math.max(0, DAILY_LIMIT - quota.used) })
      }
      if (!env.RENDER_URL || !env.RENDER_SECRET) return respond(request, { error: 'MP4 渲染服务还未开通' }, 503)
      const proxyForm = new FormData()
      proxyForm.set('file', file, file.name)
      const rawOptions = body.get('options')
      if (typeof rawOptions !== 'string' || rawOptions.length > 200_000) return respond(request, { error: '渲染参数无效' }, 400)
      proxyForm.set('options', rawOptions)
      const response = await fetch(env.RENDER_URL + '/render', {
        method: 'POST',
        headers: { 'X-Render-Secret': env.RENDER_SECRET },
        body: proxyForm,
        signal: AbortSignal.timeout(180_000),
      })
      if (!response.ok) {
        const failure = await response.text()
        return respond(request, { error: failure.slice(0, 300) || '渲染失败' }, response.status >= 500 ? 502 : response.status)
      }
      const outputHeaders = new Headers(headersFor(request))
      outputHeaders.set('Content-Type', 'video/mp4')
      outputHeaders.set('Content-Disposition', 'attachment; filename="audio2video.mp4"')
      return new Response(response.body, { status: 200, headers: outputHeaders })
    } catch (error) {
      console.error('audio2video processing failed', error instanceof Error ? error.name : 'unknown')
      return respond(request, { error: '云端处理暂时不可用，请缩短音频或稍后重试' }, 502)
    }
  },
} satisfies ExportedHandler<Env>
