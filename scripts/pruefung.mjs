/* Nur lesen: prüft die Adventskalender-Inhalte in Firestore (läuft von Hand über Actions › Prüfung). */
const { default: admin } = await import("firebase-admin");
const roh = process.env.FIREBASE_SA.trim(), a0 = roh.indexOf("{");
let sa; for (let i = roh.indexOf("}", a0); i >= 0; i = roh.indexOf("}", i + 1)) { try { sa = JSON.parse(roh.slice(a0, i + 1)); if (sa.private_key) break; } catch {} }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const docs = Object.fromEntries((await db.collection("advent").get()).docs.map((d) => [d.id, d.data()]));
console.log(`Türchen in der Datenbank: ${Object.keys(docs).length} von 24`);
for (let n = 1; n <= 24; n++) {
  const d = docs["t" + n], warn = [];
  if (!d) { console.log(`${n}: FEHLT`); continue; }
  const txt = JSON.stringify(d);
  if (/…|\.\.\.|Frage eintragen|Antwort [A-D]"/.test(txt)) warn.push("Platzhalter im Text");
  if (d.art === "glueck" && !(d.plaetze && d.plaetze.length)) warn.push("keine Glücksplätze");
  if (d.art === "quiz" && !(d.quiz && d.quiz.frage && d.quiz.opts && d.quiz.opts.length >= 2)) warn.push("Quiz unvollständig");
  if (d.art === "versteck" && !d.bild) warn.push("kein Bild");
  console.log(`${n}: ${d.art} · ${d.titel}${d.plaetze ? " · Plätze " + d.plaetze.join(",") : ""}${d.bild ? " · Bild" : ""}${warn.length ? "  ⚠ " + warn.join(", ") : ""}`);
}
const n = (c) => db.collection(c).count().get().then((r) => r.data().count);
console.log(`Anmeldungen: ${await n("adventName")} · Teilnehmer mit Losen: ${await n("adventT")} · Ziehung: ${(await db.doc("adventZiehung/finale").get()).exists ? "schon gezogen!" : "noch offen"}`);
console.log(`Geräte für Benachrichtigungen: ${await n("push")}`);
