# Katana Studio – Projektplan

*Katana Studio: eigener Editor für den BOSS Katana 100 Gen 3 per USB-Kabel.*
Stand: 15.11.2026 (nach Review überarbeitet) · Grundlage: `HANDOFF.md`, Prototyp `katana-test.html`

---

## 1. Worum es geht

Ein vollständiger, eigener Ersatz für BOSS Tone Studio (BTS), der **per USB-Kabel** funktioniert:
vom **Android-Handy** in der Probe und vom **Windows-PC** aus, ohne BT-DUAL-Adapter und ohne Paywall.

- **Wichtigster Einsatz:** Feintuning während der Probe am Handy (große Regler, schnell, zuverlässig).
- **Langfristig:** alles, was BTS kann, und mehr (Bibliothek, Backups, A/B-Vergleich, Undo).
- **Kein Ziel (vorerst):** iOS/iPad (dafür bräuchte es einen Mac), Audio über USB, Verkauf oder Vertrieb.
- **Gilt als gescheitert, wenn** die App in der Probe hakt, Einstellungen verliert oder versehentlich
  Patches überschreibt, auch wenn sie technisch „funktioniert“.

## 2. Getroffene Entscheidungen

| Thema | Entscheidung |
|---|---|
| Name | **Katana Studio**, Untertitel „für BOSS Katana Gen 3“. „BOSS“ steht **nicht** im Titel (zu nah an „BOSS Tone Studio“). Name und Untertitel stehen im Code an **einer** Stelle (`src/app-info.ts`). Der Name muss vor der ersten PWA-Installation feststehen: installierter App-Name und Repo-URL sind später schwer zu ändern. |
| Hosting | **Öffentliches GitHub-Repo** (Konto `Jannes105`) + **GitHub Pages** → `https://jannes105.github.io/katana-studio/` |
| Rechtliches | Keine Roland-Dateien im Repo (auch nicht in Teilen), keine BOSS-Logos/-Grafiken. Eigene Parameterliste. Hinweis in README und App: *„Inoffizielles Hobbyprojekt, nicht von BOSS/Roland. BOSS und Katana sind Marken der Roland Corporation.“* `.gitignore` schließt Auspack-Ordner aus. Das Auspack-Werkzeug `extract-bts.js` bleibt **lokal** und kommt nicht ins öffentliche Repo. |
| Plattform | Web-App in **Chrome** mit **Web MIDI + SysEx**, installierbar als **PWA**, funktioniert offline im Proberaum. |
| Sprache | Oberfläche **deutsch**, Parameternamen **englisch wie am Amp** (Gain, Bass, Threshold …). Vorerst keine Übersetzungs-Infrastruktur. Texte der Oberfläche liegen gesammelt an einer Stelle, damit das später nachrüstbar bleibt. |
| Datenhaltung | Der **Amp ist die Wahrheit** für den aktuellen Klang. Alles, was nur in der App existiert (Bibliothek, Backups, Setlisten, Einstellungen), liegt in IndexedDB **und** lässt sich jederzeit als Datei exportieren. |

## 3. Technik

- **TypeScript** (strict): findet Tippfehler und falsche Adressen schon vor dem Ausführen.
- **Vite**: Entwicklungsserver und Build-Werkzeug, Standard und schnell.
- **Svelte 5**: UI-Bibliothek. Erzeugt kleinen, schnellen Code (gut fürs Handy) und ist leicht lesbar.
- **vite-plugin-pwa**: Installierbarkeit und Offline-Betrieb.
- **Vitest**: automatische Tests für alles unterhalb der UI.
- **Playwright**: wenige Ende-zu-Ende-Tests der Oberfläche gegen den Mock-Amp.
- **ESLint + Prettier**: einheitlicher Code, ESLint erzwingt zusätzlich die Schichtgrenzen (siehe 4.1).
- **GitHub Actions**: prüft und veröffentlicht automatisch (siehe 6).

## 4. Architektur

Jede Schicht kennt nur die darunterliegende:

```
┌────────────────────────────────────────────────────────┐
│ UI (Svelte)    Proben-Ansicht, Editor, Bibliothek      │
├────────────────────────────────────────────────────────┤
│ State          Spiegel des Amps, Undo, „ungespeichert“ │──┐
├────────────────────────────────────────────────────────┤  │  ┌───────────────────────────┐
│ Modell         eigene Parameterliste (Speicherlayout   │  ├─▶│ Storage                   │
│                + Darstellung)                          │  │  │ IndexedDB, Patch-Dateien, │
├────────────────────────────────────────────────────────┤  │  │ Export/Import             │
│ Protokoll      Roland-SysEx: RQ1/DT1, Prüfsumme,       │──┘  └───────────────────────────┘
│                7-Bit-Adressen, Begrüßung               │
├────────────────────────────────────────────────────────┤
│ Transport      Web MIDI │ Mock-Amp │ (WebUSB) │ (iOS)  │
└────────────────────────────────────────────────────────┘
```

