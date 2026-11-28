/* Automatische Benachrichtigungen – läuft über GitHub Actions (.github/workflows/benachrichtigungen.yml).
   Liest die Abende (EVENTS) direkt aus index.html und schickt fällige Nachrichten an alle Geräte in Firestore „push“.
   Was schon verschickt wurde, steht in „pushlog“ – jede Nachricht geht nur einmal raus.

   Nachrichten:
   1. Am Tag des Clubabends um TAG_UHR (16:00): „Heute: <Motto>“
   2. Zum Start der Happy Hour (bzw. des Tankrabatts): „Happy Hour läuft!“ – nur bis 45 Min. nach Beginn
   3. Absage (Feld „absage“ beim Abend): sobald sie in index.html steht, frühestens 3 Tage vorher

   Umgebung: FIREBASE_SA = Dienstkonto-Schlüssel (JSON, als GitHub-Secret), DRY=1 = nur anzeigen, JETZT = Testzeit */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const TAG_UHR = "16:00";
const SEITE = "https://exmabarapp.github.io/ExMa-App/";
const DRY = process.env.DRY === "1";
const now = process.env.JETZT ? new Date(process.env.JETZT) : new Date();

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const a = html.indexOf("const EVENTS = ["), b = html.indexOf("\n];", a);
if (a < 0 || b < 0) throw new Error("EVENTS nicht gefunden");
const EVENTS = new Function("return " + html.slice(a + "const EVENTS = ".length, b + 2))();

const titel = (ev) => (Array.isArray(ev.titel) ? ev.titel.join(" ") : ev.titel || "Clubabend").replace(/\s+/g, " ");
const uhr = (d) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
/* Uhrzeit „HH:MM“ am Abend des Events (vor 6 Uhr = nach Mitternacht, also Folgetag) */
const um = (ev, hhmm) => {
  const t = new Date(`${ev.start.slice(0, 10)}T${hhmm}:00${ev.start.slice(19) || "+01:00"}`);
  return +hhmm.slice(0, 2) < 6 ? new Date(t.getTime() + 864e5) : t;
};
const kurz = (x) => createHash("sha1").update(x).digest("hex").slice(0, 8);

const faellig = [];
for (const ev of EVENTS) {
  const start = new Date(ev.start), ende = new Date(ev.ende), link = `${SEITE}#${ev.id}`;
  if (now > ende) continue;
  /* 1. Erinnerung am Tag */
  const tag = um(ev, TAG_UHR);
  if (now >= tag && now < start) {
    const wann = ev.markt ? `ab ${ev.markt.von} Uhr ${ev.markt.titel || "Markt"}, ab ${ev.markt.bis} Uhr Club` : `ab ${uhr(start)} Uhr in der ExMa-Bar`;
    faellig.push({ key: `${ev.id}_tag`, title: `Heute: ${titel(ev)} 🍻`, body: `${ev.untertitel ? ev.untertitel + " – " : ""}${wann}`, link });
  }
  /* 2. Happy Hour (beim Tank-Abend: Tankrabatt 22–23 Uhr) */
  const hh = ev.happyHour && ev.happyHour.von ? ev.happyHour : ev.tanke ? { von: "22:00", bis: "23:00", tanke: true } : null;
  if (hh) {
    const v = um(ev, hh.von), bis = um(ev, hh.bis);
    if (now >= v && now < Math.min(+bis, +v + 45 * 60e3)) {
      const was = hh.tanke ? "Tankrabatt: alles zum halben Preis" : (hh.angebote && hh.angebote[0] && hh.angebote[0].name) || "Jetzt zuschlagen";
      faellig.push({ key: `${ev.id}_hh`, title: "Happy Hour läuft! 🍻", body: `${was} – bis ${hh.bis} Uhr`, link });
    }
  }
  /* 3. Absage */
  if (ev.absage && ev.absage.text && start - now < 3 * 864e5) {
    faellig.push({ key: `${ev.id}_absage_${kurz(ev.absage.text)}`,
      title: ev.absage.was ? `⚠️ ${ev.absage.was} abgesagt` : `⚠️ Änderung: ${titel(ev)}`, body: ev.absage.text, link });
  }
}

console.log(`Zeit ${now.toISOString()} – fällig: ${faellig.length ? faellig.map((m) => m.key).join(", ") : "nichts"}`);
if (!faellig.length) process.exit(0);
if (DRY) { faellig.forEach((m) => console.log(`[Probe] ${m.title}\n        ${m.body}\n        ${m.link}`)); process.exit(0); }
if (!process.env.FIREBASE_SA) { console.log("Kein Schlüssel (Secret FIREBASE_SA) – nichts gesendet."); process.exit(0); }

const { default: admin } = await import("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore();
let geraete = null;

for (const m of faellig) {
  const logRef = db.doc(`pushlog/${m.key}`);
  if ((await logRef.get()).exists) { console.log(`${m.key}: schon gesendet`); continue; }
  if (!geraete) geraete = (await db.collection("push").get()).docs.map((d) => ({ id: d.id, t: d.get("t") })).filter((g) => g.t);
  await logRef.set({ at: admin.firestore.FieldValue.serverTimestamp(), title: m.title, body: m.body, geraete: geraete.length });  /* zuerst eintragen: lieber einmal zu wenig als doppelt */
  let ok = 0, weg = 0;
  for (let i = 0; i < geraete.length; i += 500) {
    const teil = geraete.slice(i, i + 500);
    const r = await admin.messaging().sendEachForMulticast({
      tokens: teil.map((g) => g.t),
      notification: { title: m.title, body: m.body },
      data: { link: m.link },
      webpush: { fcmOptions: { link: m.link }, notification: { icon: SEITE + "icon-192.png", badge: SEITE + "icon-192.png" } }
    });
    ok += r.successCount;
    await Promise.all(r.responses.map((x, j) => {
      const c = x.error && x.error.code;
      if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token" || c === "messaging/invalid-argument") { weg++; return db.doc(`push/${teil[j].id}`).delete(); }
    }));
  }
  await logRef.set({ ok, entfernt: weg }, { merge: true });
  console.log(`${m.key}: an ${ok} von ${geraete.length} Geräten gesendet, ${weg} alte Codes entfernt`);
}
