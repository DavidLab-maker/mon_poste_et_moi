/* Mon poste & moi — diagnostic : les derniers rappels vus par OneSignal (programmés, livrés, échoués).
   GET /api/diag-notifs?n=60  → liste résumée, du plus récent au plus ancien. Lecture seule. */
module.exports = async (req, res) => {
  const APP_ID = process.env.ONESIGNAL_APP_ID, KEY = process.env.ONESIGNAL_REST_API_KEY;
  if(!APP_ID || !KEY) return res.status(500).json({ erreur: "variables OneSignal manquantes" });
  const auth = KEY.startsWith("os_v2_") ? `Key ${KEY}` : `Basic ${KEY}`;
  const n = Math.min(50, Math.max(1, parseInt(req.query && req.query.n, 10) || 50));   // OneSignal : 50 max par page
  const offset = Math.max(0, parseInt(req.query && req.query.offset, 10) || 0);
  try{
    const r = await fetch(`https://onesignal.com/api/v1/notifications?app_id=${APP_ID}&limit=${n}&offset=${offset}&kind=1`, { headers: { Authorization: auth } });
    if(!r.ok) return res.status(502).json({ erreur: "OneSignal " + r.status, detail: (await r.text()).slice(0, 300) });
    const d = await r.json();
    const fr = ts => ts ? new Date(ts * 1000).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : null;
    const liste = (d.notifications || []).map(x => ({
      id: String(x.id).slice(0, 8),
      texte: (x.contents && (x.contents.fr || x.contents.en) || "").slice(0, 48),
      creee: fr(x.queued_at),
      prevue: fr(x.send_after),
      terminee: fr(x.completed_at),
      annulee: !!x.canceled,
      tel: String((x.include_subscription_ids || x.include_player_ids || [])[0] || "").slice(0, 8),
      serie: x.data && x.data.serie || null,
      livres: x.successful, echecs: x.failed, erreurs: x.errored, enAttente: x.remaining, ouverts: x.converted,
    }));
    return res.status(200).json({ total: d.total_count, affiches: liste.length, maintenant: fr(Date.now()/1000), notifications: liste });
  }catch(e){ return res.status(502).json({ erreur: e.message }); }
};
