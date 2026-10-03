# Digitale Stundenzettel

Ersetzt die Papier-Stundenzettel durch ein digitales „Heft“:

- **Jeder Mitarbeiter** füllt seinen eigenen Stundenzettel am Handy aus – im Layout der bekannten Vorlage
  *„Vorlage zur Dokumentation der täglichen Arbeitszeit“*.
- **Unterschriften werden nur einmal hinterlegt** und danach bei jedem Eintrag automatisch an der richtigen
  Stelle eingesetzt – mit dem richtigen Datum. Kein Nachlaufen mehr, kein „am falschen Tag unterschrieben“.
- **Der Chef** sieht alle Zettel, die **Einsatzliste** (großes Blatt mit allen Mitarbeitern) und lädt mit
  einem Klick alles als **PDF für den Steuerberater** herunter.

| Chef-Übersicht | Erfassen am Handy |
|---|---|
| ![Chef-Übersicht](docs/chef-uebersicht.jpg) | ![Erfassung am Handy](docs/handy-erfassung.jpg) |

| PDF: Stundenzettel | PDF: Einsatzliste |
|---|---|
| ![Stundenzettel als PDF](docs/pdf-stundenzettel.jpg) | ![Einsatzliste als PDF](docs/pdf-einsatzliste.jpg) |

## Brauchen wir eine Datenbank?

Ja – die Zeiten, Mitarbeiter und Unterschriften müssen dauerhaft und für alle gemeinsam gespeichert
werden. Verwendet wird **SQLite**: eine Datenbank in **einer einzigen Datei** (`data/stundenzettel.db`).
Für einen Betrieb mit auch 50+ Mitarbeitern ist das mehr als ausreichend, braucht keinen eigenen
Datenbank-Server und lässt sich durch Kopieren der Datei sichern (oder per Knopf in den Einstellungen).

## So funktioniert es

### Chef (einmalig)
1. App aufrufen → **Ersteinrichtung**: Name des Betriebs, eigener Zugang.
2. **Unterschrift des Arbeitgebers** einmal mit Finger/Maus hinterlegen.
3. Unter **Mitarbeiter** alle Mitarbeiter anlegen (Name, Benutzername, Pers.-Nr., Startpasswort).
   Optional: Logo hochladen (erscheint oben rechts auf dem Stundenzettel).

### Mitarbeiter
1. Erste Anmeldung mit dem Startpasswort → eigenes Passwort vergeben und **einmal unterschreiben**.
2. Danach nur noch: Datum, Beginn, Ende, Pause (ggf. Kürzel K/U/UU/F/SA/SU) → **Speichern**.
   Dauer wird automatisch berechnet, „aufgezeichnet am“ automatisch gesetzt, Unterschrift automatisch eingefügt.
3. Tipp: Im Handy-Browser „Zum Startbildschirm hinzufügen“ – dann ist die App wie ein Icon verfügbar.

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
| Einsatzliste, unten | Chef | Tag des letzten Eintrags aller Mitarbeiter im Monat |

- Die Spalte **„aufgezeichnet am“** wird bei jedem Speichern automatisch mit dem heutigen Datum gefüllt.
- Trägt oder ändert der **Chef** etwas für einen Mitarbeiter ein, wird die Zeile mit **„AG“** markiert und
  nicht mit der Mitarbeiter-Unterschrift versehen. Jede Änderung steht im **Änderungsprotokoll** des Zettels.
- Wird eine Unterschrift neu gezeichnet, behalten bereits unterschriebene Einträge ihre alte Unterschrift.

## Regeln, die die App prüft

- Keine Einträge für zukünftige Tage.
- Mitarbeiter können den **laufenden und den Vormonat** bearbeiten, ältere Monate nur der Chef.
- Abgeschlossene Monate sind gesperrt (Chef kann sie wieder öffnen).
- Hinweise bei zu kurzer Pause (§ 4 ArbZG: > 6 Std. → 30 Min., > 9 Std. → 45 Min.), bei mehr als 10 Stunden
  (§ 3 ArbZG) und wenn ein Tag später als 7 Tage nachgetragen wird (§ 17 MiLoG).

