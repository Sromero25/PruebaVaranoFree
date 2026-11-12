/*
 * sw.js — caché del armazón de la app para poder abrirla sin internet.
 *
 * Estrategia:
 *  - Navegación (index.html): red primero; si falla, se sirve la copia local.
 *  - JS, CSS, fuentes e imágenes del mismo origen: caché primero (los nombres
 *    de los assets llevan hash, así que no se quedan obsoletos).
 *  - /api y otros orígenes: nunca se cachean; la sincronización debe fallar
 *    rápido para que el motor use la cola local.
 */

const CACHE = 'varano-shell-v3';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(c => c !== CACHE).map(c => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

function guardar(request, respuesta) {
  if (!respuesta || !respuesta.ok) return;
  const copia = respuesta.clone();
  caches.open(CACHE).then(cache => cache.put(request, copia)).catch(() => {});
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(respuesta => { guardar(request, respuesta); return respuesta; })
        .catch(async () => {
          const copia = (await caches.match('/index.html')) ?? (await caches.match('/'));
          return copia ?? new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(copia => {
      if (copia) return copia;
      return fetch(request).then(respuesta => { guardar(request, respuesta); return respuesta; });
    })
  );
});
