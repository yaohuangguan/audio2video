const CACHE = 'audio2video-v2'
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/icon.svg', '/manifest.webmanifest', '/local-asr-worker.js'])))
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))))
  self.clients.claim()
})
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  event.respondWith(fetch(event.request).then((res) => {
    if (res.ok && (event.request.destination === 'script' || event.request.destination === 'style' || event.request.mode === 'navigate')) {
      const copy = res.clone()
      void caches.open(CACHE).then((cache) => cache.put(event.request, copy))
    }
    return res
  }).catch(() => caches.match(event.request)))
})
