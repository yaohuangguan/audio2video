import type { Caption } from './types'
export type LocalRecognitionLanguage = 'zh' | 'en' | 'auto'
export type RecognitionJob = { promise: Promise<Caption[]>; cancel: () => void }

export async function prepareAudio(file: File, limitSeconds = 90): Promise<{ samples: Float32Array; duration: number }> {
  const context = new AudioContext()
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer())
    const duration = Math.min(audio.duration, limitSeconds)
    const targetRate = 16000
    const frames = Math.max(1, Math.floor(duration * targetRate))
    const offline = new OfflineAudioContext(1, frames, targetRate)
    const source = offline.createBufferSource()
    source.buffer = audio
    source.connect(offline.destination)
    source.start(0)
    const converted = await offline.startRendering()
    return { samples: converted.getChannelData(0).slice(), duration }
  } finally {
    await context.close()
  }
}

export function recognizeLocally(
  samples: Float32Array,
  duration: number,
  language: LocalRecognitionLanguage,
  status: (message: string) => void
): RecognitionJob {
  const worker = new Worker('/local-asr-worker.js', { type: 'module' })
  const id = Date.now().toString(36)
  let resolve!: (captions: Caption[]) => void
  let reject!: (reason: Error) => void
  let finished = false
  const promise = new Promise<Caption[]>((yes, no) => { resolve = yes; reject = no })
  function close() { finished = true; worker.terminate() }
  worker.onmessage = ({ data }) => {
    if (finished || data.id !== id) return
    if (data.type === 'status') status(String(data.message))
    if (data.type === 'result') { close(); resolve(data.captions as Caption[]) }
    if (data.type === 'error') { close(); reject(new Error(String(data.message))) }
  }
  worker.onerror = () => { if (!finished) { close(); reject(new Error('本机语音识别模型加载失败，请改用导入字幕或粘贴文稿')) } }
  worker.postMessage({ type: 'transcribe', id, samples, offset: 0, duration, language }, [samples.buffer])
  return { promise, cancel: () => { if (!finished) { close(); reject(new Error('字幕识别已取消')) } } }
}