### 4.1 Grundregel: Kern ohne Framework

`midi/`, `protocol/`, `model/`, `state/`, `storage/` und `mock/` sind **reines TypeScript**: keine Svelte-Importe,
kein Zugriff auf das DOM. Svelte liegt als dünne Hülle darüber (`ui/`), die den State nur abonniert und Befehle aufruft.

- Dadurch ist alles Wichtige ohne Browser testbar, und die Oberfläche bleibt austauschbar.
- Eine ESLint-Regel verbietet Importe „nach oben“ (z. B. `protocol/` darf nichts aus `state/` oder `ui/` laden).

### 4.2 Transport (`src/midi/`)

- Gemeinsame Schnittstelle `Transport` (`send`, `onMessage`, Verbindungsstatus). Umsetzungen: **Web MIDI** (Standard),
  **Mock-Amp**, als Ausweg **WebUSB** (siehe Risiken), später ein iOS-Transport.
- Findet den Port „KATANA3“ (oder nach Name/ID-Antwort), bemerkt Ein- und Ausstecken (`onstatechange`), verbindet neu.
- **Sende-Warteschlange mit 20 ms Abstand** wie BTS. Wird ein Regler gezogen, ersetzt der neueste Wert den noch nicht
  gesendeten Wert derselben Adresse (keine Datenflut, kein Hinterherhinken).
- Die Warteschlange lässt sich **gezielt leeren** (nötig bei Patchwechsel, siehe 4.5).
- RQ1 mit Timeout und einer Wiederholung, große Lesebereiche werden in Stücke geteilt.
- **Nur ein Tab sendet:** über die Web-Locks-API hält genau ein Tab die Verbindung. Ein zweiter Tab zeigt einen Hinweis
  statt selbst zu senden.

### 4.3 Protokoll (`src/protocol/`)

- Bauen und Zerlegen von Roland-Nachrichten (Header `F0 41 <dev> 01 05 07`), Prüfsumme,
  Rechnen mit 7-Bit-Adressen (`nibble`/`7bitize`), Werte mit mehreren Nibbles.
- Begrüßung wie BTS (Identity → Editor-Level → Editor-Modus an → Revision), Abmelden beim Schließen.
- Befehle: Patch wählen, speichern, löschen.
- **Schreiben auf Speicherplätze wird geprüft:** nach dem Schreiben zurücklesen und mit dem Gesendeten vergleichen.
  Bei Abweichung klare Fehlermeldung, kein stilles Weitermachen.

### 4.4 Modell (`src/model/`)

Unsere eigene Parameterliste. Die UI wird **aus dieser Liste erzeugt**: Neue Parameter bedeuten vor allem einen neuen
Eintrag in der Liste, kaum neue Oberfläche. An diesem Schema hängt die Skalierbarkeit von Phase 2 und 3, deshalb muss es
von Anfang an mehr können als Min/Max:

- **Zwei getrennte Teile:**
  - *Speicherlayout*: Block, Offset, Größe in Bytes/Nibbles, Min/Max, Standardwert. Ändert sich nur mit der Firmware.
  - *Darstellung*: Name, Gruppe, Regler-Art (Drehregler, Schalter, Auswahl), Einheit, Reihenfolge, „wichtig für Proben-Ansicht“.
- **Varianten je Typ:** Jeder Effekttyp (z. B. Chorus, Flanger, Phaser im Mod-Block) hat einen eigenen Parametersatz.
  Das Schema beschreibt pro Block einen Typ-Parameter und je Typ die zugehörigen Parameter.
- **Wertumrechnung:** nicht nur linear. Tabellen (z. B. Notenwerte, Frequenzlisten), Mehrbyte-Werte (z. B. Delay-Zeit),
  Versatz (z. B. Anzeige −50…+50 bei Rohwert 0…100). Jeder Parameter hat ein Paar `rohwert → anzeige` / `anzeige → rohwert`.
- **Abhängigkeiten:** Parameter, die nur unter einer Bedingung gelten oder sichtbar sind (z. B. nur bei bestimmtem Typ oder Modus).
- **Firmware-Bezug:** Die Liste trägt die Firmware-Version, gegen die sie geprüft wurde.
- **Schema-Probe vor dem UI-Bau:** Das Schema wird zuerst an zwei schwierigen Blöcken durchgespielt (Mod/FX mit allen
  Typen sowie Assigns). Erst wenn beide sauber hineinpassen, baut die UI darauf auf.
