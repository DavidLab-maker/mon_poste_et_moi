/* Mon poste & moi — service worker : installation PWA + fonctionnement hors ligne.
   (Les notifications push ont leur propre worker : OneSignalSDKWorker.js) */
const CACHE = "monposteetmoi-v075";
const FICHIERS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./logo-cygne.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((cles) =>
      Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Réseau d'abord (pour récupérer les mises à jour), cache en secours (hors ligne) */
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((rep) => {
        const copie = rep.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
        return rep;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
