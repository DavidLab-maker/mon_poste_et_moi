importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

/* Filet de sécurité + journal de réception (local au téléphone). Version MPM_WORKER : l'app l'interroge
   (message { mpm:"version" }) pour afficher si ce worker est bien à jour.
   1) Chaque push reçu est noté dans le cache « mpm-recus » (heure, créneau, affichage) — lisible par
      l'app dans Mon profil → Rappels. Rien n'est envoyé nulle part.
   2) Si, 2,5 s après réception, le SDK OneSignal n'a affiché aucune notification pour ce message
      (ex. : app à l'écran et page qui ne répond pas), le worker l'affiche lui-même, avec la MÊME
      étiquette (tag = App ID) que le SDK : si celui-ci affiche ensuite, il remplace la nôtre — jamais deux. */
const MPM_WORKER = 5;
const APP_ID_DEFAUT = "71872c50-5f1b-48ea-900a-7fa346a3e5e0";
const ICONE = "/icon-192.png";
function appId() {
  try { const m = self.location.search.match(/appId=([0-9a-z-]+)/i); if (m) return m[1]; } catch (e) {}
  return APP_ID_DEFAUT;
}

self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.mpm === "version" && event.source) {
    try { event.source.postMessage({ mpmWorker: MPM_WORKER }); } catch (e) {}
  }
});

self.addEventListener("push", (event) => {
  let p = null;
  try { p = event.data ? event.data.json() : null; } catch (e) {}
  const a = (p && p.custom && p.custom.a) || {};
  const idOS = (p && p.custom && p.custom.i) || null;
  const quand = Date.now();
  event.waitUntil((async () => {
    // 700 ms : le SDK affiche en général en moins de 300 ms ; au-delà, on affiche nous-mêmes avant que le téléphone
    // en veille profonde ne gèle le worker (sinon Chrome montre « ce site a été mis à jour en arrière-plan »)
    await new Promise((r) => setTimeout(r, 700));
    let liste = [];
    try { liste = await self.registration.getNotifications(); } catch (e) {}
    const dejaAffichee = liste.some((n) => {
      try { return !!idOS && JSON.stringify(n.data || {}).includes(idOS); } catch (e) { return false; }
    });
    let secours = false;
    if (!dejaAffichee && p) {
      try {
        const titre = p.title || p.heading || "Mon poste & moi";
        const corps = p.alert || p.body || p.content || "";
        const url = (p.custom && p.custom.u) || p.url || "/";
        try {
          await self.registration.showNotification(titre, {
            body: corps, icon: p.icon || ICONE, badge: ICONE, tag: appId(), renotify: true,
            data: { url, mpm: 1, id: idOS },
          });
        } catch (e1) {
          // options minimales en dernier recours (icône inaccessible, etc.)
          await self.registration.showNotification(titre, { body: corps, tag: appId(), data: { url, mpm: 1, id: idOS } });
        }
        secours = true;
      } catch (e) {}
    }
    try {
      const c = await caches.open("mpm-recus");
      await c.put("/recus/" + quand, new Response(JSON.stringify({
        t: quand, slot: (a.slot !== undefined ? a.slot : null), serie: a.serie || null,
        affichees: (dejaAffichee || secours) ? 1 : 0, secours, worker: MPM_WORKER,
      }), { headers: { "Content-Type": "application/json" } }));
      const cles = await c.keys();
      if (cles.length > 60) {
        cles.sort((x, y) => x.url.localeCompare(y.url));
        for (const k of cles.slice(0, cles.length - 40)) await c.delete(k);
      }
    } catch (e) {}
  })());
});

/* Appui sur une notification de secours : ouvrir (ou ramener) l'app sur le lien du rappel */
self.addEventListener("notificationclick", (event) => {
  const d = event.notification && event.notification.data;
  if (!d || !d.mpm) return;                       // notifications OneSignal : gérées par le SDK
  event.notification.close();
  const url = new URL(d.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const cl = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of cl) {
      if (!c.url.startsWith(self.location.origin) || !("focus" in c)) continue;
      // d'abord ramener la fenêtre au premier plan (l'activation utilisateur du clic est encore valable), puis naviguer
      let w = c; try { w = (await c.focus()) || c; } catch (e) {}
      try { const n = await w.navigate(url); if (n && "focus" in n) { try { await n.focus(); } catch (e) {} } } catch (e) {}
      return;
    }
    return self.clients.openWindow(url);
  })());
});