- **Prüfung am echten Amp:** Ein Testwerkzeug liest jeden Block und vergleicht mit dem, was BTS am Display zeigt.
- Geschrieben werden **nur Adressen aus dieser Liste**, Werte werden auf Min/Max begrenzt.

### 4.5 State (`src/state/`)

Hält eine Kopie des aktuellen Patches (und später aller gespeicherten Patches). Hier entscheidet sich, ob die App in der
Probe hakt, deshalb gelten feste Regeln:

1. **Der Amp ist die Wahrheit.** Die App zeigt eigene Änderungen sofort an (damit Regler nicht träge wirken) und gleicht
   danach mit dem ab, was der Amp meldet.
2. **Patchwechsel leert die Warteschlange.** Noch nicht gesendete Reglerwerte werden verworfen, dann wird der neue Patch
   komplett gelesen. Sonst landen alte Werte im neuen Patch.
3. **Echo oder echte Änderung:** Meldet der Amp einen Wert, den die App gerade selbst gesendet hat, ist das ein Echo.
   Alles andere ist eine Änderung am Gerät und wird übernommen. Solange ein Regler in der App gezogen wird, gewinnt für
   diesen Parameter die App.
4. **„Ungespeichert“** ergibt sich aus dem Vergleich des aktuellen Patches mit dem zuletzt gelesenen/gespeicherten Stand,
   nicht aus einem mitgezählten Merker.
5. **Undo/Redo** speichert Parameteränderungen (Adresse, alter Wert, neuer Wert). Ein Patchwechsel schließt die Liste ab.
6. **Sicherheitsregel:** Speichern auf einen Amp-Speicherplatz passiert nur nach ausdrücklicher Bestätigung.
7. **Verbindungsabbruch** ist ein normaler Zustand: Die App friert die Regler ein, zeigt den Status und liest nach dem
   Wiederverbinden den aktuellen Patch neu.

### 4.6 Storage (`src/storage/`)

Alles, was die App dauerhaft behält. Diese Schicht fehlte im ersten Entwurf.

- **IndexedDB** mit **Schema-Version und Migrationen** von Anfang an. Datenbankname mit Präfix `katana-studio`, weil sich
  alle Projekte unter `jannes105.github.io` denselben Speicher teilen.
- **`navigator.storage.persist()`** beim ersten Start anfragen, sonst darf der Browser die Daten bei Platzmangel löschen.
- **Eigenes Patch-Dateiformat** (JSON), festgelegt in Phase 1:
  - Formatversion, Erstellungsdatum, App-Version, Firmware-Version des Amps
  - Patch-Inhalt als **Rohbytes pro Speicherbereich** (so, wie der Amp sie liefert), dazu der Name als Klartext
  - Rohbytes bleiben gültig, auch wenn sich unsere Parameterliste ändert oder Fehler in ihr korrigiert werden.
- **Export/Import als Datei** für einzelne Patches und für komplette Backups, von der ersten Version an.
  Wichtig, weil die Daten an der Adresse `jannes105.github.io` hängen: Eine spätere eigene Domain oder ein
  zurückgesetzter Browser bedeutet sonst eine leere Bibliothek.
- **Automatisches Backup** aller Amp-Patches vor jeder Aktion, die mehrere Speicherplätze überschreibt.

### 4.7 Mock-Amp und Mitschnitt (`src/mock/`)

- Simulierter Katana im Browser: hat den Speicher, antwortet auf RQ1, nimmt DT1 an, kann Patchwechsel „spielen“.
  So lässt sich die Oberfläche ohne angeschlossenen Amp entwickeln und testen (auch von Claude).
- **Mitschnitt-Modus ab Phase 0:** protokolliert echte Sitzungen (jede Nachricht mit Zeitstempel und Richtung) und spielt
  sie wieder ab. Er ist das Diagnosewerkzeug für Probleme in der Probe und für das Erkunden des Protokolls.
- **Der Mock wird an echten Mitschnitten geprüft:** Tests spielen aufgezeichnete Sitzungen gegen den Mock ab. Weicht er
  vom echten Amp ab, schlägt der Test fehl.
- Mitschnitte unter `captures/` bleiben privat (können persönliche Patches enthalten). Ausgewählte, bereinigte Mitschnitte
  kommen als Testdaten nach `tests/fixtures/`.
- In der App: Protokoll-Ansicht mit „Mitschnitt exportieren“, damit sich ein Problem aus der Probe später nachstellen lässt.

