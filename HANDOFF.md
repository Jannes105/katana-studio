# Handoff: Eigenes Tone Studio für BOSS Katana 100 Gen 3

## Ziel
Ein eigener, vollwertiger Ersatz für **BOSS Tone Studio (BTS)**, der per **USB-Kabel** funktioniert statt per Bluetooth.
Grund: Die mobile BTS-App braucht den kostenpflichtigen BT-DUAL-Adapter. Die Alternative „Katana Library“ versteckt
viele Funktionen hinter einer Paywall (z. B. Noise Gate). Am Ende soll die App **alle BTS-Funktionen** können, gern mehr.

## Rahmenbedingungen
- Geräte: **Android-Handy** (Hauptziel, während der Probe), **Windows-PC**. iPad gibt es auch, aber **kein Mac**,
  deshalb ist iOS vorerst zurückgestellt (Web MIDI gibt es auf iOS nicht, eine native App bräuchte Xcode).
- Verbindung: Handy USB-C ↔ Katana USB-C, PC USB-A ↔ Katana USB-C.
- Technik-Entscheidung: **Web-App (TypeScript/HTML) mit Web MIDI + SysEx in Chrome**, später als PWA installierbar.
  Hosting auf https nötig (Vorschlag: GitHub Pages). Ob es einen GitHub-Account gibt, ist noch offen.
- Grundsätzliche Arbeit am Amp geht weiter über BTS am PC. Die App ist vor allem fürs Feintuning während der Probe gedacht,
  soll langfristig aber alles können.

## Bewiesen (14.11.2026, am PC in Chrome)
- Der Katana erscheint als Web-MIDI-Port **„KATANA3“** (Eingang + Ausgang), wenn der Boss-USB-Treiber installiert ist.
  Wichtig: BTS muss geschlossen sein (exklusiver Port unter Windows).
- Identitätsantwort: `F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7` (Firmware 06 00 00 00).
- **Noise-Suppressor-Threshold per DT1 geändert, die Änderung war hörbar.** Der Prototyp funktioniert.
- Noch nicht geprüft: Kanalwechsel am Amp → automatische Aktualisierung; Test am Android-Handy.

## Protokoll (aus der BTS-Oberfläche ausgelesen)
BTS for Katana Gen 3 ist eine WebView2-App. Die HTML/JS-Oberfläche steckt als ZIP in der .exe.
`node tools/extract-bts.js <Ordner außerhalb des Projekts>` packt sie aus.
**Die ausgepackten Dateien sind © Roland: nicht ins Repo kopieren.** Wir schreiben eine eigene Parameterliste.

- SysEx-Header: `F0 41 <dev> 01 05 07 <cmd> …` → **Model-ID ist 3 Bytes: `01 05 07`**, Device-ID `10`
  (aus der Identitätsantwort übernehmen).
- `11` = RQ1 (Lesen: 4 Byte Adresse + 4 Byte Größe), `12` = DT1 (Schreiben: 4 Byte Adresse + Daten).
- Prüfsumme: `(128 - (summe(adresse+daten) % 128)) % 128`.
- Adressen in der BTS-Tabelle sind in Roland-7-Bit-Schreibweise und gehen so auf die Leitung, wie sie dort stehen.
  BTS rechnet intern linear (`nibble()`) und wandelt zum Senden zurück (`_7bitize()`).
- BTS sendet im Abstand von ca. 20 ms.
- Begrüßung wie BTS: Identity Request → RQ1 `7F 00 00 00` (Editor-Level, 1 Byte) → DT1 `7F 00 00 01` = `01`
  (Editor-Modus an) → RQ1 `7F 00 00 03` (Revision). Beim Beenden `7F 00 00 01` = `00`.
- Befehle (`address_const.js`): PATCH_SELECT `7F 00 01 00`, PATCH_WRITE `7F 00 01 04`, PATCH_CLEAR `7F 00 01 0E`,
  RUNNING_MODE `7F 00 00 02`.
- Speicherbereiche (`address_map.js`, root): SETUP `00 00 00 00` (Patch-Nummer), SYSTEM `10 00 00 00`,
  **aktueller Patch `20 00 00 00`**, gespeicherte Patches `20 10 00 00`…`21 20 00 00` (1–10), TEMP `30 00 00 00`, COMMAND `7F 00 00 00`.
- Innerhalb eines Patches (Auswahl): COM/Name `+00 00` (16 Zeichen), AMP `+06 00` (Gain +0, Volume +1, Bass +2, …, Typ +7),
  FX/DELAY/REVERB-Blöcke ab `+10 00`…, CONTOUR, PEDALFX, EQ (PEQ/GE10), **NS `+58 00`** (Schalter +0, Threshold +1 0–100,
  Release +2), SEND/RETURN `+5A 00`, ASSIGN-Bereiche ab `+5C 00`.
  Die komplette Liste mit Namen, Min/Max und Standardwerten steht in `address_map.js`.
- Weitere nützliche Dateien in der BTS-Oberfläche: `chain/*` (Effektkette), `ktn/liveset_converter.js` (.tsl-Format),
  `librarian/*` (Patch-Bibliothek), `common/midi_controller.js`.

## Was schon da ist
- `katana-test.html`: funktionierender Prototyp (Verbinden, Patch-Name, Noise Suppressor, Gain/Volume, freie RQ1-Anfragen, Log).
- `serve.js`: Mini-Server (`node serve.js` → http://localhost:8080, im LAN unter http://<PC-IP>:8080).
- `tools/extract-bts.js`: packt die BTS-Oberfläche zur Analyse aus.
- Erfahrung: Ein USB-Mitschnitt mit USBPcap/Wireshark hat den Katana-Verkehr **nicht** erfasst (nur Deskriptoren).
  Das Auslesen von BTS war der Weg, der funktioniert hat.

## Offene Entscheidungen für die Planungs-Session
1. **App-Name.** Vorschläge: *Patchwerk* (Favorit), *Ampwire*, *Knobwerk*, *Gatekeeper*, gern weitere, die zu einem
   vollständigen Studio passen. „Katana“/„BOSS“ nicht im Hauptnamen (Marken), höchstens „für BOSS Katana Gen 3“ als Untertitel.
2. **Fester Projektordner** (z. B. `C:\CLAUDE\<name>`) + Git. Die Dateien liegen aktuell in einem temporären Session-Ordner.
3. **Hosting/GitHub**: Account vorhanden? Repo öffentlich oder privat (öffentlich → keine Roland-Dateien)?
4. **Tech-Stack**: Vanilla TS + Vite? Svelte/Preact? PWA, offline-fähig.
5. **Architektur**: MIDI-Transport (Queue, 20 ms, RQ1-Timeouts) → Protokoll/Parameter-Modell (eigene Tabelle) →
   State-Sync (vom Amp gemeldete Änderungen) → UI. Optional später ein iOS-Transport.
6. **Feature-Roadmap** (ganzes Tone Studio und mehr): Kanäle/Patches wählen und speichern, Amp, Booster/Mod/FX/Delay/Reverb
   (alle Typen und Parameter), Effektkette, EQ, Contour, Pedal FX, Solo, Send/Return, Assigns/Expression, System- und
   USB-Einstellungen, Tuner, Patch-Bibliothek, .tsl-Import/-Export (Tone Exchange), Backups.
   Eigene Extras: Proben-Ansicht mit großen Reglern, Favoriten/Schnellzugriff, Vergleich A/B, Undo.
7. **Testansatz**: Protokollschicht mit Unit-Tests (Checksumme, Adressrechnung, Parsing), dazu ein Mock-Amp für die UI-Entwicklung.