## Zum Formular

Beide Formulare sind den Papiervorlagen nachgebaut – Spalten, Reihenfolge, Leerzeile unter dem Kopf,
Summe, Unterschriftszeilen und Schlüssel-Legende. Abweichungen gegenüber dem Papier:

- **Einsatzliste:** In der zweiten Zeile unter „Name“ steht die Pers.-Nr.; zusätzlich gibt es eine Zeile
  **„Summe“** und unten die **Unterschrift des Arbeitgebers**. Pro Blatt passen wie auf dem Papier
  8 Mitarbeiter – bei mehr Mitarbeitern entstehen automatisch weitere Blätter.
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

### Im Internet betreiben (empfohlen: eigener kleiner Server mit Docker)

Die App muss für die Mitarbeiter von unterwegs erreichbar sein und **unbedingt über HTTPS** laufen.
Mit einem kleinen Server (z. B. Hetzner, IONOS, Strato – ab ca. 4–5 € im Monat) und einer Domain:

```bash
git clone <dieses-repo> && cd Digitale-Stunden-Zettel
DOMAIN=stunden.eiscafe-beispiel.de docker compose up -d
```

Die Domain muss per DNS auf den Server zeigen; [Caddy](https://caddyserver.com) besorgt das HTTPS-Zertifikat
automatisch. Die Datenbank liegt im Docker-Volume `stundenzettel-daten`.

Alternativ läuft die App auf jedem Hoster, der Node.js oder Docker **mit dauerhaftem Speicher** anbietet
(z. B. Railway, Render, Fly.io – dort ein Volume anlegen und `DATA_DIR` auf dessen Pfad setzen,
`TRUST_PROXY=1` setzen).

### Einstellungen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port der App |
| `DATA_DIR` | `data` | Ordner der Datenbank |
| `DB_FILE` | `$DATA_DIR/stundenzettel.db` | Pfad der Datenbankdatei (überschreibt `DATA_DIR`) |
| `APP_TIMEZONE` | `Europe/Berlin` | Zeitzone für „heute“ und „aufgezeichnet am“ |
| `TRUST_PROXY` | – | Hinter einem HTTPS-Proxy auf `1` setzen |
| `COOKIE_SECURE` | automatisch | `true` erzwingt sichere Cookies |

Eine `.env`-Datei (Vorlage: `.env.example`) wird mit `node --env-file=.env server.js` geladen.

## Datensicherung & Aufbewahrung

- In den **Einstellungen** (Chef) gibt es „Sicherung herunterladen“ – eine Kopie der kompletten Datenbank.
  Empfehlung: jeden Monat nach dem Export herunterladen und zusammen mit den PDFs ablegen.
- Arbeitszeitaufzeichnungen sind nach § 17 MiLoG **mindestens 2 Jahre** aufzubewahren. Ausgeschiedene
  Mitarbeiter deshalb nur **deaktivieren**, nicht löschen (Löschen ist bewusst nicht vorgesehen).

## Hinweis zur digitalen Unterschrift

Die hinterlegte Unterschrift ist eine *einfache elektronische Signatur* (Bild der Unterschrift + Protokoll,
wer wann was eingetragen hat). Für die Aufzeichnungspflicht nach § 17 MiLoG ist keine Unterschrift
vorgeschrieben – entscheidend ist die vollständige, zeitnahe Aufzeichnung. Bitte kurz mit dem Steuerberater
abstimmen, dass die digitalen Nachweise in dieser Form akzeptiert werden.

## Technik

- Node.js + Express, serverseitig gerenderte Seiten (EJS), kein Build-Schritt
- SQLite über `better-sqlite3`
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
views/               Seitenvorlagen
public/              CSS, Browser-Skript (Unterschriftenfeld, Live-Berechnung)
scripts/demo-data.js Beispieldaten
test/                Tests (node --test)
```
