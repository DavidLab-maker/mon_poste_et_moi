/* Mon poste & moi — service worker dédié aux notifications push OneSignal (rappels de pauses).
   Fichier attendu par le SDK à cet emplacement ; il vit dans son propre périmètre (/push/onesignal/),
   indépendant de sw.js qui gère l'installation et le mode hors ligne. */
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