### 4.8 Ordnerstruktur

```
katana-studio/
  src/
    app-info.ts     Name, Untertitel, Version
    midi/           Transport, Warteschlange
    protocol/       SysEx, Begrüßung, Befehle
    model/          Parameterliste (Layout + Darstellung)
    state/          Spiegel des Amps, Undo
    storage/        IndexedDB, Patch-Format, Export/Import
    mock/           Mock-Amp, Mitschnitt
    ui/             Svelte-Oberfläche
  tests/            Unit-Tests, fixtures/ (bereinigte Mitschnitte)
  e2e/              Playwright-Tests gegen den Mock-Amp
  prototype/        katana-test.html, serve.js (Referenz)
  docs/             PLAN.md, HANDOFF.md, protocol-notes.md
```

`tools/extract-bts.js` bleibt lokal (in `.gitignore`), siehe Rechtliches.

## 5. Roadmap

Jede Phase endet mit einer Version, die in der Probe benutzbar ist.

### Phase 0 – Fundament und Android-Test *(zuerst, entscheidet über alles)*
- Git, öffentliches Repo, GitHub Pages. Vorher: `tools/extract-bts.js` in `.gitignore` aufnehmen.
- Den **bestehenden Prototyp sofort auf GitHub Pages** stellen und **am Android-Handy testen**.
  Das ist das größte offene Risiko: Unter Windows braucht der Katana den Boss-Treiber. Ob Android ihn als
  USB-MIDI-Gerät erkennt, wissen wir noch nicht.
  - Klappt es: weiter wie geplant.
  - Klappt es nicht: **WebUSB-Transport** als Ausweg prüfen (siehe Risiken), bevor weitergebaut wird.
- Prüfen: Meldet der Amp einen Kanalwechsel am Gerät von selbst?
- Vite + Svelte + TypeScript + ESLint aufsetzen, CI einrichten (siehe 6).
- Protokoll-Schicht mit Tests aus dem Prototyp übernehmen, Mock-Amp-Grundgerüst, **Mitschnitt-Modus**.
- **Schema-Probe** für die Parameterliste (Mod/FX und Assigns, siehe 4.4).

### Phase 1 – Proben-App

**1a – Nur lesen** *(erste probentaugliche Version, kann am Amp nichts kaputt machen)*
- Verbinden mit klarer Statusanzeige, automatische Neuverbindung, Firmware-Version anzeigen.
- Aktuellen Patch lesen und anzeigen (Name, Amp, Effekte), Änderungen am Amp folgen.
- **Backup aller Amp-Patches in eine Datei** (rein lesend). Das Sicherheitsnetz muss stehen, bevor die App schreibt.
- Storage-Schicht und Patch-Dateiformat.
- Als PWA installierbar, offline nutzbar, Update-Abfrage (siehe 6).

**1b – Live einstellen**
- Kanäle/Patches wählen.
- **Amp:** Typ, Gain, Volume, Bass, Middle, Treble, Presence (soweit vorhanden).
- **Effekte:** Booster, Mod, FX, Delay, Reverb: an/aus, Typ, die wichtigsten Regler.
- **Noise Suppressor:** an/aus, Threshold, Release.
- **Proben-Ansicht:** große Regler, wenige Bedienelemente, gut im Stehen bedienbar. Bildschirm bleibt an (Wake Lock).
- Hinweis bei ungespeicherten Änderungen.

**1c – Speichern**
- **Speichern** auf den aktuellen Kanal: mit Bestätigung, Zurücklesen und Vergleich.
- Vor dem ersten Speichern einer Sitzung prüft die App, ob ein aktuelles Backup existiert, und bietet sonst eines an.

### Phase 2 – Alle Klangparameter
- Alle Effekttypen mit allen Parametern.
- Contour, Pedal FX, Solo, Send/Return.
- EQ (parametrisch und 10-Band-Grafik-EQ).
- Effektkette (Reihenfolge der Blöcke).

### Phase 3 – Steuerung und System
- Assigns, Expression-Pedal, Fußschalter (GA-FC).
- System- und USB-Einstellungen.
- Tuner (falls der Amp Tuner-Daten per SysEx liefert, wird in Phase 0/1 geprüft).

### Phase 4 – Bibliothek und Austausch
- Eigene Patch-Bibliothek auf dem Gerät, Ordner/Suche.
- **Wiederherstellen** aller Amp-Patches aus einem Backup (automatisches Backup davor, Zurücklesen danach).
- **.tsl-Import/-Export** (Format von BOSS Tone Exchange), über eigenen Konverter.

