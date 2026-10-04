# Digitale Stundenzettel

Ersetzt die Papier-Stundenzettel durch ein digitales „Heft“:

- **Jeder Mitarbeiter** füllt seinen eigenen Stundenzettel am Handy aus – im Layout der bekannten Vorlage
  *„Vorlage zur Dokumentation der täglichen Arbeitszeit“*. Einfach einen Tag antippen, im Fenster „von – bis“
  eintragen, fertig: Die Stunden des Tages und die Monatssumme rechnet das System automatisch.
- **Unterschriften werden nur einmal hinterlegt** und danach bei jedem Eintrag automatisch an der richtigen
  Stelle eingesetzt – mit dem richtigen Datum. Kein Nachlaufen mehr, kein „am falschen Tag unterschrieben“.
- **Der Chef** sieht alle Zettel, die **Einsatzliste** (großes Blatt mit allen Mitarbeitern) und lädt mit
  einem Klick alles als **PDF für den Steuerberater** herunter.

| Chef-Übersicht | Tag antippen → Erfassen am Handy |
|---|---|
| ![Chef-Übersicht](docs/chef-uebersicht.jpg) | ![Erfassung am Handy](docs/handy-erfassung.jpg) |

| PDF: Stundenzettel | PDF: Einsatzliste |
|---|---|
| ![Stundenzettel als PDF](docs/pdf-stundenzettel.jpg) | ![Einsatzliste als PDF](docs/pdf-einsatzliste.jpg) |

## Brauchen wir eine Datenbank?

Ja – die Zeiten, Mitarbeiter und Unterschriften müssen dauerhaft und für alle gemeinsam gespeichert
werden. Verwendet wird **SQLite** (über libSQL):

