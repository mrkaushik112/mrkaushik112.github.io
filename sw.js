/* Mount AI service worker — makes the built app fully usable offline.
 *
 * Strategies:
 *  - App shell (HTML, manifest, icons): precached on install, network-first afterwards.
 *  - Hashed build assets (JS/CSS/images/fonts): cache-first, because their names change on every build.
 *  - Everything else same-origin: stale-while-revalidate.
 *  - Cross-origin requests (optional live AI providers) are never intercepted.
 *
 * Bump VERSION whenever the caching behaviour changes; old caches are removed on activate.
 */

const VERSION = 'mountai-v1'
const STATIC_CACHE = `${VERSION}-static`
const RUNTIME_CACHE = `${VERSION}-runtime`

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      await Promise.allSettled(
        APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  if (
    url.pathname.startsWith('/assets/') ||
    /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|json|webmanifest|wasm)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request))
    return
  }

  event.respondWith(staleWhileRevalidate(request))
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response && response.ok) {
    const cache = await caches.open(STATIC_CACHE)
    cache.put(request, response.clone())
  }
  return response
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached

    const shell = (await caches.match('/index.html')) || (await caches.match('/'))
    if (shell) return shell

    return new Response(
      'Mount AI is offline and this page has not been cached yet. Open the app once while it is running to enable offline mode.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(
      () =>
        new Response('Offline and not cached', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
    )

  return cached || network
}
