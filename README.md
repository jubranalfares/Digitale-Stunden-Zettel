# Digitale Stundenzettel

Das Papier-Heft mit den Stundenzetteln – digital. Man schreibt **direkt ins Formular**, wie auf Papier,
nur ohne Rechnen und ohne ständiges Unterschreiben:

- **Mitarbeiter** tippen ihre Zeiten in ihren Stundenzettel (*„Vorlage zur Dokumentation der täglichen
  Arbeitszeit“*) – z. B. `12` und `16`. Dauer, Monatssumme, „aufgezeichnet am“ und die **Unterschrift**
  setzt das System automatisch. Gespeichert wird von selbst.
- In der **Einsatzliste** (großes Blatt mit allen Mitarbeitern) schreibt man wie auf Papier `12-16` in die
  Zelle – daraus werden 4:00 Std., die Zeile **Summe** rechnet mit.
- **Der Chef** blättert durch das Heft (Einsatzliste, dann jeder Mitarbeiter), unterschreibt nur einmal
  und lädt mit **einem Knopf** alles als PDF für den Steuerberater herunter.

| Chef: das Heft mit Registern | Mitarbeiter: direkt ins Formular tippen |
|---|---|
| ![Chef-Ansicht](docs/chef-uebersicht.jpg) | ![Erfassung am Handy](docs/handy-erfassung.jpg) |

| PDF: Stundenzettel | PDF: Einsatzliste |
|---|---|
| ![Stundenzettel als PDF](docs/pdf-stundenzettel.jpg) | ![Einsatzliste als PDF](docs/pdf-einsatzliste.jpg) |

## So schreibt man ins Heft

| Wo | Eingabe | Ergebnis |
|---|---|---|
| Stundenzettel, Beginn/Ende | `12`, `930`, `12:30` | 12:00, 09:30, 12:30 |
| Stundenzettel, Pause | `30`, `45`, `1`, `130` | 0:30, 0:45, 1:00, 1:30 |
| Stundenzettel, Spalte * | K, U, UU, F, SA, SU | Kürzel laut Schlüssel |
| Einsatzliste, Tageszelle | `12-16`, `12:30-18`, `U`, `K` | 4:00 Std. bzw. Kürzel |
| überall | Feld leeren | Tag wird gelöscht |

Gespeichert wird, sobald man die Zeile bzw. Zelle verlässt (oder Enter drückt). Unten erscheint kurz
„✓ Gespeichert · Monatssumme …“.

Mitarbeiter schreiben in ihren eigenen Zettel und ihre eigene Spalte der Einsatzliste (laufender und
Vormonat). Der Chef kann überall eintragen; seine Einträge werden mit **„AG“** gekennzeichnet.

## Unterschriften – einmal hinterlegen, nie wieder unterschreiben

| Stelle | Unterschrift | Datum |
|---|---|---|
| Stundenzettel, „Unterschrift des Arbeitnehmers“ | Mitarbeiter | Tag des letzten eigenen Eintrags im Monat |
| Stundenzettel, „Unterschrift des Arbeitgebers“ | Chef | Tag des letzten Eintrags im Monat |
| Einsatzliste, jede Tageszelle | Mitarbeiter (neben den Stunden) | – |
| Einsatzliste, unten | Chef | Tag des letzten Eintrags aller Mitarbeiter |

Mitarbeiter sehen in der Einsatzliste die Stunden der Kollegen (wie auf dem Papier), statt fremder
Unterschriften aber nur ein ✓. Der Chef und das PDF zeigen alle Unterschriften.
Die Unterschrift ist eine einfache elektronische Signatur; der Steuerberater akzeptiert sie.

## Einrichtung (einmalig)

1. App öffnen → **Ersteinrichtung**: Name des Betriebs und Chef-Zugang.
2. Unter **Einstellungen** einmal als Chef unterschreiben.
3. Unter **Mitarbeiter** jeden mit Name, Benutzername und Startpasswort anlegen.
4. Mitarbeiter melden sich an, vergeben ein eigenes Passwort und unterschreiben einmal – fertig.
   Tipp: im Handy-Browser „Zum Startbildschirm hinzufügen“, dann ist das Heft wie eine App da.