- **Online auf Vercel:** [Turso](https://turso.tech) – SQLite in der Cloud, im kostenlosen Tarif mehr als ausreichend.
- **Auf eigenem Server / lokal:** eine einzige Datei (`data/stundenzettel.db`), kein Datenbank-Server nötig.

Gesichert wird per Knopf in den Einstellungen (SQL-Datei mit allen Daten).

## Auf Vercel starten (geht komplett vom Handy)

1. [vercel.com](https://vercel.com) öffnen → **mit GitHub anmelden**.
2. **Add New… → Project** → beim Repository **Digitale-Stunden-Zettel** auf **Import** → **Deploy**.
   (Einstellungen nicht ändern – `vercel.json` regelt alles.)
3. Die fertige Seite öffnen: Sie zeigt „Noch eine Datenbank verbinden“. Dafür im Vercel-Projekt
   **Storage → Create Database → Turso** wählen, kostenlosen Tarif nehmen und mit dem Projekt **verbinden**.
4. **Deployments → oberster Eintrag → ⋯ → Redeploy**.
5. Seite neu öffnen → **„Mit Beispieldaten ausprobieren“** (Demo-Café mit 10 Mitarbeitern) oder direkt echt einrichten.
   Die Demo lässt sich später unter *Einstellungen → Demo beenden* restlos löschen.

Falls Turso im Storage-Bereich nicht angeboten wird: auf [turso.tech](https://turso.tech) (Anmeldung mit GitHub)
eine Datenbank anlegen und unter *Vercel → Settings → Environment Variables* die Werte
`TURSO_DATABASE_URL` und `TURSO_AUTH_TOKEN` eintragen, dann Redeploy.

Jede Änderung im GitHub-Repository wird von Vercel automatisch neu veröffentlicht.

## So funktioniert es

### Chef (einmalig)
1. App aufrufen → **Ersteinrichtung**: Name des Betriebs, eigener Zugang.
2. **Unterschrift des Arbeitgebers** einmal mit Finger/Maus hinterlegen.
3. Unter **Mitarbeiter** alle Mitarbeiter anlegen (Name, Benutzername, Pers.-Nr., Startpasswort).
   Optional: Logo hochladen (erscheint oben rechts auf dem Stundenzettel).

### Mitarbeiter
1. Erste Anmeldung mit dem Startpasswort → eigenes Passwort vergeben und **einmal unterschreiben**.
2. Danach: auf **„Heute erfassen“** tippen – oder auf dem Stundenzettel bzw. in der **eigenen Spalte der
   Einsatzliste** auf einen Tag tippen. Es öffnet sich ein Fenster: **von – bis**, Pause antippen, **Speichern**.
   - Die Stunden des Tages (z. B. 12–16 Uhr = 4:00) werden sofort angezeigt und eingetragen.
   - Die **Monatssumme** wird bei jedem Eintrag automatisch neu berechnet und gespeichert.
   - „aufgezeichnet am“ und die **Unterschrift** setzt das System automatisch.
   - Die letzten Schichten stehen als **Schnellauswahl** bereit – ein Tipp genügt.
3. Tipp: Im Handy-Browser „Zum Startbildschirm hinzufügen“ – dann ist die App wie ein Icon verfügbar.

### Chef im Alltag
- In der **Einsatzliste** kann der Chef bei jedem Mitarbeiter einen Tag antippen und Zeiten eintragen
  oder korrigieren (wird mit „AG“ gekennzeichnet).

### Monatsende
1. Chef öffnet **Übersicht** → sieht für jeden Mitarbeiter Tage, Stunden und Unterschriftsstatus.
2. Optional **Monat abschließen** – danach können Mitarbeiter nichts mehr ändern.
3. **ZIP (eine PDF je Mitarbeiter)** oder **Alles in einer PDF** herunterladen und an den Steuerberater schicken.

## Wo landet welche Unterschrift – mit welchem Datum?

| Stelle | Unterschrift | Datum |
|---|---|---|
| Stundenzettel, „Unterschrift des Arbeitnehmers“ | Mitarbeiter | Tag des letzten eigenen Eintrags im Monat |
| Stundenzettel, „Unterschrift des Arbeitgebers“ | Chef | Tag des letzten Eintrags im Monat |
| Einsatzliste, jede Tageszelle | Mitarbeiter (neben den Stunden) | – (die Zelle gehört zu dem Tag) |
| Einsatzliste, Zeile „Summe“ | – | Monatssumme je Mitarbeiter, automatisch |
| Einsatzliste, unten | Chef | Tag des letzten Eintrags aller Mitarbeiter im Monat |

- Die Spalte **„aufgezeichnet am“** wird bei jedem Speichern automatisch mit dem heutigen Datum gefüllt.
- Trägt oder ändert der **Chef** etwas für einen Mitarbeiter ein, wird die Zeile mit **„AG“** markiert und
  nicht mit der Mitarbeiter-Unterschrift versehen. Jede Änderung steht im **Änderungsprotokoll** des Zettels.
- Wird eine Unterschrift neu gezeichnet, behalten bereits unterschriebene Einträge ihre alte Unterschrift.
- Mitarbeiter sehen in der Einsatzliste die Stunden der Kollegen (wie auf dem Papier), statt fremder
  Unterschriften aber nur ein ✓. Chef und PDF zeigen alle Unterschriften.

## Regeln, die die App prüft

- Keine Einträge für zukünftige Tage.
- Mitarbeiter können den **laufenden und den Vormonat** bearbeiten, ältere Monate nur der Chef.
- Abgeschlossene Monate sind gesperrt (Chef kann sie wieder öffnen).
- Hinweise bei zu kurzer Pause (§ 4 ArbZG: > 6 Std. → 30 Min., > 9 Std. → 45 Min.), bei mehr als 10 Stunden
  (§ 3 ArbZG) und wenn ein Tag später als 7 Tage nachgetragen wird (§ 17 MiLoG).

## Zum Formular

Beide Formulare sind den Papiervorlagen nachgebaut – Spalten, Reihenfolge, Leerzeile unter dem Kopf,
Summe, Unterschriftszeilen und Schlüssel-Legende. Abweichungen gegenüber dem Papier:

- **Einsatzliste:** Die zweite Zeile unter „Name“ bleibt wie auf dem Papier leer. Jede Tageszelle zeigt die
  Stunden (aus von–bis berechnet) und die Unterschrift. Zusätzlich gibt es die Zeile **„Summe“**
  (Monatsstunden je Mitarbeiter, automatisch) und unten die **Unterschrift des Arbeitgebers**.
  Pro Blatt passen wie auf dem Papier 8 Mitarbeiter – bei mehr entstehen automatisch weitere Blätter.
- **Stundenzettel:** Statt des „S&A“-Logos kann in den Einstellungen ein eigenes Logo hochgeladen werden.
  Die Copyright-Zeile der Vorlage wird nicht übernommen.

Alle Maße stehen zentral in [`src/layout.js`](src/layout.js) und gelten für Bildschirm und PDF gleichermaßen.

## Installation

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm start              # http://localhost:3000
```

Zum Ausprobieren mit Beispieldaten (nur in eine leere Datenbank):

```bash
npm run demo           # Chef: chef / chef1234 – Mitarbeiter: giulia, luca, … / test1234
npm start
```

Tests: `npm test`

### Alternative: eigener kleiner Server mit Docker

Die App muss für die Mitarbeiter von unterwegs erreichbar sein und **unbedingt über HTTPS** laufen.
Mit einem kleinen Server (z. B. Hetzner, IONOS, Strato – ab ca. 4–5 € im Monat) und einer Domain:

```bash
git clone <dieses-repo> && cd Digitale-Stunden-Zettel
DOMAIN=stunden.eiscafe-beispiel.de docker compose up -d
```

Die Domain muss per DNS auf den Server zeigen; [Caddy](https://caddyserver.com) besorgt das HTTPS-Zertifikat
automatisch. Die Datenbank liegt im Docker-Volume `stundenzettel-daten`.

Alternativ läuft die App auf jedem Hoster, der Node.js oder Docker anbietet – mit Turso
(`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) oder mit dauerhaftem Speicher für die Datei (`DATA_DIR`).
Hinter einem HTTPS-Proxy `TRUST_PROXY=1` setzen.

### Einstellungen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port der App |
| `TURSO_DATABASE_URL` | – | Online-Datenbank (Turso/libSQL). Ohne Angabe wird die lokale Datei genutzt |
| `TURSO_AUTH_TOKEN` | – | Zugangsschlüssel für Turso |
| `DATA_DIR` | `data` | Ordner der lokalen Datenbank |
| `DB_FILE` | `$DATA_DIR/stundenzettel.db` | Pfad der Datenbankdatei (überschreibt `DATA_DIR`) |
| `APP_TIMEZONE` | `Europe/Berlin` | Zeitzone für „heute“ und „aufgezeichnet am“ |
| `TRUST_PROXY` | – (auf Vercel automatisch) | Hinter einem HTTPS-Proxy auf `1` setzen |
| `COOKIE_SECURE` | automatisch | `true` erzwingt sichere Cookies |

Eine `.env`-Datei (Vorlage: `.env.example`) wird mit `node --env-file=.env server.js` geladen.

## Datensicherung & Aufbewahrung

- In den **Einstellungen** (Chef) gibt es „Sicherung herunterladen“ – eine SQL-Datei mit allen Daten
  (einspielbar mit `sqlite3 neu.db < sicherung.sql` bzw. `turso db shell <name> < sicherung.sql`).
  Empfehlung: jeden Monat nach dem Export herunterladen und zusammen mit den PDFs ablegen.
- Arbeitszeitaufzeichnungen sind nach § 17 MiLoG **mindestens 2 Jahre** aufzubewahren. Ausgeschiedene
  Mitarbeiter deshalb nur **deaktivieren**, nicht löschen (Löschen ist bewusst nicht vorgesehen).

## Hinweis zur digitalen Unterschrift

Die hinterlegte Unterschrift ist eine *einfache elektronische Signatur* (Bild der Unterschrift + Protokoll,
wer wann was eingetragen hat). Der Steuerberater hat bestätigt, dass er die Nachweise in dieser Form akzeptiert.

## Technik

- Node.js + Express, serverseitig gerenderte Seiten (EJS), kein Build-Schritt
- SQLite über libSQL (`@libsql/client`): lokal als Datei, online über Turso
- PDF-Erzeugung mit PDFKit (Vektorgrafik, A4), eingebettete Schrift *Liberation* (SIL OFL, `assets/fonts/`)
- Sicherheit: Passwörter mit scrypt, Sitzungs-Cookies (HttpOnly, SameSite), CSRF-Schutz,
  Schutz gegen Passwort-Raten, Content-Security-Policy

```
server.js            Startpunkt
src/app.js           Express-App, Middleware
src/routes/          Seiten: Anmeldung, Stundenzettel, Chef-Bereich, Einstellungen
src/entries.js       Speichern/Löschen von Einträgen inkl. Regeln und Auto-Unterschrift
src/sheets.js        Daten für Stundenzettel und Einsatzliste
src/pdf.js           PDF-Erzeugung
src/layout.js        Maße beider Formulare (Bildschirm + PDF)
src/db.js, store.js  Datenbankschema und -zugriff
src/demo.js          Beispieldaten (Demo-Modus)
api/index.js         Einstiegspunkt für Vercel (vercel.json)
views/               Seitenvorlagen
public/              CSS, Browser-Skript (Unterschriftenfeld, Live-Berechnung)
scripts/demo-data.js Beispieldaten
test/                Tests (node --test), inkl. Online-Datenbank über einen Protokoll-Nachbau
```
