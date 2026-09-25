/* Mon poste & moi — LE service worker unique (périmètre « / ») :
   1) installation PWA + fonctionnement hors ligne (cache réseau d'abord) ;
   2) rappels push : affichage immédiat par nous (3 tentatives), appui → rituel, journal local « mpm-recus » ;
   3) SDK OneSignal importé en fin de fichier (abonnement, version, sessions) — ses gestionnaires push/clic
      passent APRÈS les nôtres et sont neutralisés pour nos notifications (stopImmediatePropagation).
   Un seul worker pour un seul périmètre : deux scripts sur « / » se remplaçaient l'un l'autre, et quand
   l'ancien sw.js (sans gestion du push) était actif, Chrome affichait « ce site a été mis à jour en arrière-plan ». */
const CACHE = "monposteetmoi-v106";
const FICHIERS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./logo-cygne.png", "./claire-avatar.png"];
const MPM_WORKER = 9;
const APP_ID_DEFAUT = "71872c50-5f1b-48ea-900a-7fa346a3e5e0";
const ICONE = "/icon-192.png";

/* ---------- hors ligne ---------- */
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((cles) =>
      Promise.all(cles.filter((k) => k.startsWith("monposteetmoi-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
/* Réseau d'abord (mises à jour), cache en secours (hors ligne) — uniquement les fichiers de l'app, jamais les API */
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  let u; try { u = new URL(e.request.url); } catch (err) { return; }
  if (u.origin !== self.location.origin || u.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((rep) => {
        if (rep && rep.ok) { const copie = rep.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); }
        return rep;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});

/* ---------- rappels push ---------- */
function appId() {
  try { const m = self.location.search.match(/appId=([0-9a-z-]+)/i); if (m) return m[1]; } catch (e) {}
  return APP_ID_DEFAUT;
}
async function journal(entree) {
  try {
    const c = await caches.open("mpm-recus");
    await c.put("/recus/" + entree.t, new Response(JSON.stringify(entree), { headers: { "Content-Type": "application/json" } }));
    const cles = await c.keys();
    if (cles.length > 60) {
      cles.sort((x, y) => x.url.localeCompare(y.url));
      for (const k of cles.slice(0, cles.length - 40)) await c.delete(k);
    }
  } catch (e) {}
}
self.addEventListener("push", (event) => {
  event.stopImmediatePropagation();               // le SDK OneSignal ne traite pas ce push
  let p = null;
  try { p = event.data ? event.data.json() : null; } catch (e) {}
  const a = (p && p.custom && p.custom.a) || {};
  const idOS = (p && p.custom && p.custom.i) || null;
  const quand = Date.now();
  event.waitUntil((async () => {
    let affiche = false, erreur = null;
    if (p) {
      const titre = p.title || "Mon poste & moi";
      const corps = p.alert || "";
      const url = (p.custom && p.custom.u) || "/";
      const data = { url, id: idOS, mpm: 1, slot: (a.slot !== undefined ? a.slot : null) };
      const options = { body: corps, icon: p.icon || ICONE, badge: ICONE, tag: "mpm-rappel", renotify: true, data };
      for (let essai = 0; essai < 3 && !affiche; essai++) {           // 0 s, 1,5 s, 4 s
        if (essai) await new Promise((r) => setTimeout(r, essai === 1 ? 1500 : 2500));
        try {
          await self.registration.showNotification(titre, essai < 2 ? options : { body: corps, tag: "mpm-rappel", data });
          affiche = true; erreur = null;
        } catch (e) { erreur = String(e && e.message || e).slice(0, 120); }
      }
    } else erreur = "charge utile illisible";
    await journal({ t: quand, slot: (a.slot !== undefined ? a.slot : null), serie: a.serie || null, affichees: affiche ? 1 : 0, secours: false, mpm: true, erreur, worker: MPM_WORKER });
  })());
});
async function signalerOuverture(idOS) {
  try {
    const endpoint = (await self.registration.pushManager.getSubscription())?.endpoint;
    if (!endpoint || !idOS) return;
    const subId = await new Promise((res) => {
      const q = indexedDB.open("ONE_SIGNAL_SDK_DB");
      q.onerror = () => res(null);
      q.onsuccess = () => {
        try {
          const db = q.result, g = db.transaction("subscriptions", "readonly").objectStore("subscriptions").getAll();
          g.onsuccess = () => { const s = (g.result || []).find((x) => x.token === endpoint); res(s ? s.id : null); db.close(); };
          g.onerror = () => res(null);
        } catch (e) { res(null); }
      };
    });
    if (!subId) return;
    await fetch(`https://onesignal.com/api/v1/notifications/${idOS}`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId(), player_id: subId, opened: true }) });
  } catch (e) {}
}
self.addEventListener("notificationclick", (event) => {
  const d = event.notification && event.notification.data;
  if (!d || !d.mpm) return;
  event.stopImmediatePropagation();
  event.notification.close();
  const url = new URL(d.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const cl = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    let fait = false;
    for (const c of cl) {
      if (!c.url.startsWith(self.location.origin) || !("focus" in c)) continue;
      let w = c; try { w = (await c.focus()) || c; } catch (e) {}
      try { const n = await w.navigate(url); if (n && "focus" in n) { try { await n.focus(); } catch (e) {} } } catch (e) {}
      fait = true; break;
    }
    if (!fait) { try { await self.clients.openWindow(url); } catch (e) {} }
    journal({ t: Date.now(), clic: true, slot: d.slot, affichees: 1, mpm: true, worker: MPM_WORKER });
    await signalerOuverture(d.id);
  })());
});
self.addEventListener("notificationclose", (event) => {
  const d = event.notification && event.notification.data;
  if (d && d.mpm) event.stopImmediatePropagation();
});
self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.mpm === "version") {
    const rep = { mpmWorker: MPM_WORKER };
    if (event.ports && event.ports[0]) { try { event.ports[0].postMessage(rep); } catch (e) {} }
    if (event.source) { try { event.source.postMessage(rep); } catch (e) {} }
  }
});

/* ---------- SDK OneSignal (abonnement, version, sessions) ---------- */
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
