# Audio2Video

Mobile-first PWA for transforming a recording into a short-form video.

## Included in v0.1

- Local audio import (MP3, M4A, WAV; codec support depends on browser).
- Four dynamic visual templates, custom background image, waveform, title, creator, accent.
- Live Canvas preview shared with actual export renderer.
- SRT/VTT import, caption editing and SRT download. Pasted transcript is split by estimated word count and **is not speech recognition**.
- Start/end clip trimming and browser-side audio+video recording.
- Safari prefers MP4 MediaRecorder when supported; Chrome frequently produces WebM. Browser MIME support determines the real extension, not an artificial rename.
- Responsive interface, installable PWA, offline caching for the app shell.

## Run

Node.js 20+ required.

    npm ci
    npm run dev
    npm run build
    npm test
    npm run test:e2e

The browser smoke test uses an existing Google Chrome app on macOS, and covers desktop/mobile layout, audio import and transcript editing. For full MediaRecorder testing, set E2E_MEDIA=1 on a machine where audio playback clock progresses correctly (macOS headless Chrome may not). iPhone export must still be verified on a real device before public release.

## AI captions

The UI has an optional AI transcription endpoint VITE_TRANSCRIBE_URL. It expects multipart file upload and returns a JSON object containing an array of { id, start, end, text } captions. There is no transcription backend or API key deployed in this prototype. NEVER put secret provider keys in a VITE_ variable; they are exposed to the browser. A backend requires authentication, quotas, abuse prevention and clear data handling.

Local audio is not uploaded unless user explicitly requests AI transcription on a configured endpoint.

## Limitations

1. Video export records in real time; a 60-second selection takes about 60 seconds. Keep the screen on and the tab visible.
2. Cross-browser MP4 is not guaranteed; for universal MP4, plan an authenticated asynchronous FFmpeg rendering service.
3. Only short audio files are fully decoded for waveform sampling to avoid mobile memory exhaustion.
4. No direct Ximalaya downloads or unapproved Douyin posting. Import audio you own and upload exported video manually.
5. No login, analytics or saved drafts. Refreshing the page loses the draft.

## Files

- src/App.tsx: studio and export
- src/render.ts: Canvas frame renderer
- src/captions.ts: SRT/VTT parsing and segment generation
- src/captions.test.ts: unit tests
- tests/e2e.mjs: browser smoke test
- public/manifest.webmanifest: PWA manifest
- public/sw.js: offline shell service worker

License: all rights reserved until explicitly chosen.


## V2: private cloud processing

The frontend supports Cloudflare Workers AI Whisper Large v3 Turbo caption timestamps and Cloud Run / FFmpeg for H.264/AAC MP4. Both cloud features require a private owner access code. Local playback/edit/export remains available.

### Usage and security

- Private Worker gateway: secret access key, 4 requests per minute, D1 atomic daily total limit of 12 combined transcriptions or renders.
- File max 6MB, transcription client max 3 minutes, cloud MP4 max 60-second clip.
- Uploaded audio is only sent to the server when the user explicitly clicks a cloud operation. There is no R2 audio archive.
- Cloud Run uses an independent secret and deletes job files from its temporary folder.
- This is a single-owner prototype, NOT a public SaaS: keep quotas and secrets until per-user accounting/billing is in place.
- The cloud renderer produces a similar but simplified design to the browser preview. Custom uploaded background images currently affect browser previews and native browser recordings, but not cloud MP4.

### Deployment

Cloudflare API source is in api/, D1 schema is api/schema.sql, Cloud Run source is render-service/. Worker runtime secrets ACCESS_KEY, RENDER_SECRET and RENDER_URL must never be committed. The frontend uses public VITE_API_BASE at build time. The render container expects an independent RENDER_SECRET environment variable.

Cloud Run has potential pay-per-use charges. Deploy with min-instances=0, max-instances=1 and low concurrency. Manual iPhone MP4 export must be checked on actual hardware.