### Phase 5 – Eigene Extras
- A/B-Vergleich zweier Einstellungen, Undo/Redo-Verlauf.
- Favoriten-Regler / Schnellzugriff pro Song.
- Setlisten (Reihenfolge von Patches für einen Auftritt).
- Weitere Ideen sammeln wir unterwegs.

### Später / optional
- iOS über eine native Hülle mit eigenem Transport (braucht Mac).

## 6. Qualität, Tests und Veröffentlichung

**Tests**
- **Unit-Tests (Vitest)** für Prüfsumme, Adressrechnung, Nachrichtenbau/-zerlegung, Warteschlange, Parameterliste,
  State-Regeln (4.5) und Storage-Migrationen.
- **Mitschnitt-Tests:** aufgezeichnete echte Sitzungen werden gegen Protokoll und Mock abgespielt.
- **Ende-zu-Ende (Playwright):** wenige Tests der wichtigsten Abläufe gegen den Mock-Amp
  (verbinden, Regler ziehen, Patch wechseln, speichern mit Bestätigung).
- **Testplan pro Phase am echten Amp** (PC und Handy): kurze Checkliste, in ein paar Minuten durchgegangen.

**CI (GitHub Actions)**
- Bei jedem Push: Typprüfung, ESLint, Unit-Tests, Playwright-Tests, Build.
- Veröffentlicht wird nur, wenn alles grün ist.

**Veröffentlichung in zwei Kanälen**
- **Vorschau:** jeder Push auf `main` → `https://jannes105.github.io/katana-studio/next/`
- **Stabil:** nur per Versions-Tag (z. B. `v0.3.0`) → `https://jannes105.github.io/katana-studio/`
  Das ist die Version, die in der Probe läuft. So kommt kein ungeprüfter Stand kurz vor der Probe aufs Handy.
- Beide Kanäle nutzen getrennte Service Worker und getrennte Datenbanknamen, damit die Vorschau die Proben-Daten nicht anfasst.

**PWA-Updates**
- Der Service Worker spielt Updates **nie von selbst mitten in der Sitzung** ein. Die App meldet „Neue Version verfügbar“
  und aktualisiert erst nach Bestätigung.
- Die App zeigt ihre Version sichtbar an (Einstellungen und Protokoll-Export).

## 7. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Android erkennt den Katana nicht als MIDI-Gerät | Gleich in Phase 0 testen. Ausweg: **WebUSB-Transport**. Chrome auf Android kann herstellerspezifische USB-Schnittstellen direkt ansprechen, und die `Transport`-Schnittstelle trägt das bereits. Ob es beim Gen 3 klappt, ist **ungeprüft**. Unter Windows bleibt es bei Web MIDI (dort belegt der Boss-Treiber das Gerät). |
| BTS blockiert den Port am PC | Hinweis in der App: BTS schließen. |
| Falsche Adresse schreibt Unsinn in den Amp | Nur bekannte Adressen aus unserer Liste schreiben, Werte auf Min/Max begrenzen, Backup vor der ersten Schreibfunktion (Phase 1a), Zurücklesen nach dem Speichern. |
| Datenverlust in der App (Browser löscht Speicher, Domainwechsel, neues Handy) | `storage.persist()`, Datei-Export von Anfang an, Rohbyte-Format mit Versionsnummer, Migrationen mit Tests. |
| Fehlerhaftes Update kurz vor der Probe | Stabiler Kanal nur per Versions-Tag, Update nur nach Bestätigung, Vorschau-Kanal zum Ausprobieren. |
| Mock-Amp verhält sich anders als der echte Amp | Mitschnitt-Tests mit echten Aufzeichnungen, Testplan am Amp pro Phase. |
| Firmware-Update ändert das Protokoll | Firmware-Version beim Verbinden anzeigen und mit der Version der Parameterliste vergleichen, Abweichungen melden. |
| Zwei Tabs senden gleichzeitig | Web Locks: nur ein Tab hält die Verbindung. |
| Markenbeschwerde wegen öffentlichem Repo | Kein „BOSS“ im Titel, Hinweis „inoffiziell“, keine Logos, kein Auspack-Werkzeug im Repo. Bei Beschwerde umbenennen (Name an einer Stelle). |

## 8. Offene Punkte für den nächsten Schritt

- Android-Test mit dem Prototyp (entscheidet über Web MIDI oder WebUSB).
- Meldet der Amp Kanalwechsel und Regleränderungen von selbst?
- Liefert der Amp Tuner-Daten per SysEx?
- Ergebnis der Schema-Probe (4.4): Passen Mod/FX und Assigns in das Schema?
