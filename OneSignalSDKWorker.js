/* Mon poste & moi — worker des rappels push.
   Le SDK OneSignal (importé ci-dessous) garde l'abonnement, la version, les sessions. Mais l'AFFICHAGE
   des rappels et l'APPUI dessus sont gérés ici, par nous, avant lui (stopImmediatePropagation) :
   - affichage immédiat, 3 tentatives, jamais de « ce site a été mis à jour en arrière-plan »
     (le SDK attendait la page quand l'app était à l'écran, puis pouvait rester bloqué en veille profonde) ;
   - un appui ramène l'app au premier plan et ouvre le rituel du rappel ;
   - journal local de réception dans le cache « mpm-recus » (lisible dans Mon profil → Rappels) ;
   - l'ouverture est signalée à OneSignal (statistique « ouverts »), au mieux. */
const MPM_WORKER = 8;
const APP_ID_DEFAUT = "71872c50-5f1b-48ea-900a-7fa346a3e5e0";
const ICONE = "/icon-192.png";
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

/* ---- réception d'un rappel : on affiche nous-mêmes, tout de suite ---- */
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
      // 3 tentatives (0 s, 1,5 s, 4 s) : en veille profonde, Android peut refuser l'affichage un court instant
      for (let essai = 0; essai < 3 && !affiche; essai++) {
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

/* ---- appui : ramener l'app au premier plan sur le rituel du rappel ---- */
async function signalerOuverture(idOS) {
  // statistique « ouverts » côté OneSignal (au mieux) : l'identifiant d'abonnement est dans la base locale du SDK
  try {
    const endpoint = (await self.registration.pushManager.getSubscription())?.endpoint;
    if (!endpoint || !idOS) return;
    const subId = await new Promise((res) => {
      const q = indexedDB.open("ONE_SIGNAL_SDK_DB");
      q.onerror = () => res(null);
      q.onsuccess = () => {
        try {
          const db = q.result, tx = db.transaction("subscriptions", "readonly"), g = tx.objectStore("subscriptions").getAll();
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
  if (!d || !d.mpm) return;                       // pas l'une des nôtres : laisser le SDK gérer
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

/* ---- version du worker, demandée par l'app ---- */
self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.mpm === "version") {
    const rep = { mpmWorker: MPM_WORKER };
    // canal direct (MessageChannel) si fourni : ne dépend pas de la file d'attente des messages de la page
    if (event.ports && event.ports[0]) { try { event.ports[0].postMessage(rep); } catch (e) {} }
    if (event.source) { try { event.source.postMessage(rep); } catch (e) {} }
  }
});

/* SDK OneSignal : abonnement, version, sessions (ses gestionnaires push/clic passent après les nôtres) */
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
