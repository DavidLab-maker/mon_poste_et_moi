importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

/* Filet de sécurité + journal de réception (local au téléphone).
   1) Chaque push reçu est noté dans le cache « mpm-recus » (heure, créneau, affichage) — lisible par
      l'app dans Mon profil → Rappels. Rien n'est envoyé nulle part.
   2) Si, 2,5 s après réception, le SDK OneSignal n'a affiché aucune notification pour ce message,
      le worker l'affiche lui-même (titre, texte, icône, lien du rappel). Un appui ouvre l'app. */
const ICONE = "/icon-192.png";

self.addEventListener("push", (event) => {
  let p = null;
  try { p = event.data ? event.data.json() : null; } catch (e) {}
  const a = (p && p.custom && p.custom.a) || {};
  const idOS = (p && p.custom && p.custom.i) || null;
  const quand = Date.now();
  event.waitUntil((async () => {
    await new Promise((r) => setTimeout(r, 2500));
    let liste = [];
    try { liste = await self.registration.getNotifications(); } catch (e) {}
    const dejaAffichee = liste.some((n) => {
      try { const s = JSON.stringify(n.data || {}); return (idOS && s.includes(idOS)) || (n.tag && idOS && n.tag === "mpm-" + idOS); } catch (e) { return false; }
    });
    let secours = false;
    if (!dejaAffichee && p) {
      try {
        const titre = p.title || p.heading || "Mon poste & moi";
        const corps = p.alert || p.body || p.content || "";
        const url = (p.custom && p.custom.u) || p.url || "/";
        await self.registration.showNotification(titre, {
          body: corps, icon: p.icon || ICONE, badge: ICONE, tag: "mpm-" + (idOS || quand),
          data: { url, mpm: 1, id: idOS }, renotify: false,
        });
        secours = true;
      } catch (e) {}
    }
    try {
      const c = await caches.open("mpm-recus");
      await c.put("/recus/" + quand, new Response(JSON.stringify({
        t: quand, slot: (a.slot !== undefined ? a.slot : null), serie: a.serie || null,
        affichees: dejaAffichee ? 1 : (secours ? 1 : 0), secours,
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
    for (const c of cl) { if (c.url.startsWith(self.location.origin) && "focus" in c) { try { await c.navigate(url); } catch (e) {} return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
