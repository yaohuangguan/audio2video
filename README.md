# Audio2Video — 免费有声视频 PWA

给家人使用的中文优先录音转视频工具。**无账号、无 API Key、无 GCP、无付费语音 API、无云端视频转码。**

- 通过 iPhone Safari 打开：https://audio2video.pages.dev
- 选择有权使用的 MP3 / M4A / WAV 录音，自动尝试本地中文语音识别。
- 首次识别通过公开 CDN 下载开源 Whisper Tiny 模型（建议 Wi-Fi），推理在用户设备本地执行。
- Whisper 本地字幕模式限 90 秒音频、建议小于 20 MB。若设备内存不足或模型下载失败，可直接导入 SRT/VTT 字幕或粘贴文稿并编辑时间轴。
- 支持简体中文、繁體中文和原文英语画面标签及字幕导出（**非语义翻译**）；可另存 UTF-8 SRT。
- 四款动态背景、声波、标题、创作者、封面图和 9:16/1:1/16:9 比例。
- 通过 Canvas + WebAudio + MediaRecorder 在浏览器本地导出包含原始音轨及烧录字幕的视频。
- Safari 支持 MP4/H.264/AAC 时导出 .mp4；其他浏览器可能仅支持 WebM，不伪装成 MP4。
- iPhone 可以通过系统分享将完成视频保存到「文件」或分享给其他应用。
- 片段导出实时进行：60 秒的音频需保持 Safari 在前台大约 60 秒。

## 技术结构

React + TypeScript + Vite 前端，公开静态网站托管在 Cloudflare Pages。除首次获取开源模型和网页静态资源外，录音内容始终停留在本机。

字幕模型位于 public/local-asr-worker.js，由 Web Worker 内下载并运行 Transformers.js v3.8.1 + ONNX Whisper Tiny (WASM)。它下载的文件可能占用浏览器缓存空间，且 iOS Safari 的 WebAssembly 内存限制因设备型号而异。**不能保证所有 iPhone 都能运行 Whisper；手动字幕导入是稳定回退方案。**

渲染位于 src/render.ts，辅助字幕处理在 src/captions.ts；src/language.ts 负责简繁体转换。没有 GCP Cloud Run、D1、Cloudflare Workers AI 或其他按量收费后端。

## 开发

要求 Node.js 20+：

    npm ci
    npm run dev
    npm run build
    npm test
    npm run test:e2e

测试分为单元测试、带模拟字幕 Worker 的自动化测试和需要真实设备验证的 MediaRecorder 导出测试。自动化测试**不会**把本机字幕 mock 当成实际 Whisper 模型成功的证据。

## 使用限制

1. 支持导出中文视频，但不会把英文语音内容自动翻译为中文：这是语音识别，不是翻译产品。
2. 浏览器端的模型下载需要网络和足够本地存储；音频内容不发送给语音服务。
3. 若 iPhone 的浏览器不支持所需 MediaRecorder 格式，请使用支持的 Safari 或改用桌面设备。
4. iOS 将分享或保存视频到 App 的具体操作交给系统分享表单；推荐先在「文件」保存，再手动上传抖音。
5. 目前不提供喜马拉雅私有音频抓取或抖音未经授权自动发布。
6. 当前草稿只保存在运行中的网页内，刷新后会丢失，请先保存输出文件。

License: All rights reserved.
