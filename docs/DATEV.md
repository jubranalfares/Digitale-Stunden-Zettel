# DATEV-Datei für die Lohnabrechnung

Zusätzlich zum PDF erstellt die App eine Importdatei für **DATEV LODAS**. Darin steht für jeden Mitarbeiter
eine Zeile mit der Summe seiner Arbeitsstunden im Monat. Die Kanzlei liest die Datei ein und muss nichts
abtippen. Das PDF mit den unterschriebenen Stundenzetteln bleibt der Nachweis.

## Einrichten (einmal)

1. **Einstellungen → DATEV**: Beraternummer, Mandantennummer, Lohnart für Arbeitsstunden und
   Bearbeitungsschlüssel eintragen. Alle vier Nummern kommen von der Kanzlei.
2. **Mitarbeiter → Bearbeiten**: bei jedem Mitarbeiter die Personalnummer aus DATEV eintragen.

Solange etwas fehlt, gibt es nur das PDF. Fehlt nur eine Personalnummer, steht im Fenster genau, bei wem.

## Verschicken (jeden Monat)

Einsatzliste öffnen, Monat wählen, **Für Steuerberater** antippen. Auf dem Handy öffnet sich das
Teilen-Menü mit beiden Dateien, also eine Mail mit PDF und DATEV-Datei im Anhang. Am Computer werden
beide heruntergeladen.

## Aufbau der Datei

Beispiel mit erfundenen Nummern ([DATEV_LODAS_Beispiel.txt](DATEV_LODAS_Beispiel.txt)):

```
[Allgemein]
Ziel=LODAS
Version_SST=1.0
BeraterNr=1234567
MandantenNr=12345
Datumsformat=TT.MM.JJJJ
Feldtrennzeichen=;
Zahlenkomma=,

[Satzbeschreibung]
10;u_lod_bwd_buchung_standard;pnr#bwd;abrechnung_zeitraum#bwd;bs_wert_butab#bwd;bs_nr#bwd;la_eigene#bwd;

[Bewegungsdaten]
10;101;01.10.2026;38,00;1;101;
10;102;01.10.2026;25,50;1;101;
10;103;01.10.2026;10,33;1;101;
```

| Feld | Inhalt |
|---|---|
| `10` | Satz-ID, verbindet die Datenzeile mit der Satzbeschreibung |
| `pnr#bwd` | Personalnummer |
| `abrechnung_zeitraum#bwd` | Abrechnungsmonat, immer der Erste des Monats |
| `bs_wert_butab#bwd` | Stunden im Monat als Dezimalzahl mit zwei Stellen (4,50 sind 4 Stunden 30 Minuten) |
| `bs_nr#bwd` | Bearbeitungsschlüssel aus den Einstellungen |
| `la_eigene#bwd` | Lohnart aus den Einstellungen |

Die Datei enthält nur Ziffern und Satzzeichen, der Zeichensatz spielt also keine Rolle. Jede Zeile endet
mit CR LF (Windows). Mitarbeiter ohne Stunden im Monat stehen nicht drin. Die Stunden sind dieselbe Summe
wie unten auf dem Stundenzettel.

## Was noch geprüft werden muss

Die offizielle Beschreibung („Schnittstellen in den DATEV-Programmen“, Dok.-Nr. 1080789, mit der
Feldliste der LODAS-Importschnittstelle) gibt es nur mit DATEV-Zugang. Der Aufbau oben stützt sich deshalb
auf Beispiele aus der DATEV-Community und von anderen Zeiterfassungsprogrammen. Die Kanzlei sollte
einmal bestätigen:

1. Passen die Tabelle `u_lod_bwd_buchung_standard` und die Feldnamen zu ihrer LODAS-Version?
2. Braucht ihr LODAS im Kopf weitere Angaben, zum Beispiel `Version_DB`?
3. Welche Lohnart und welcher Bearbeitungsschlüssel gelten für die Stunden der Minijobber?

Nicht enthalten sind Urlaub, Krankheit, Werte pro Tag und DATEV Lohn und Gehalt. Bei Lohn und Gehalt legt
die Kanzlei das Format selbst im ASCII-Import-Assistenten fest. Sobald sie es schickt, kann es ergänzt
werden.

## Probeimport, bevor das Papier wegfällt

Ob die Datei passt, zeigt sich erst beim Einlesen in DATEV, und das kann nur die Kanzlei.

1. Nummern eintragen, dann über **Für Steuerberater** eine echte Datei für den laufenden Monat erstellen.
   Die Beispieldatei oben hat erfundene Nummern und passt zu keinem echten Mandanten.
2. Die Kanzlei liest die Datei probeweise ein, am besten bei einem Test-Mandanten. Dafür in den
   Einstellungen vorübergehend dessen Mandantennummer eintragen, damit der Kopf der Datei dazu passt.
3. Einen Monat lang beides parallel führen: Papier wie gewohnt und die App mit Export. Stimmen die
   Ergebnisse überein, kann das Papier weg.
