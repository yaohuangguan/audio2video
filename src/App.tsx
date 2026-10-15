import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioLines, ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleHelp,
  Clock3, CloudUpload, Download, Captions as FileCaptions, Film, Headphones,
  ImagePlus, Layers3, LoaderCircle, Music2, Pause, Play, Plus, Scissors,
  Settings2, ShieldCheck, Sparkles, Subtitles, Trash2, UploadCloud, WandSparkles, X
} from 'lucide-react'
import { activeCaption, exportSrt, formatClock, parseSubtitles, splitTranscript } from './captions'
import { drawVideoFrame } from './render'
import { localizeCaptions, OUTPUT_LOCALES } from './language'
import type { OutputLocale } from './language'
import { prepareAudio, recognizeLocally } from './localAsr'
import type { RecognitionJob } from './localAsr'
import { FORMATS, THEMES } from './types'
import type { Caption, FormatId, ThemeId } from './types'

// Free local-only mode. No paid speech API or rendering server.
const DEFAULT_PEAKS = Array.from({ length: 49 }, (_, i) => .17 + .77 * Math.abs(Math.sin(i * 1.69) * Math.cos(i * .61)))
const ACCENTS = ['#d5ff85', '#f5b68e', '#b9a4ff', '#ffffff']

function supportedRecordingType() {
  if (!('MediaRecorder' in window)) return ''
  return [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function prepareFileName(source: string) {
  return (source.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-').slice(0, 64) || 'audio2video')
}

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [theme, setTheme] = useState<ThemeId>('noir')
  const [format, setFormat] = useState<FormatId>('portrait')
  const [title, setTitle] = useState('让每个声音，都被看见。')
  const [creator, setCreator] = useState('我的声音日记')
  const [accent, setAccent] = useState(ACCENTS[0])
  const [captions, setCaptions] = useState<Caption[]>([])
  const [transcript, setTranscript] = useState('')
  const [showWave, setShowWave] = useState(true)
  const [showCaptions, setShowCaptions] = useState(true)
  const [peaks, setPeaks] = useState<number[]>(DEFAULT_PEAKS)
  const [cover, setCover] = useState<HTMLImageElement | null>(null)
  const [tab, setTab] = useState<'style' | 'captions'>('style')
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [output, setOutput] = useState<{ url: string; name: string; mime: string; blob: Blob } | null>(null)
  const [notice, setNotice] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [autoCaption, setAutoCaption] = useState(true)
  const [recognitionStatus, setRecognitionStatus] = useState('')
  const [outputLocale, setOutputLocale] = useState<OutputLocale>('zh-CN')
  const runningJob = useRef<RecognitionJob | null>(null)
  const audioSerial = useRef(0)
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const subtitleRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const destination = useRef<MediaStreamAudioDestinationNode | null>(null)
  const source = useRef<MediaElementAudioSourceNode | null>(null)
  const exportLock = useRef(false)
  const dims = FORMATS.find((item) => item.id === format)!

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
  }, [audioUrl])
  useEffect(() => () => {
    if (output) URL.revokeObjectURL(output.url)
  }, [output])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    let frame = 0
    const render = () => {
      const current = audioRef.current?.currentTime || 0
      drawVideoFrame(ctx, dims.width, dims.height, {
        theme, title, creator, accent, duration, time: current, peaks,
        captions, cover, showWave, showCaptions, locale: outputLocale
      })
      frame = requestAnimationFrame(render)
    }
    render()
    return () => cancelAnimationFrame(frame)
  }, [theme, title, creator, accent, duration, peaks, captions, cover, showWave, showCaptions, outputLocale, dims.width, dims.height])

  const ensureAudioGraph = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) throw new Error('没有音频')
    if (!audioContext.current) {
      const ctx = new AudioContext()
      const node = ctx.createMediaElementSource(audio)
      const dest = ctx.createMediaStreamDestination()
      node.connect(ctx.destination)
      node.connect(dest)
      audioContext.current = ctx
      source.current = node
      destination.current = dest
    }
    if (audioContext.current.state === 'suspended') await audioContext.current.resume()
    return destination.current!
  }, [])

  async function importAudio(file: File) {
    const extensionOk = /\.(mp3|m4a|mp4|wav|aac|ogg|webm|flac)$/i.test(file.name)
    if (!file.type.startsWith('audio/') && !extensionOk) {
      setNotice('请选择 MP3、M4A、WAV 或其他音频文件')
      return
    }
    if (file.size > 250 * 1024 * 1024) {
      setNotice('目前仅支持不超过 250MB 的文件')
      return
    }
    audioSerial.current++
    runningJob.current?.cancel()
    runningJob.current = null
    setTranscribing(false)
    setRecognitionStatus('')
    audioRef.current?.pause()
    setIsPlaying(false)
    setTime(0)
    setDuration(0)
    setClipStart(0)
    setClipEnd(0)
    setCaptions([])
    setTranscript('')
    setOutput(null)
    setPeaks(DEFAULT_PEAKS)
    setAudioFile(file)
    setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').slice(0, 48))
    const url = URL.createObjectURL(file)
    setAudioUrl(url)
    setNotice('音频已导入，可以选择模板、导入字幕或直接生成视频')
    if (file.size < 12 * 1024 * 1024) {
      try {
        const buffer = await file.arrayBuffer()
        const ctx = new AudioContext()
        const decoded = await ctx.decodeAudioData(buffer)
        const data = decoded.getChannelData(0)
        const next = Array.from({ length: 49 }, (_, i) => {
          const start = Math.floor(i / 49 * data.length)
          const end = Math.min(data.length, start + Math.floor(data.length / 49))
          const stride = Math.max(1, Math.floor((end - start) / 600))
          let sum = 0
          let count = 0
          for (let n = start; n < end; n += stride) { sum += data[n] * data[n]; count++ }
          return Math.max(.08, Math.min(1, Math.sqrt(sum / Math.max(1, count)) * 3.7))
        })
        setPeaks(next)
        void ctx.close()
      } catch {
        setPeaks(DEFAULT_PEAKS)
      }
    }
  }

  function onFileDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void importAudio(file)
  }

  async function importSubtitles(file: File) {
    const text = await file.text()
    const parsed = parseSubtitles(text)
    if (!parsed.length) {
      setNotice('字幕格式不正确：请使用标准 SRT 或 VTT 文件')
      return
    }
    setCaptions(parsed)
    setTab('captions')
    setNotice('已导入 ' + parsed.length + ' 条同步字幕')
  }

  function generateFromTranscript() {
    if (!transcript.trim()) {
      setNotice('先粘贴需要显示的文稿')
      return
    }
    const generated = splitTranscript(transcript.trim(), duration || 60)
    setCaptions(generated)
    setNotice('已将文稿分成 ' + generated.length + ' 段。注意：这是按字数估算的时间，请手动校准，并非语音识别。')
  }

  async function transcribeAudio(file: File | null = audioFile, seconds = duration) {
    if (!file || transcribing || runningJob.current) return
    if (seconds > 90) {
      setNotice('免费本地字幕目前支持最长 90 秒录音，较长录音可分段制作，或导入 SRT / 粘贴文稿。')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setNotice('本地识别建议使用小于 20MB 的 MP3/M4A。仍可导入字幕并生成视频。')
      return
    }
    const serial = audioSerial.current
    setTranscribing(true)
    setRecognitionStatus('正在准备音频…')
    try {
      const { samples, duration: actualDuration } = await prepareAudio(file, 90)
      if (serial !== audioSerial.current) return
      const job = recognizeLocally(samples, actualDuration, 'zh', setRecognitionStatus)
      runningJob.current = job
      const generated = await job.promise
      if (serial !== audioSerial.current) return
      if (!generated.length) throw new Error('没有识别到语音，可以重新录音或手动添加字幕')
      setCaptions(generated)
      setTranscript(generated.map(item => item.text).join(''))
      setShowCaptions(true)
      setTab('captions')
      setNotice('自动生成了 ' + generated.length + ' 条中文同步字幕，视频导出时会直接烧录')
    } catch (error) {
      if (serial === audioSerial.current) setNotice('本地识别未完成：' + (error instanceof Error ? error.message : '请改用字幕文件'))
    } finally {
      if (serial === audioSerial.current) {
        setTranscribing(false)
        setRecognitionStatus('')
        runningJob.current = null
      }
    }
  }

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio || !audioFile) { fileRef.current?.click(); return }
    if (!audio.paused) { audio.pause(); setIsPlaying(false); return }
    try {
      await ensureAudioGraph()
      await audio.play()
      setIsPlaying(true)
    } catch {
      setNotice('音频播放失败，请尝试重新导入文件')
    }
  }

  function updateCaption(id: string, key: keyof Pick<Caption, 'start' | 'end' | 'text'>, value: string) {
    setCaptions((current) => current.map((item) => item.id === id
      ? { ...item, [key]: key === 'text' ? value : Math.max(0, Number(value) || 0) }
      : item))
  }

  async function shareOutput() {
    if (!output) return
    if (!navigator.share) {
      setNotice('此浏览器暂不支持系统分享，请使用「保存视频」按钮')
      return
    }
    try {
      const file = new File([output.blob], output.name, { type: output.mime })
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        setNotice('Safari 暂不支持分享此文件，请先保存到「文件」App')
        return
      }
      await navigator.share({ files: [file], title: '我的声音视频' })
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError')
        setNotice('分享失败，请使用「保存视频」按钮')
    }
  }

  async function exportVideo() {
    if (exportLock.current || !audioFile || !audioRef.current || !canvasRef.current) {
      if (!audioFile) fileRef.current?.click()
      return
    }
    const mime = supportedRecordingType()
    if (!mime || typeof canvasRef.current.captureStream !== 'function') {
      setNotice('此浏览器无法录制 Canvas 视频，请使用较新的 Safari 或 Chrome')
      return
    }
    exportLock.current = true
    setExporting(true)
    setOutput(null)
    setExportProgress(0)
    const audio = audioRef.current
    let capture: MediaStream | null = null
    let recorded: MediaStream | null = null
    const start = Math.min(clipStart, Math.max(0, duration - .1))
    const end = Math.min(duration, Math.max(start + .1, clipEnd || duration))
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && end - start > 60) { setNotice('iPhone 为了稳定请截取不超过 60 秒的视频，修改「结束时间」后重试。'); setExporting(false); exportLock.current = false; return }
    let recorder: MediaRecorder | undefined
    let listener: (() => void) | undefined
    let watchdog: ReturnType<typeof setInterval> | undefined
    let playbackError = ''
    try {
      const dest = await ensureAudioGraph()
      audio.pause()
      audio.currentTime = start
      setIsPlaying(false)
      capture = canvasRef.current.captureStream(30)
      recorded = new MediaStream([...capture.getVideoTracks(), ...dest.stream.getAudioTracks()])
      const chunks: Blob[] = []
      recorder = new MediaRecorder(recorded, { mimeType: mime, videoBitsPerSecond: 2_200_000, audioBitsPerSecond: 128_000 })
      const activeRecorder = recorder
      const finished = new Promise<Blob>((resolve, reject) => {
        activeRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
        activeRecorder.onerror = () => reject(new Error('视频编码发生错误'))
        activeRecorder.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }))
      })
      listener = () => {
        setExportProgress(Math.min(100, (audio.currentTime - start) / (end - start) * 100))
        if (audio.currentTime >= end - .05 || audio.ended) {
          audio.pause()
          if (activeRecorder.state !== 'inactive') activeRecorder.stop()
        }
      }
      audio.addEventListener('timeupdate', listener)
      audio.addEventListener('ended', listener)
      let lastProgressTime = Date.now()
      let previousTime = audio.currentTime
      watchdog = setInterval(() => {
        if (audio.currentTime > previousTime + .02) {
          previousTime = audio.currentTime
          lastProgressTime = Date.now()
        }
        if (Date.now() - lastProgressTime > 8000) {
          playbackError = '音频播放没有推进，请检查浏览器的媒体播放权限，或换 Safari / Chrome 重试。'
          if (activeRecorder.state !== 'inactive') activeRecorder.stop()
        }
      }, 500)
      activeRecorder.start(1000)
      await audio.play()
      const blob = await finished
      if (playbackError) throw new Error(playbackError)
      if (!blob.size) throw new Error('视频为空，请重试')
      const extension = mime.includes('mp4') ? '.mp4' : '.webm'
      const name = prepareFileName(audioFile.name) + '-audio2video' + extension
      const url = URL.createObjectURL(blob)
      setOutput({ name, mime, url, blob })
      setExportProgress(100)
      setNotice(extension === '.mp4' ? 'MP4 视频已生成，可下载或分享' : '已生成 WebM 视频；当前浏览器不支持原生 MP4 录制，可用 Safari 或视频转换工具转成 MP4')
    } catch (error) {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      setNotice(error instanceof Error ? error.message : '视频导出失败')
    } finally {
      if (watchdog) clearInterval(watchdog)
      if (listener) {
        audio.removeEventListener('timeupdate', listener)
        audio.removeEventListener('ended', listener)
      }
      capture?.getTracks().forEach((track) => track.stop())
      recorded?.getVideoTracks().forEach((track) => track.stop())
      audio.pause()
      setIsPlaying(false)
      setExporting(false)
      exportLock.current = false
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand-mark"><AudioLines size={22} strokeWidth={2.7} /></span><div><strong>audio<span>2</span>video</strong><small>CREATE SOMETHING HEARD.</small></div></div>
        <nav className="header-nav"><a className="nav-active" href="#studio">创作工作台</a><button className="nav-link" onClick={() => setShowHelp(true)}>如何使用 <CircleHelp size={14}/></button></nav>
        <div className="header-end"><span className="local-badge"><ShieldCheck size={14}/> 本地优先 · 无需登录</span><button className="header-action" onClick={() => setShowHelp(true)}>使用指南 <ArrowRight size={15}/></button></div>
      </header>

      <main className="page" id="studio">
        <section className="intro">
          <div className="eyebrow"><Sparkles size={15}/> 音频创作，一步到位 <span className="eyebrow-line"/></div>
          <div className="intro-row"><div><h1>让每个声音，<em>都被看见。</em></h1><p>上传一段录音，配上同步字幕和动人画面。轻松创作专属于你的短视频。</p></div><span className="project-pill"><span className="status-dot"/> 新项目 · 未命名创作</span></div>
        </section>

        <section className="workspace">
          <div className="panel left-panel">
            <div className="panel-title"><span className="step">01</span><div><h2>音频素材</h2><p>让创作从你的声音开始</p></div></div>
            <div className="local-only-note"><ShieldCheck size={16}/> 全部在本机处理 · 不上传音频 · 无需账号或付费</div>
            <label className="toggle-setting mom-auto"><span><Subtitles size={16}/> 导入后自动生成中文字幕</span><input type="checkbox" checked={autoCaption} onChange={e => setAutoCaption(e.target.checked)}/><i/></label>
            <p className="help-copy">免费 Whisper 本地识别：首次在 Wi-Fi 下下载模型，支持最长 90 秒。iPhone 识别可能较慢，失败可手动导入字幕。</p>
            {transcribing && <div className="local-working"><LoaderCircle size={15} className="spin"/><span>{recognitionStatus || '正在识别…'}</span><button onClick={() => runningJob.current?.cancel()}>取消</button></div>}
            <input ref={fileRef} type="file" className="hidden" accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importAudio(file); e.target.value = '' }} />
            <div className={'dropzone ' + (dragging ? 'dragging' : '') + (audioFile ? ' has-file' : '')} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onFileDrop} onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click() }}>
              {audioFile ? <><span className="upload-icon loaded"><Music2 size={23}/></span><strong className="file-name">{audioFile.name}</strong><span>{(audioFile.size / 1024 / 1024).toFixed(1)} MB · {formatClock(duration)} · 点击替换</span></> : <><span className="upload-icon"><CloudUpload size={25}/></span><strong>点击或拖拽上传音频</strong><span>MP3, M4A, WAV, FLAC 等格式</span><div className="upload-pill"><Plus size={15}/> 选择音频文件</div></>}
            </div>
            <audio ref={audioRef} src={audioUrl || undefined} preload="metadata" onLoadedMetadata={(e) => { const seconds = e.currentTarget.duration; if (Number.isFinite(seconds)) { setDuration(seconds); setClipEnd(seconds); if (autoCaption && audioFile && seconds <= 90) void transcribeAudio(audioFile, seconds); else if (autoCaption && seconds > 90) setNotice('录音超过90秒，建议截成短视频后导入字幕或粘贴文稿') } }} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onError={() => setNotice('浏览器无法解码此音频，请改用 MP3、M4A 或 WAV')} />
            {audioFile && <div className="audio-mini"><button className="audio-mini-play" disabled={exporting} onClick={() => void togglePlayback()}>{isPlaying ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button><div className="audio-mini-info"><div className="mini-label"><span>音频预览</span><span>{formatClock(time)} / {formatClock(duration)}</span></div><input aria-label="音频进度" type="range" min="0" max={duration || 1} step=".1" value={time} disabled={exporting} onChange={(e) => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value); setTime(Number(e.target.value)) }}/></div></div>}
            <div className="section-divider"/>
            <div className="small-heading"><span><Scissors size={16}/> 视频片段</span><span className="subtle">按需截取</span></div>
            <div className="trim-grid"><label>开始时间<input type="number" min="0" max={duration} step=".1" value={clipStart} disabled={!audioFile || exporting} onChange={(e) => setClipStart(Math.max(0, Math.min(duration, Number(e.target.value) || 0)))}/></label><label>结束时间<input type="number" min={clipStart} max={duration} step=".1" value={Number(clipEnd.toFixed(1))} disabled={!audioFile || exporting} onChange={(e) => setClipEnd(Math.max(clipStart, Math.min(duration, Number(e.target.value) || 0)))}/></label></div>
            <p className="help-copy"><Clock3 size={14}/> 秒为单位；可以只导出长录音中的精彩片段。</p>
            <div className="section-divider"/>
            <div className="small-heading"><span><FileCaptions size={16}/> 字幕与文稿</span><span className="subtle">可选</span></div>
            <button className="outline-action" onClick={() => subtitleRef.current?.click()}><Subtitles size={17}/> 导入 SRT / VTT 字幕 <UploadCloud size={16} className="push-right"/></button>
            <input ref={subtitleRef} type="file" accept=".srt,.vtt,text/vtt" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importSubtitles(file); e.target.value = '' }}/>
            <button className="outline-action secondary-outline" onClick={() => { setTab('captions'); if (!audioFile) setNotice('请先上传音频，再输入文稿') }}><WandSparkles size={17}/> 粘贴文稿并按时长分段 <ArrowRight size={16} className="push-right"/></button>
            {captions.length > 0 && <div className="caption-count"><Check size={14}/> 已加载 {captions.length} 条字幕 <button onClick={() => { const blob = new Blob([exportSrt(localizeCaptions(captions, outputLocale))], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = outputLocale === 'zh-TW' ? '字幕-繁體中文.srt' : '字幕-简体中文.srt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>下载 SRT</button></div>}
          </div>

          <div className="panel preview-panel">
            <div className="panel-title preview-title"><span className="step">02</span><div><h2>实时画面预览</h2><p>本地实时预览 · 中文字幕会烧录到视频</p></div><div className="preview-format"><Film size={14}/> {dims.ratio}</div></div>
            <div className="stage"><div className="stage-glow"/><div className={'canvas-frame ' + format}><canvas ref={canvasRef} width={dims.width} height={dims.height} aria-label="视频实时预览" /></div></div>
            <div className="preview-controls"><button className="play-button" onClick={() => void togglePlayback()} disabled={exporting}>{isPlaying ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</button><div className="preview-progress"><input type="range" aria-label="时间轴" min="0" max={duration || 1} step=".1" value={time} disabled={!audioFile || exporting} onChange={(e) => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value); setTime(Number(e.target.value)) }}/><div className="preview-time"><span>{formatClock(time)}</span><span>{formatClock(duration)}</span></div></div><span className="play-speed">1.0×</span></div>
            <div className="stage-footnote"><span><ShieldCheck size={14}/> 画面在浏览器本地实时绘制</span><span>预览与导出使用同一画面</span></div>
          </div>

          <div className="panel right-panel">
            <div className="panel-title"><span className="step">03</span><div><h2>个性化创作</h2><p>打造属于你的视听风格</p></div></div>
            <div className="tabs"><button className={tab === 'style' ? 'selected' : ''} onClick={() => setTab('style')}><Layers3 size={15}/> 画面设计</button><button className={tab === 'captions' ? 'selected' : ''} onClick={() => setTab('captions')}><Subtitles size={15}/> 字幕编辑{captions.length > 0 && <span className="count-dot"/>}</button></div>
            {tab === 'style' ? <div className="settings-body">
              <div className="setting-label">视觉模板 <span>选择画面氛围</span></div>
              <div className="theme-grid">{THEMES.map((item) => <button key={item.id} className={'theme-card ' + (theme === item.id ? 'theme-selected' : '')} onClick={() => { setTheme(item.id); if (item.id === 'paper') setAccent('#6250c3') }}><div className={'theme-swatch ' + item.id}><div className="swatch-lines"><span/><span/><span/><span/><span/></div>{theme === item.id && <span className="theme-check"><Check size={11}/></span>}</div><strong>{item.name}</strong><small>{item.description}</small></button>)}</div>
              <div className="section-divider"/>
              <label className="setting-label" htmlFor="title-input">视频标题</label><input id="title-input" className="text-input" maxLength={64} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="写一个吸引人的标题"/>
              <label className="setting-label" htmlFor="creator-input">频道 / 创作者</label><input id="creator-input" className="text-input" maxLength={50} value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="你的频道名称"/>
              <div className="setting-label">强调色</div><div className="accent-row">{ACCENTS.map((color) => <button key={color} className={'accent-dot ' + (accent === color ? 'accent-active' : '')} style={{ backgroundColor: color }} onClick={() => setAccent(color)} aria-label={'选择颜色 ' + color}>{accent === color && <Check size={14} color="#27303b"/>}</button>)}</div>
              <button className="outline-action" onClick={() => imageRef.current?.click()}><ImagePlus size={16}/> {cover ? '替换自定义背景' : '上传自定义背景'} <Plus size={16} className="push-right"/></button><input ref={imageRef} type="file" className="hidden" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 15 * 1024 * 1024) { setNotice('背景图片需小于 15MB'); return } const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { setCover(img); URL.revokeObjectURL(url) }; img.onerror = () => { setNotice('图片加载失败'); URL.revokeObjectURL(url) }; img.src = url; e.target.value = '' }}/>{cover && <button className="quiet-action" onClick={() => setCover(null)}>移除自定义背景</button>}
              <div className="section-divider"/>
              <div className="setting-label">画面元素</div>
              <label className="toggle-setting"><span><AudioLines size={16}/> 动态声波</span><input type="checkbox" checked={showWave} onChange={(e) => setShowWave(e.target.checked)}/><i/></label>
              <label className="toggle-setting"><span><Subtitles size={16}/> 显示字幕</span><input type="checkbox" checked={showCaptions} onChange={(e) => setShowCaptions(e.target.checked)}/><i/></label>
            </div> : <div className="settings-body caption-settings">
              <div className="setting-label">本机自动生成字幕 <span>免费 Whisper · 中文</span></div><button className="outline-action" onClick={() => void transcribeAudio()} disabled={!audioFile || transcribing}>{transcribing ? <LoaderCircle size={16} className="spin"/> : <Sparkles size={16}/>} {transcribing ? (recognitionStatus || '本机识别中…') : '免费识别中文并自动加字幕'} <ArrowRight size={16} className="push-right"/></button>
              <p className="muted-warning">音频只在当前设备处理。首次需下载模型并保持页面开启，iPhone 性能较弱时可导入 SRT 字幕。</p>
              <div className="section-divider"/>
              <label className="setting-label" htmlFor="transcript-input">粘贴完整文稿 <span>按字数估算时间轴</span></label><textarea id="transcript-input" className="transcript-input" rows={5} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="把录音的文稿粘贴到这里。系统会自动分句并创建时间轴，之后你可以手动校准。"/>
              <button className="solid-minor" onClick={generateFromTranscript} disabled={!transcript.trim()}>生成分段字幕 <ArrowRight size={15}/></button>
              <div className="section-divider"/>
              <div className="setting-label">字幕时间轴 <span>{captions.length} 段</span></div>
              <div className="caption-editor">{captions.slice(0, 80).map((item, index) => <div className={'caption-item ' + (activeCaption(captions, time)?.id === item.id ? 'caption-active' : '')} key={item.id}><div className="caption-item-top"><span>#{String(index + 1).padStart(2, '0')}</span><button onClick={() => setCaptions((current) => current.filter((entry) => entry.id !== item.id))} aria-label="删除字幕"><Trash2 size={14}/></button></div><textarea aria-label={'字幕 ' + (index + 1)} value={item.text} onChange={(e) => updateCaption(item.id, 'text', e.target.value)} rows={2}/><div className="caption-times"><input aria-label="开始秒数" type="number" min="0" step=".1" value={Number(item.start.toFixed(2))} onChange={(e) => updateCaption(item.id, 'start', e.target.value)}/><span>—</span><input aria-label="结束秒数" type="number" min="0" step=".1" value={Number(item.end.toFixed(2))} onChange={(e) => updateCaption(item.id, 'end', e.target.value)}/></div></div>)}</div>
              {captions.length > 80 && <p className="help-copy">为保证手机性能，仅展示前 80 段。可导出 SRT 编辑完整内容。</p>}
              <button className="outline-action" onClick={() => setCaptions((current) => [...current, { id: 'manual-' + Date.now(), start: time, end: time + 3, text: '新字幕' }].sort((a, b) => a.start - b.start))}><Plus size={16}/> 在当前位置新增字幕</button>
            </div>}
          </div>
        </section>

        <section className="export-panel"><div className="export-heading"><div className="export-symbol"><Download size={23}/></div><div><h2>准备好分享你的声音了吗？</h2><p>真实音频 + 动态画面 + 同步字幕，直接导出可发布的视频。</p></div></div><div className="export-options"><label className="export-select"><span>导出比例</span><select value={format} disabled={exporting} onChange={(e) => setFormat(e.target.value as FormatId)}>{FORMATS.map((item) => <option key={item.id} value={item.id}>{item.ratio} · {item.name}</option>)}</select><ChevronDown size={15}/></label><label className="export-select"><span>视频语言</span><select aria-label="视频语言" value={outputLocale} disabled={exporting} onChange={e => setOutputLocale(e.target.value as OutputLocale)}>{OUTPUT_LOCALES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select><ChevronDown size={15}/></label><button className="export-button"  disabled={!audioFile || exporting || transcribing || clipEnd <= clipStart} onClick={() => void exportVideo()}>{exporting ? <><LoaderCircle size={18} className="spin"/> 正在制作 {Math.round(exportProgress)}%</> : <><Film size={18}/> 本机生成视频 <ArrowRight size={18}/></>}</button></div></section>

        {exporting && <div className="export-running"><div className="export-running-bar" style={{ width: exportProgress + '%' }}/><span>实时录制中，请保持页面开启（需要播放所选片段的实际时长）。</span></div>}
        {output && <div className="download-panel"><div><Check size={20}/><div><strong>视频已制作完成</strong><span>{output.name} · {output.mime.includes('mp4') ? 'MP4' : 'WebM'}</span></div></div><div className="download-actions"><a href={output.url} download={output.name} className="download-button"><ArrowDownToLine size={18}/> 保存视频</a>{'share' in navigator && <button className="download-button share-button" onClick={() => void shareOutput()}><ArrowRight size={18}/> 分享到 iPhone 文件/相册</button>}</div></div>}
        <div className="footer"><span><Headphones size={15}/> Audio2Video Studio</span><span>用你自己的声音，讲自己的故事。</span><span>Made for creators · 2026</span></div>
      </main>
      {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭"><X size={17}/></button></div>}
      {showHelp && <div className="modal-overlay" onClick={() => setShowHelp(false)}><div className="help-modal" onClick={(e) => e.stopPropagation()}><div className="modal-heading"><div><small>GET STARTED</small><h2>3 步，制作你的第一条视频</h2></div><button onClick={() => setShowHelp(false)}><X size={21}/></button></div><div className="help-step"><span>01</span><div><h3>选择录音</h3><p>导入你有权使用的 MP3、M4A 或 WAV 音频，不需要上传到云端。</p></div></div><div className="help-step"><span>02</span><div><h3>设置画面与字幕</h3><p>挑选主题、上传自己的背景图；使用 SRT 文件或手动粘贴文稿制作字幕。</p></div></div><div className="help-step"><span>03</span><div><h3>生成并分享</h3><p>Safari 浏览器本地合成 MP4，导出期间保持页面开启。完成后使用系统分享将视频保存到「文件」或相册。</p></div></div><div className="help-note"><Settings2 size={17}/> 所有录音与视频均在本机处理。语音识别首次需下载免费模型，iPhone 可能较慢；识别失败可导入字幕文件。</div><button className="help-done" onClick={() => setShowHelp(false)}>开始创作 <ArrowRight size={16}/></button></div></div>}
    </div>
  )
}
