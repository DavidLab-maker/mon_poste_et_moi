/* Mon poste & moi — tâche quotidienne (Vercel Cron, 03:00 UTC) :
   programme auprès de OneSignal les 5 rappels du jour de chaque téléphone abonné,
   à SES horaires (étiquettes h0..h4), uniquement ses jours de travail (j0..j6),
   sauf journée off signalée (off = date du jour).
   Variables d'environnement Vercel : ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY,
   CRON_SECRET (facultatif — protège l'appel manuel).
   Appel manuel de contrôle : /api/programmer-rappels?apercu=1 → compte sans envoyer. */

const RAPPELS = [
  { t:"10:00", msg:"🎯 C'est l'heure de votre pause active du matin — 2 minutes suffisent." },
  { t:"11:15", msg:"📐 Rééquilibrage éclair : bassin, épaules, tête — 30 secondes." },
  { t:"12:30", msg:"🍽️ Pause du midi : on relâche la pression avant de repartir." },
  { t:"14:00", msg:"🚶 Début d'après-midi : on bouge un peu !" },
  { t:"16:00", msg:"🧘 Une dernière pause pour finir la journée léger." },
];
const URL_APP = "https://mon-poste-et-moi.vercel.app/";
const FUSEAU = "Europe/Paris";

/* Heure locale Paris d'un instant, et décalage Paris/UTC en minutes (gère l'heure d'été) */
function enParis(d){ return new Date(d.toLocaleString("en-US", { timeZone: FUSEAU })); }
function decalageParisMinutes(d){
  const p = enParis(d), u = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((p - u) / 60000);
}
function p2(n){ return String(n).padStart(2, "0"); }

async function listerAbonnes(appId, auth){
  const tous = []; let offset = 0;
  for(;;){
    const r = await fetch(`https://onesignal.com/api/v1/players?app_id=${appId}&limit=300&offset=${offset}`, { headers: { Authorization: auth } });
    if(!r.ok) throw new Error("OneSignal players " + r.status + " " + (await r.text()).slice(0, 200));
    const d = await r.json();
    const lot = d.players || [];
    tous.push(...lot);
    if(lot.length < 300) break;
    offset += 300;
  }
  // abonnés valides ayant déclaré leurs horaires (étiquette h0 posée par l'app)
  const valides = tous.filter(p => p.notification_types > 0 && !p.invalid_identifier && p.tags && p.tags.h0);
  valides.diag = {
    total: tous.length,
    abonnesActifs: tous.filter(p => p.notification_types > 0).length,
    sansHoraires: tous.filter(p => p.notification_types > 0 && !(p.tags && p.tags.h0)).length,
    desabonnes: tous.filter(p => !(p.notification_types > 0)).length,
    appareils: tous.slice(0,20).map(p => ({ type: p.device_type, os: p.device_os, navigateur: p.device_model, actif: p.notification_types > 0, tags: Object.keys(p.tags||{}).length })),
  };
  return valides;
}

module.exports = async (req, res) => {
  const APP_ID = process.env.ONESIGNAL_APP_ID;
  const KEY = process.env.ONESIGNAL_REST_API_KEY;
  if(!APP_ID || !KEY) return res.status(500).json({ erreur: "ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY manquants dans Vercel" });
  const apercu = req.query && req.query.apercu === "1";
  // Vercel envoie « Authorization: Bearer <CRON_SECRET> » sur les appels planifiés
  if(process.env.CRON_SECRET && !apercu && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`){
    return res.status(401).json({ erreur: "non autorisé" });
  }
  const auth = KEY.startsWith("os_v2_") ? `Key ${KEY}` : `Basic ${KEY}`;

  const maintenant = new Date();
  const paris = enParis(maintenant);
  const jourSemaine = paris.getDay();                       // 0 = dimanche … 6 = samedi
  const dateJour = `${paris.getFullYear()}-${p2(paris.getMonth()+1)}-${p2(paris.getDate())}`;
  const dec = decalageParisMinutes(maintenant);
  const gmt = `GMT${dec >= 0 ? "+" : "-"}${p2(Math.floor(Math.abs(dec)/60))}${p2(Math.abs(dec)%60)}`;

  let abonnes;
  try{ abonnes = await listerAbonnes(APP_ID, auth); }
  catch(e){ return res.status(502).json({ erreur: e.message }); }

  // qui travaille aujourd'hui ? (jour de travail déclaré, pas de journée off)
  const actifs = abonnes.filter(p => p.tags["j"+jourSemaine] === "1" && p.tags.off !== dateJour);

  // regroupement : même créneau + même horaire → une seule notification pour tous
  const groupes = {};
  actifs.forEach(p => {
    RAPPELS.forEach((r, i) => {
      const h = p.tags["h"+i] || r.t;
      if(!/^\d{2}:\d{2}$/.test(h)) return;
      const cle = i + "@" + h;
      (groupes[cle] = groupes[cle] || { i, h, ids: [] }).ids.push(p.id);
    });
  });

  // envoi (ou aperçu) — on ignore les horaires déjà passés de plus de 2 minutes
  const minutesParis = paris.getHours()*60 + paris.getMinutes();
  const resultats = [];
  for(const g of Object.values(groupes)){
    const [hh, mm] = g.h.split(":").map(Number);
    if(hh*60 + mm < minutesParis - 2){ resultats.push({ creneau: g.i, heure: g.h, ignores: g.ids.length, motif: "déjà passé" }); continue; }
    const corps = {
      app_id: APP_ID,
      include_subscription_ids: g.ids,
      headings: { en: "Mon poste & moi", fr: "Mon poste & moi" },
      contents: { en: RAPPELS[g.i].msg, fr: RAPPELS[g.i].msg },
      url: URL_APP,
      chrome_web_icon: URL_APP + "icon-192.png",
      firefox_icon: URL_APP + "icon-192.png",
      send_after: `${dateJour} ${p2(hh)}:${p2(mm)}:00 ${gmt}`,
      ttl: 3600,
    };
    if(apercu){ resultats.push({ creneau: g.i, heure: g.h, destinataires: g.ids.length, send_after: corps.send_after }); continue; }
    try{
      const r = await fetch("https://onesignal.com/api/v1/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: auth },
        body: JSON.stringify(corps),
      });
      const d = await r.json().catch(()=>({}));
      resultats.push({ creneau: g.i, heure: g.h, destinataires: g.ids.length, ok: r.ok, id: d.id, erreurs: d.errors });
    }catch(e){
      resultats.push({ creneau: g.i, heure: g.h, destinataires: g.ids.length, ok: false, erreur: e.message });
    }
  }

  return res.status(200).json({
    date: dateJour, jourSemaine, heureParis: `${p2(paris.getHours())}:${p2(paris.getMinutes())}`, fuseau: gmt,
    abonnes: abonnes.length, actifsAujourdhui: actifs.length, apercu, envois: resultats,
    diagnostic: abonnes.diag,
  });
};
