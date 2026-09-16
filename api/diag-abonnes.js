/* Mon poste & moi — diagnostic lecture seule : état des abonnements push vus par OneSignal (API v16)
   GET /api/diag-abonnes → pour chaque téléphone destinataire d'un envoi récent : activé ?, type de
   permission (notification_types), modèle/OS, SDK, dernière activité, identifiant externe, étiquettes. */
module.exports = async (req, res) => {
  const APP_ID = process.env.ONESIGNAL_APP_ID, KEY = process.env.ONESIGNAL_REST_API_KEY;
  if(!APP_ID || !KEY) return res.status(500).json({ erreur: "variables OneSignal manquantes" });
  const auth = KEY.startsWith("os_v2_") ? `Key ${KEY}` : `Basic ${KEY}`;
  const entetes = { Authorization: auth };
  const fr = ts => ts ? new Date((ts > 1e12 ? ts : ts * 1000)).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : null;
  try{
    const r = await fetch(`https://onesignal.com/api/v1/notifications?app_id=${APP_ID}&limit=50&kind=1`, { headers: entetes });
    if(!r.ok) return res.status(502).json({ erreur: "OneSignal " + r.status });
    const d = await r.json();
    const subs = [...new Set((d.notifications || []).flatMap(n => n.include_subscription_ids || n.include_player_ids || []))];
    const out = [];
    for(const sub of subs){
      const u = await fetch(`https://api.onesignal.com/apps/${APP_ID}/users/by/subscription_id/${sub}`, { headers: entetes });
      const j = await u.json().catch(() => ({}));
      if(!u.ok){ out.push({ sub: sub.slice(0,8), erreur: "HTTP " + u.status, detail: JSON.stringify(j).slice(0,200) }); continue; }
      const s = (j.subscriptions || []).find(x => x.id === sub) || {};
      out.push({
        sub: sub.slice(0,8), externe: j.identity && j.identity.external_id, tags: j.properties && j.properties.tags,
        actif: s.enabled, notification_types: s.notification_types, type: s.type, modele: s.device_model, os: s.device_os,
        sdk: s.sdk, version_app: s.app_version, sessions: s.session_count, derniere_activite: fr(s.last_active),
        autres_abonnements: (j.subscriptions || []).filter(x => x.id !== sub).map(x => ({ id: String(x.id).slice(0,8), type: x.type, actif: x.enabled, notification_types: x.notification_types, modele: x.device_model })),
      });
    }
    return res.status(200).json({ maintenant: fr(Date.now()), abonnes: out });
  }catch(e){ return res.status(502).json({ erreur: e.message }); }
};
