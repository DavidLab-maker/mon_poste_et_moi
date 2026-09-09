importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

/* Journal de réception (diagnostic, local au téléphone) : chaque push reçu par ce worker est noté
   dans le cache « mpm-recus », lisible par l'app (Mon profil → Rappels) : heure de réception,
   créneau, et si une notification est effectivement affichée 2,5 s plus tard. Permet de distinguer
   « le téléphone n'a rien reçu » (économie d'énergie, Chrome endormi) de « reçu mais pas affiché »
   (notifications du site coupées ou silencieuses). Rien n'est envoyé nulle part. */
self.addEventListener("push", (event) => {
  let slot = null, serie = null;
  try {
    const p = event.data ? event.data.json() : null;
    const a = p && p.custom && p.custom.a;
    if (a) { slot = (a.slot !== undefined) ? a.slot : null; serie = a.serie || null; }
  } catch (e) {}
  const quand = Date.now();
  event.waitUntil((async () => {
    await new Promise((r) => setTimeout(r, 2500));
    let affichees = 0;
    try { affichees = (await self.registration.getNotifications()).length; } catch (e) {}
    try {
      const c = await caches.open("mpm-recus");
      await c.put("/recus/" + quand, new Response(JSON.stringify({ t: quand, slot, serie, affichees }), { headers: { "Content-Type": "application/json" } }));
      const cles = await c.keys();
      if (cles.length > 60) {
        cles.sort((x, y) => x.url.localeCompare(y.url));
        for (const k of cles.slice(0, cles.length - 40)) await c.delete(k);
      }
    } catch (e) {}
  })());
});
