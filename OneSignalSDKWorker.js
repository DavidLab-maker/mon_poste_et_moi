/* Ancien emplacement du worker OneSignal. Le worker unique est désormais sw.js (périmètre « / »).
   Ce fichier reste identique en contenu pour les téléphones qui l'auraient encore enregistré : à leur
   prochaine ouverture, l'app remplace l'enregistrement par sw.js. */
importScripts("/sw.js");
