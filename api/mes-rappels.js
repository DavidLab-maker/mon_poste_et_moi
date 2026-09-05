/* Mon poste & moi — programmation des rappels push d'UN téléphone (appelé par l'app elle-même).
   POST JSON : { sub, horaires[5], jours[], off[], annuler[], depuis, nbJours, confirmer }
   - sub       : identifiant d'abonnement OneSignal du téléphone
   - horaires  : les 5 heures « HH:MM » (heure de Paris), jours : jours travaillés (0=dim … 6=sam)
   - off       : dates « YYYY-MM-DD » sans rappel (journée off signalée)
   - annuler   : identifiants de notifications programmées à supprimer (changement d'horaires)
   - depuis / nbJours : fenêtre à programmer ; confirmer : envoie une notification immédiate
   Chaque rappel porte une clé d'idempotence (téléphone + date + créneau + heure) : redemander
   la même fenêtre ne crée jamais de doublon. Variables Vercel : ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY. */

const crypto = require("crypto");

const RAPPELS = [
  { t:"10:00", msg:"🎯 C'est l'heure de votre pause active du matin — 2 minutes suffisent." },
  { t:"11:15", msg:"📐 Rééquilibrage éclair : bassin, épaules, tête — 30 secondes." },
  { t:"12:30", msg:"🍽️ Pause du midi : on relâche la pression avant de repartir." },
  { t:"14:00", msg:"🚶 Début d'après-midi : on bouge un peu !" },
  { t:"16:00", msg:"🧘 Une dernière pause pour finir la journée léger." },
];
const URL_APP = "https://mon-poste-et-moi.vercel.app/";
const FUSEAU = "Europe/Paris";
const p2 = n => String(n).padStart(2, "0");

