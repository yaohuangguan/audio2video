import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import sharp from 'sharp'

const palettes = {
  noir: ['#111729', '#28264f', '#6653ae'],
  sunset: ['#3a2348', '#9d5c65', '#e6a078'],
  lavender: ['#554d97', '#a68bce', '#e8c5ed'],
  paper: ['#f6f0e7', '#e9e0d2', '#cab6aa']
}
const dimensions = { portrait: [720, 1280], square: [720, 720], landscape: [1280, 720] }
function validate(raw) {
  if (!raw || !Object.hasOwn(palettes, raw.theme) || !Object.hasOwn(dimensions, raw.format)) throw new Error('Invalid theme / format')
  const start = Number(raw.clipStart), end = Number(raw.clipEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 60) throw new Error('MP4 clip must be 1–60 seconds')
  const captions = Array.isArray(raw.captions) ? raw.captions.slice(0, 200).filter(c =>
    c && typeof c.text === 'string' && c.text.length <= 200 &&
    Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start
  ) : []
  return {
    start, seconds: end - start, captions,
    theme: raw.theme, format: raw.format,
    title: String(raw.title || '').slice(0, 64),
    creator: String(raw.creator || '').slice(0, 50),
    accent: /^#[0-9a-fA-F]{6}$/.test(raw.accent) ? raw.accent : '#D5FF85',
    showWave: raw.showWave !== false, showCaptions: raw.showCaptions !== false
  }
}
const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function svgBackground(o) {
  const [w, h] = dimensions[o.format]
  const [a, b, c] = palettes[o.theme]
  const paper = o.theme === 'paper'
  const fg = paper ? '#34303a' : '#ffffff'
  const font = o.format === 'landscape' ? 45 : 52
  const lineLength = o.format === 'landscape' ? 22 : 11
  const chars = Array.from(o.title || '让每个声音都被看见')
  const lines = []
  while (chars.length && lines.length < 3) lines.push(chars.splice(0, lineLength).join(''))
  const title = lines.map((line, i) => '<text x="' + (w * .11) + '" y="' + (h * .29 + i * 74) + '" fill="' + fg + '" font-size="' + font + '" font-weight="bold">' + xml(line) + '</text>').join('')
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="' + a + '"/><stop offset=".55" stop-color="' + b + '"/><stop offset="1" stop-color="' + c + '"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#a)"/><circle cx="' + w + '" cy="' + h * .33 + '" r="' + w * .51 + '" fill="#fff" opacity=".13"/><rect x="' + w * .11 + '" y="' + h * .13 + '" width="50" height="7" rx="3" fill="' + o.accent + '"/><text x="' + w * .11 + '" y="' + h * .185 + '" font-size="18" fill="' + fg + '">AUDIO STORIES / 001</text>' + title + '<text x="' + w * .11 + '" y="' + (h * .29 + lines.length * 74 + 15) + '" font-size="23" fill="' + fg + '" opacity=".8">' + xml(o.creator) + '</text><text x="' + w * .11 + '" y="' + h * .93 + '" font-size="18" fill="' + fg + '" opacity=".8">AUDIO2VIDEO</text></svg>')
}
function srtTime(seconds) {
  const n = Math.max(0, Math.floor(seconds * 1000))
  return [Math.floor(n / 3600000), Math.floor(n / 60000) % 60, Math.floor(n / 1000) % 60].map(x => String(x).padStart(2, '0')).join(':') + ',' + String(n % 1000).padStart(3, '0')
}
function subtitles(o) {
  return o.captions.filter(c => c.end > o.start && c.start < o.start + o.seconds).map((c, i) =>
    String(i + 1) + '\n' + srtTime(Math.max(0, c.start - o.start)) + ' --> ' + srtTime(Math.min(o.seconds, c.end - o.start)) + '\n' + c.text.replace(/[\r\n]+/g, ' ') + '\n\n'
  ).join('')
}

function execFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''
    child.stderr.on('data', chunk => { errors = (errors + String(chunk)).slice(-1500) })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error('FFmpeg: ' + errors.slice(-400))))
  })
}
async function render(file, options) {
  const dir = await mkdtemp(join(tmpdir(), 'audio2video-'))
  try {
    const ext = /\.(mp3|m4a|wav|aac|ogg|webm|mp4)$/i.exec(file.name)?.[1] || 'mp3'
    const audio = join(dir, 'audio.' + ext), background = join(dir, 'bg.png'), srt = join(dir, 'captions.srt'), mp4 = join(dir, 'result.mp4')
    await Promise.all([
      writeFile(audio, Buffer.from(await file.arrayBuffer())),
      sharp(svgBackground(options)).png().toFile(background),
      writeFile(srt, subtitles(options), 'utf8')
    ])
    const [w, h] = dimensions[options.format]
    let filters = '[0:v]scale=' + w + ':' + h + ',format=yuv420p[bg];'
    if (options.showWave) {
      filters += '[1:a]asplit=2[audio][wave];[wave]showwaves=s=' + Math.round(w * .74) + 'x90:mode=line:colors=0x' + options.accent.slice(1) + ':rate=30,format=rgba[sw];[bg][sw]overlay=(W-w)/2:(H-h)*0.5:shortest=1[visual]'
    } else {
      filters += '[1:a]anull[audio];[bg]null[visual]'
    }
    if (options.showCaptions && options.captions.length) {
      filters += ';[visual]subtitles=' + srt + ':force_style=FontName=Noto Sans CJK SC,FontSize=27,Outline=2,Alignment=2,MarginV=' + Math.round(h * .17) + '[v]'
    } else {
      filters += ';[visual]null[v]'
    }
    await execFFmpeg([
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-loop', '1', '-framerate', '30', '-i', background,
      '-ss', String(options.start), '-t', String(options.seconds), '-i', audio,
      '-filter_complex', filters, '-map', '[v]', '-map', '[audio]',
      '-t', String(options.seconds), '-r', '30', '-c:v', 'libx264',
      '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', mp4
    ])
    return await readFile(mp4)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const same = (left, right) => {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''))
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}
createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"status":"ok"}')
    return
  }
  if (req.method !== 'POST' || req.url !== '/render') {
    res.writeHead(404)
    res.end()
    return
  }
  if (!process.env.RENDER_SECRET || !same(req.headers['x-render-secret'], process.env.RENDER_SECRET)) {
    res.writeHead(401)
    res.end('Unauthorized')
    return
  }
  if (Number(req.headers['content-length']) > 6 * 1024 * 1024 + 240000) {
    res.writeHead(413)
    res.end('Input too large')
    return
  }
  try {
    const incoming = new Request('http://localhost/render', {
      method: 'POST', headers: req.headers, body: Readable.toWeb(req), duplex: 'half'
    })
    const form = await incoming.formData()
    const file = form.get('file')
    if (!(file instanceof File) || !file.size || file.size > 6 * 1024 * 1024) throw new Error('Audio must be smaller than 6MB')
    const optionsText = form.get('options')
    if (typeof optionsText !== 'string' || optionsText.length > 200000) throw new Error('Invalid options')
    const options = validate(JSON.parse(optionsText))
    const mp4 = await render(file, options)
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': mp4.length, 'Cache-Control': 'no-store' })
    res.end(mp4)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unknown render error')
    res.writeHead(422, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(error instanceof Error ? error.message.slice(0, 220) : 'Render failed')
  }
}).listen(Number(process.env.PORT || 8080), '0.0.0.0')
