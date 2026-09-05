/* TEMPORAIRE — purge des rappels de test en attente (avant le pilote, seule Claire est abonnée).
   GET /api/purge-test?confirme=oui → annule tout rappel encore en attente. À supprimer ensuite. */
module.exports = async (req, res) => {
  if(!req.query || req.query.confirme !== "oui") return res.status(400).json({ erreur: "ajouter ?confirme=oui" });
  const APP_ID = process.env.ONESIGNAL_APP_ID, KEY = process.env.ONESIGNAL_REST_API_KEY;
  const entetes = { Authorization: KEY.startsWith("os_v2_") ? `Key ${KEY}` : `Basic ${KEY}` };
  const pages = Array.from({ length: 20 }, (_, k) => k * 50);
  const lots = await Promise.all(pages.map(off =>
    fetch(`https://onesignal.com/api/v1/notifications?app_id=${APP_ID}&limit=50&offset=${off}&kind=1`, { headers: entetes })
      .then(r => r.ok ? r.json() : { notifications: [] }).then(d => d.notifications || []).catch(() => [])));
  const cibles = lots.flat().filter(n => !n.canceled && n.remaining > 0).map(n => n.id);
  let ok = 0;
  for(let i = 0; i < cibles.length; i += 8){
    const r = await Promise.all(cibles.slice(i, i+8).map(id =>
      fetch(`https://onesignal.com/api/v1/notifications/${id}?app_id=${APP_ID}`, { method: "DELETE", headers: entetes }).then(r => r.ok).catch(() => false)));
    ok += r.filter(Boolean).length;
  }
  return res.status(200).json({ enAttente: cibles.length, annules: ok });
};
