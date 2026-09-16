/* Mon poste & moi — diagnostic lecture seule : état des abonnements push vus par OneSignal.
   GET /api/diag-abonnes → pour chaque téléphone destinataire d'un envoi récent : fiche utilisateur (API v16),
   fiche « legacy » (jeton FCM valide ?, dernière activité, modèle), identité (external id). */
module.exports = async (req, res) => {
  const APP_ID = process.env.ONESIGNAL_APP_ID, KEY = process.env.ONESIGNAL_REST_API_KEY;
  if(!APP_ID || !KEY) return res.status(500).json({ erreur: "variables OneSignal manquantes" });
  const auth = KEY.startsWith("os_v2_") ? `Key ${KEY}` : `Basic ${KEY}`;
  const entetes = { Authorization: auth };
  const jetonCourt = t => { if(!t) return null; const s = String(t).split("/").pop(); return s.slice(0,6) + "…" + s.slice(-4); };
  const fr = ts => { if(!ts) return null; const n = typeof ts === "string" ? Date.parse(ts) : (ts > 1e12 ? ts : ts * 1000); return isNaN(n) ? ts : new Date(n).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }); };
  try{
    const r = await fetch(`https://onesignal.com/api/v1/notifications?app_id=${APP_ID}&limit=50&kind=1`, { headers: entetes });
    if(!r.ok) return res.status(502).json({ erreur: "OneSignal " + r.status });
    const d = await r.json();
    const subs = [...new Set((d.notifications || []).flatMap(n => n.include_subscription_ids || n.include_player_ids || []))];
    const out = [];
    for(const sub of subs){
      const fiche = { sub: sub.slice(0,8) };
      const u = await fetch(`https://api.onesignal.com/apps/${APP_ID}/users/by/subscription_id/${sub}`, { headers: entetes });
      const j = await u.json().catch(() => ({}));
      if(u.ok){
        const s = (j.subscriptions || []).find(x => x.id === sub) || {};
        fiche.utilisateur = { externe: j.identity && j.identity.external_id, tags: j.properties && j.properties.tags, actif: s.enabled, notification_types: s.notification_types,
          modele: s.device_model, os: s.device_os, sdk: s.sdk, sessions: s.session_count, derniere_activite: fr(s.last_active),
          autres_abonnements: (j.subscriptions || []).filter(x => x.id !== sub).map(x => ({ id: String(x.id).slice(0,8), type: x.type, actif: x.enabled, notification_types: x.notification_types })) };
      } else fiche.utilisateur = "HTTP " + u.status + " " + JSON.stringify(j).slice(0,160);
      const lp = await fetch(`https://onesignal.com/api/v1/players/${sub}?app_id=${APP_ID}`, { headers: entetes });
      const p = await lp.json().catch(() => ({}));
      fiche.legacy = lp.ok ? { jeton: jetonCourt(p.identifier), jeton_invalide: p.invalid_identifier, notification_types: p.notification_types,
        derniere_activite: fr(p.last_active), cree: fr(p.created_at), sessions: p.session_count, modele: p.device_model, os: p.device_os, sdk: p.sdk,
        externe: p.external_user_id, tags: p.tags, test_type: p.test_type } : { erreur: "players HTTP " + lp.status };
      const idn = await fetch(`https://api.onesignal.com/apps/${APP_ID}/subscriptions/${sub}/user/identity`, { headers: entetes });
      fiche.identite = { code: idn.status, ...(await idn.json().catch(() => ({}))) };
      out.push(fiche);
    }
    return res.status(200).json({ maintenant: fr(Date.now()), abonnes: out });
  }catch(e){ return res.status(502).json({ erreur: e.message }); }
};