## Online stellen mit Vercel (geht komplett vom Handy)

1. [vercel.com](https://vercel.com) öffnen → **mit GitHub anmelden**.
2. **Add New… → Project** → beim Repository **Digitale-Stunden-Zettel** auf **Import** → **Deploy**.
3. Die Seite zeigt „Noch eine Datenbank verbinden“: im Vercel-Projekt **Storage → Create Database → Turso**
   wählen (kostenloser Tarif) und mit dem Projekt **verbinden**.
4. **Deployments → oberster Eintrag → ⋯ → Redeploy** – danach Seite öffnen und einrichten.

Falls Turso unter Storage nicht angeboten wird: auf [turso.tech](https://turso.tech) (Anmeldung mit GitHub)
eine Datenbank anlegen und unter *Vercel → Settings → Environment Variables* `TURSO_DATABASE_URL` und
`TURSO_AUTH_TOKEN` eintragen, dann Redeploy. Jede Änderung im Repository geht automatisch online.

### Brauchen wir eine Datenbank?

Ja – damit alle Zettel dauerhaft und für alle gemeinsam gespeichert sind. Verwendet wird SQLite (über libSQL):
online über [Turso](https://turso.tech), auf einem eigenen Server oder lokal als einzelne Datei
(`data/stundenzettel.db`).

### Alternative: eigener Server mit Docker

```bash
DOMAIN=stunden.eiscafe-beispiel.de docker compose up -d
```

Die Domain muss auf den Server zeigen; [Caddy](https://caddyserver.com) richtet HTTPS automatisch ein.

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm start            # http://localhost:3000
npm test             # Tests
npm run demo         # nur für Entwicklung: Beispiel-Café in eine leere Datenbank (chef/chef1234, giulia/test1234)
```

| Variable | Standard | Bedeutung |
|---|---|---|
| `TURSO_DATABASE_URL` | – | Online-Datenbank (Turso/libSQL). Ohne Angabe wird die lokale Datei genutzt |
| `TURSO_AUTH_TOKEN` | – | Zugangsschlüssel für Turso |
| `DATA_DIR` | `data` | Ordner der lokalen Datenbank |
| `PORT` | `3000` | Port |
| `APP_TIMEZONE` | `Europe/Berlin` | Zeitzone für „heute“ und „aufgezeichnet am“ |
| `TRUST_PROXY` | auf Vercel automatisch | Hinter einem HTTPS-Proxy auf `1` setzen |

## Datensicherung

Unter **Einstellungen** (Chef) → „Sicherung herunterladen“: eine SQL-Datei mit allen Daten. Am besten
jeden Monat zusammen mit dem PDF ablegen. Arbeitszeitnachweise mindestens **2 Jahre** aufbewahren
(§ 17 MiLoG) – ausgeschiedene Mitarbeiter deshalb nur deaktivieren, nicht löschen.

## Technik

Node.js + Express, Seiten mit EJS, SQLite über libSQL, PDFs mit PDFKit (eingebettete Schrift *Liberation*,
SIL OFL). Beide Formulare haben ihre Maße zentral in [`src/layout.js`](src/layout.js) – Bildschirm und PDF
sehen dadurch gleich aus.

```
server.js, api/index.js   Start (lokal / Vercel)
src/routes/heft.js        Das Heft: Formulare anzeigen, Einträge speichern, PDF
src/routes/…              Anmeldung, Einstellungen, Mitarbeiter
src/entries.js            Regeln beim Speichern (Rechte, automatische Unterschrift)
src/sheets.js, pdf.js     Formulardaten und PDF-Erzeugung
src/db.js, store.js       Datenbank
views/, public/           Seiten, Stil, Browser-Skript (Eingabe direkt im Formular, Unterschriftenfeld)
test/                     Tests, inkl. Online-Datenbank über einen Protokoll-Nachbau
```
