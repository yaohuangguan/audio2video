let asr
self.onmessage = async ({ data }) => {
  if (data?.type !== 'transcribe') return
  const { id, samples, language, offset, duration } = data
  try {
    if (!asr) {
      self.postMessage({ type: 'status', id, message: '第一次使用，正在下载免费中文识别模型…' })
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1')
      env.allowLocalModels = false
      env.useBrowserCache = true
      asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
        dtype: 'q8', device: 'wasm',
        progress_callback: (item) => {
          if (item.status === 'progress' && Number.isFinite(item.progress))
            self.postMessage({ type: 'status', id, message: '正在下载模型 ' + Math.round(item.progress) + '%…' })
        }
      })
    }
    self.postMessage({ type: 'status', id, message: '正在本机识别中文，期间请保持页面打开…' })
    const result = await asr(samples, {
      return_timestamps: true,
      task: 'transcribe',
      ...(language === 'auto' ? {} : { language: language === 'zh' ? 'chinese' : 'english' }),
    })
    const captions = (result.chunks || []).map((part, index) => ({
      id: id + '-' + index,
      start: offset + Math.max(0, Number(part.timestamp?.[0]) || 0),
      end: offset + Math.min(duration, Number(part.timestamp?.[1]) || duration),
      text: String(part.text || '').trim()
    })).filter(part => part.text && part.end > part.start)
    if (!captions.length && result.text?.trim())
      captions.push({ id: id + '-0', start: offset, end: offset + duration, text: result.text.trim() })
    self.postMessage({ type: 'result', id, captions })
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
}