/* décalage Paris/UTC (minutes) à un instant donné — gère l'heure d'été */
function decalageParis(d){
  const p = new Date(d.toLocaleString("en-US", { timeZone: FUSEAU }));
  const u = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((p - u) / 60000);
}
function dateParis(d){
  const p = new Date(d.toLocaleString("en-US", { timeZone: FUSEAU }));
  return `${p.getFullYear()}-${p2(p.getMonth()+1)}-${p2(p.getDate())}`;
}
function ajouterJours(ymd, k){
  const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0,10);
}
/* instant UTC (ms) correspondant à « ymd HH:MM » heure de Paris */
function instantParis(ymd, hh, mm){
  const [y,m,d] = ymd.split("-").map(Number);
  const approx = new Date(Date.UTC(y, m-1, d, hh, mm));
  return Date.UTC(y, m-1, d, hh, mm) - decalageParis(approx) * 60000;
}
function uuidDepuis(s){
  const h = crypto.createHash("sha256").update(s).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
async function parLots(items, fn, taille){
  const out = [];
  for(let i = 0; i < items.length; i += taille) out.push(...await Promise.all(items.slice(i, i+taille).map(fn)));
  return out;
}
function lireCorps(req){
  if(req.body && typeof req.body === "object") return req.body;
  try{ return JSON.parse(req.body || "{}"); }catch(e){ return {}; }
}

module.exports = async (req, res) => {
  if(req.method !== "POST") return res.status(405).json({ erreur: "POST attendu" });
  const APP_ID = process.env.ONESIGNAL_APP_ID, KEY = process.env.ONESIGNAL_REST_API_KEY;
  if(!APP_ID || !KEY) return res.status(500).json({ erreur: "ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY manquants dans Vercel" });
  const auth = KEY.startsWith("os_v2_") ? `Key ${KEY}` : `Basic ${KEY}`;
  const entetes = { "Content-Type": "application/json; charset=utf-8", Authorization: auth };

  const b = lireCorps(req);
  const sub = String(b.sub || "").trim();
  if(!/^[0-9a-f-]{20,}$/i.test(sub)) return res.status(400).json({ erreur: "identifiant d'abonnement invalide" });
  const horaires = RAPPELS.map((r,i) => (Array.isArray(b.horaires) && /^\d{2}:\d{2}$/.test(b.horaires[i]||"")) ? b.horaires[i] : r.t);
  const jours = (Array.isArray(b.jours) ? b.jours.filter(n => Number.isInteger(n) && n>=0 && n<=6) : null) || [1,2,3,4,5];
  const off = Array.isArray(b.off) ? b.off.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  const annuler = Array.isArray(b.annuler) ? b.annuler.filter(x => typeof x === "string" && /^[0-9a-f-]{20,}$/i.test(x)).slice(0, 400) : [];
  const nbJours = Math.min(21, Math.max(1, parseInt(b.nbJours, 10) || 14));
  // « série » : identifiant de la programmation en cours (renouvelé à chaque changement d'horaires
  // ou réactivation) — sans lui, un rappel annulé puis recréé à l'identique serait ignoré par OneSignal
  const serie = String(b.serie || "").replace(/[^0-9a-z]/gi, "").slice(0, 32) || "s0";
  const maintenant = new Date();
  const aujourdhui = dateParis(maintenant);
  const depuis = (/^\d{4}-\d{2}-\d{2}$/.test(b.depuis || "") && b.depuis >= aujourdhui) ? b.depuis : aujourdhui;

  // 1) annulations (anciens horaires, ou désactivation) — les erreurs sont ignorées (déjà envoyée, déjà supprimée…)
  const annules = await parLots(annuler, id =>
    fetch(`https://onesignal.com/api/v1/notifications/${id}?app_id=${APP_ID}`, { method: "DELETE", headers: entetes })
      .then(r => r.ok).catch(() => false), 8);
  if(b.desactiver) return res.status(200).json({ desactive: true, annules: annules.filter(Boolean).length });

  // 2) programmation de la fenêtre demandée
  const taches = [];
  for(let k = 0; k < nbJours; k++){
    const ymd = ajouterJours(depuis, k);
    const js = new Date(ymd + "T12:00:00Z").getUTCDay();
    if(!jours.includes(js) || off.includes(ymd)) continue;
    horaires.forEach((h, i) => {
      const [hh, mm] = h.split(":").map(Number);
      const quand = instantParis(ymd, hh, mm);
      if(quand < Date.now() + 60000) return;                      // déjà passé
      taches.push({ ymd, i, h, quand });
    });
  }
  const programmes = await parLots(taches, async t => {
    const corps = {
      app_id: APP_ID,
      include_subscription_ids: [sub],
      headings: { en: "Mon poste & moi", fr: "Mon poste & moi" },
      contents: { en: RAPPELS[t.i].msg, fr: RAPPELS[t.i].msg },
      url: URL_APP + "?rappel=" + t.i,                       // un appui ouvre directement la pause du créneau
      chrome_web_icon: URL_APP + "icon-192.png",
      firefox_icon: URL_APP + "icon-192.png",
      send_after: new Date(t.quand).toISOString().replace("T", " ").slice(0, 19) + " GMT+0000",
      ttl: 7200,                                                  // téléphone hors réseau : livré jusqu'à 2 h plus tard
      idempotency_key: uuidDepuis(`${sub}|${serie}|${t.ymd}|${t.i}|${t.h}`),
    };
    try{
      const r = await fetch("https://onesignal.com/api/v1/notifications", { method: "POST", headers: entetes, body: JSON.stringify(corps) });
      const d = await r.json().catch(() => ({}));
      return { date: t.ymd, slot: t.i, heure: t.h, id: d.id || null, ok: r.ok && !!d.id, erreurs: d.errors };
    }catch(e){ return { date: t.ymd, slot: t.i, heure: t.h, id: null, ok: false, erreurs: [e.message] }; }
  }, 8);

  // 3) confirmation immédiate (première activation) : la preuve que ça marche, dans la main
  let confirmation = null;
  if(b.confirmer){
    try{
      const r = await fetch("https://onesignal.com/api/v1/notifications", { method: "POST", headers: entetes, body: JSON.stringify({
        app_id: APP_ID, include_subscription_ids: [sub],
        headings: { en: "Mon poste & moi", fr: "Mon poste & moi" },
        contents: { en: "✅ Rappels activés ! Vous recevrez vos 5 pauses à vos horaires, même app fermée. Petites pauses, grands effets.",
                    fr: "✅ Rappels activés ! Vous recevrez vos 5 pauses à vos horaires, même app fermée. Petites pauses, grands effets." },
        url: URL_APP, chrome_web_icon: URL_APP + "icon-192.png", firefox_icon: URL_APP + "icon-192.png",
      })});
      const d = await r.json().catch(() => ({}));
      confirmation = { ok: r.ok && !!d.id, id: d.id || null, erreurs: d.errors };
    }catch(e){ confirmation = { ok: false, erreurs: [e.message] }; }
  }

  const jusqu = ajouterJours(depuis, nbJours - 1);
  return res.status(200).json({
    aujourdhui, depuis, jusqu, annules: annules.filter(Boolean).length,
    programmes, nbProgrammes: programmes.filter(p => p.ok).length, confirmation,
  });
};
