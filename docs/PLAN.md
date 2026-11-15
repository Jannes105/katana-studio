# Katana Studio – Projektplan

*Katana Studio: eigener Editor für den BOSS Katana 100 Gen 3 per USB-Kabel, als Android-App.*
Stand: 15.11.2026, nach mehreren Prüfrunden und ersten Messungen am Amp überarbeitet · Vorgeschichte: `HANDOFF.md` (teilweise überholt, dieser Plan gilt)

---

## 1. Worum es geht

Ein vollständiger, eigener Ersatz für BOSS Tone Studio (BTS) auf dem **Android-Handy**, der **per USB-Kabel** mit dem Amp
spricht: ohne BT-DUAL-Adapter und ohne Paywall. Am Handy soll sich alles einstellen lassen, was am PC in BTS geht.

- **Wichtigster Einsatz:** Feintuning während der Probe, **Handy in der Hand, hochkant, oft mit umgehängter Gitarre**.
  Also: Bedienung mit einer Hand, große Bedienelemente, schnell und zuverlässig.
- **Langfristig:** alles, was BTS kann, und mehr (Bibliothek, Backups, A/B-Vergleich, Undo).
- **Kein Ziel (vorerst):** PC-Version (dort gibt es BTS), iOS/iPad (bräuchte einen Mac), Audio über USB, Verkauf oder Vertrieb.
- **Gilt als gescheitert, wenn** die App in der Probe hakt, Einstellungen verliert oder versehentlich
  Patches überschreibt, auch wenn sie technisch „funktioniert“.

**Rahmen:** Handy *Nothing Phone (3a) Pro*. Amp *Katana 100 Gen 3* (Modellcode `06` in der Identitätsantwort; eine
Firmware-Version liefert diese Antwort **nicht**), im normalen USB-Modus („Vendor“, nicht „Generic“).
Gespielt wird auf den **Kanälen A1–B4**, Panel wird nicht genutzt.

## 2. Getroffene Entscheidungen

| Thema | Entscheidung |
|---|---|
| Name | **Katana Studio**, Untertitel „für BOSS Katana Gen 3“. „BOSS“ steht **nicht** im Titel (zu nah an „BOSS Tone Studio“). Name und Untertitel stehen im Code an **einer** Stelle (`src/app-info.ts`). Die **App-ID** `io.github.jannes105.katanastudio` steht ab der ersten Installation fest. |
| Plattform | **Android-App (APK)**, gebaut mit **Capacitor**: Oberfläche mit Webtechnik, USB-Verbindung als kleines **natives Plugin (Kotlin)**. Läuft offline. Öffnet sich beim Einstecken des Kabels von selbst. |
| Warum nicht … | *Reine Web-App:* Der PC-Vorteil fällt weg, eine App ist unabhängig von Chrome. *Expo Go:* kann keinen eigenen USB-Code ausführen. *Expo/React Native:* möglich, aber am PC schlechter testbar. *Komplett nativ:* jeder Schritt langsamer und nur am Handy testbar. |
| Repo und Verteilung | **Öffentliches GitHub-Repo** (Konto `Jannes105`). APKs als **GitHub Releases**. GitHub Pages nur für Testseiten. |
| Rechtliches | Keine Roland-Dateien im Repo (auch nicht in Teilen), keine BOSS-Logos/-Grafiken, eigene Parameterliste. Hinweis in README und App: *„Inoffizielles Hobbyprojekt, nicht von BOSS/Roland. BOSS und Katana sind Marken der Roland Corporation.“* `.gitignore` schließt Auspack-Ordner und `tools/extract-bts.js` aus (das Werkzeug bleibt lokal). |
| Sprache | Oberfläche **deutsch**, Parameternamen **englisch wie am Amp** (Gain, Bass, Threshold …). Texte der Oberfläche liegen gesammelt an einer Stelle. |
| Datenhaltung | Der **Amp ist die Wahrheit** für den aktuellen Klang. Was nur in der App existiert (Backups, später Bibliothek, Setlisten), lässt sich jederzeit als Datei exportieren. |
| Kanalwechsel mit Ungespeichertem | **Einfach wechseln**, wie am Amp: ohne Rückfrage, nichts blockiert. Die App **merkt sich aber die ungespeicherten Änderungen** des verlassenen Kanals und bietet sie dort als Leiste an („Änderungen von A2 zurückholen“). Am Amp sind sie weg, in der App nicht: sonst löscht ein Fehltipp das Feintuning, und das gilt laut Abschnitt 1 als gescheitert. |

## 3. Technik

- **TypeScript** (strict), **Vite**, **Svelte 5** für die Oberfläche.
- **Capacitor**: verpackt die Oberfläche als Android-App und verbindet sie mit nativem Code.
- **Kotlin**: nur für das USB-Plugin (Android USB Host API).
- **Vitest**: automatische Tests für alles unterhalb der Oberfläche.
- **ESLint + Prettier**: einheitlicher Code. ESLint erzwingt zusätzlich die Schichtgrenzen (siehe 4.1).
- **GitHub Actions**: prüft, baut und signiert die APK für Releases (siehe 6).
- **Lokaler Build fürs Entwickeln:** JDK und die Android-Kommandozeilen-Werkzeuge auf dem PC (kein Android Studio nötig),
  Installation und Log per **`adb` über WLAN**, weil der USB-Anschluss des Handys vom Amp belegt ist. Grund: Der
  USB-Code ist der riskanteste Teil, und der Umweg „pushen, auf CI warten, APK laden, Log am Bildschirm lesen“ wäre
  dafür zu langsam.

**Entwicklungsweise:** Fast alles entsteht und wird geprüft am PC im Browser, mit dem Mock-Amp oder per Web MIDI am echten
Amp (über den Boss-Treiber). Nur das USB-Plugin und der Gesamttest brauchen das Handy.

## 4. Architektur

Jede Schicht kennt nur die darunterliegende:

```
┌────────────────────────────────────────────────────────┐
│ UI (Svelte)    Proben-Ansicht, Editor                  │
├────────────────────────────────────────────────────────┤
│ State          Spiegel des Amps, Abläufe, „ungespeichert“ │──┐
├────────────────────────────────────────────────────────┤  │  ┌──────────────────────────┐
│ Modell         eigene Parameterliste (Speicherlayout   │  ├─▶│ Storage                  │
│                + Darstellung)                          │  │  │ Patch-/Backup-Dateien    │
├────────────────────────────────────────────────────────┤  │  └──────────────────────────┘
│ Protokoll      Roland-SysEx: RQ1/DT1, Prüfsumme,       │──┘
│                Adressrechnung, Kodierung, Begrüßung    │
├────────────────────────────────────────────────────────┤
│ Transport      Android-USB │ Web MIDI │ Mock │ (WebUSB)│
└────────────────────────────────────────────────────────┘
```

### 4.1 Grundregel: Kern ohne Framework

`midi/`, `protocol/`, `model/`, `state/`, `storage/` und `mock/` sind **reines TypeScript**: keine Svelte-Importe,
kein Zugriff auf das DOM, kein Capacitor. Svelte liegt als dünne Hülle darüber (`ui/`). Capacitor taucht nur in der
Android-Transport-Umsetzung und in Datei-Hilfen (Teilen/Speichern) auf.
Eine ESLint-Regel verbietet Importe „nach oben“ (z. B. `protocol/` darf nichts aus `state/` oder `ui/` laden).

### 4.2 Transport (`src/midi/`, Plugin unter `android/`)

Gemeinsame Schnittstelle `Transport` (`send`, `onMessage`, Verbindungsstatus). Umsetzungen:

- **Android-USB** (Hauptweg): Capacitor-Plugin in Kotlin, öffnet das Gerät über die Android USB Host API und reicht nur
  Bytes durch. Das Verpacken von SysEx in USB-MIDI-Pakete (je 4 Bytes) und das Auspacken passieren in TypeScript und
  sind damit testbar. Ein empfangener Block kann mehrere Pakete enthalten.
- **Web MIDI**: für die Entwicklung am PC (über den Boss-Treiber, Port „KATANA3“).
- **Mock-Amp**: für Entwicklung und Tests ohne Amp.
- **WebUSB**: nur für den Machbarkeitstest in Phase 0a.

**Pflichten des Plugins** (Android-Fallstricke, alle umzusetzen):
- Nur das **MIDI-Interface** übernehmen, Audio-Interfaces nicht anfassen. `claimInterface(…, force = true)`, falls der
  Kernel es schon belegt hat. Das richtige **Altsetting** per `setInterface` wählen (Roland legt MIDI teils auf Altsetting 1).
- Endpunkte können **Bulk oder Interrupt** sein; beides unterstützen.
- Empfangen in einem eigenen Lese-Thread (`UsbRequest.queue` oder `bulkTransfer` mit Timeout).
- Berechtigung: Geräte-Filter `VID 0x0582 / PID 0x02F0` für `USB_DEVICE_ATTACHED` im Manifest, dann fragt Android nur
  einmal („Immer mit dieser App öffnen“). Für `requestPermission` einen expliziten, veränderbaren PendingIntent
  (`FLAG_MUTABLE`, `setPackage`) verwenden.
- `USB_DEVICE_DETACHED` zur Laufzeit registrieren (`RECEIVER_NOT_EXPORTED`).
- `launchMode="singleTask"`, Einstecken bei laufender App über `onNewIntent`.

**Sende-Warteschlange** (`src/midi/queue.ts`):
- Abstand wie BTS: **20 ms plus Nachrichtenlänge ÷ 3,125 ms** (bildet die alte MIDI-Geschwindigkeit nach). Das zählt bei großen Nachrichten.
- Wird ein Regler gezogen, ersetzt der neueste Wert den noch nicht gesendeten Wert derselben Adresse.
- Lässt sich **gezielt leeren** (bei Patchwechsel, siehe 4.5).
- **Immer nur ein RQ1 offen.** Die Antwort besteht bei Bereichsanfragen aus vielen DT1 (ein DT1 pro Block, siehe 4.2b).
  Antworten werden **nach Adresse zugeordnet, nicht nach Reihenfolge**: Der Amp liefert die Blöcke nicht streng
  aufsteigend und schiebt eigene Meldungen dazwischen. Ein Ende-Zeichen gibt es nicht; fertig ist die Anfrage, wenn
  alle erwarteten Blockadressen da sind. Timeout, dann eine Wiederholung, dann Verbindungsfehler.
- **Schreiben geht vor Lesen:** Ein Reglerwert (DT1) wartet nie hinter einer laufenden Hintergrund-Leseanfrage.

### 4.2a Befund USB (15.11.2026)

- Der Katana meldet sich als **herstellerspezifisches Gerät** (`VID_0582 PID_02F0`, Klasse `FF/FF`), unter Windows
  bedient vom Roland-Treiber `RDID1254`. Er ist **kein** Standard-USB-MIDI-Gerät.
- Der **„Generic“-USB-Modus** (ab Firmware 1.07, beim Einschalten [MOD] halten) kann laut Roland **nur Audio, kein MIDI**.
  Der Amp bleibt im normalen Modus.
- Folge: Android sieht den Amp nicht als MIDI-Gerät. Die App spricht die USB-Schnittstelle selbst an.
- Das **USB-MIDI-Paketformat** ist bei Roland-Geräten dieser Art üblich. Belegt ist das durch den Linux-Treiber
  (`snd-usb-audio`, Roland-Sonderbehandlung inkl. Altsetting-Umschaltung) und Erfahrungen mit dem BOSS GT-1. **Für den Gen 3
  ist es ungeprüft**, ebenso welches Altsetting und welcher Endpunkt-Typ.
- **WebUSB im Handy-Chrome** kann nur ein „Ja“ liefern: Belegt der Android-Kernel das Interface schon, scheitert Chrome, während
  eine App es sich mit `force` holen kann. Ein Fehlschlag dort ist also kein Ausschlusskriterium.
- **Am Quelltext geprüft (15.11.2026):**
  - *Android zeigt den Amp nicht als MIDI-Gerät.* Das Android-Framework legt ein MIDI-Gerät nur an, wenn ein Interface
    die Klasse Audio mit Unterklasse MIDI-Streaming hat (`UsbDescriptorParser.hasMIDIInterface()`). Bei Klasse `FF`
    geschieht das nicht, einen Ausweichweg gibt es dort nicht. Web MIDI im Handy-Chrome fällt damit sehr wahrscheinlich
    aus; der Fünf-Minuten-Versuch mit `katana-test.html` am Handy bleibt trotzdem der erste Schritt in 0a, weil er nichts kostet.
  - *Der Linux-Kernel erkennt Roland-Geräte dieser Art automatisch* (Sammeleintrag für `VID 0582` mit Klasse `FF` in
    `sound/usb/quirks-table.h`, MIDI-Erkennung über den Roland-Deskriptor `06 24 F1 02 …`). Hat der Handy-Kernel diesen
    Treiber, belegt er das Interface. **Der WebUSB-Versuch scheitert dann voraussichtlich, die Test-APK mit `force` ist
    der wahrscheinliche Weg.** Ob der Treiber im Kernel des Nothing Phone steckt, ist offen.

### 4.2b Messungen am Amp (15.11.2026, am PC über den Boss-Treiber, nur gelesen)

Gemessen mit einem kleinen Testwerkzeug direkt am MIDI-Port „KATANA3“. Die Zeiten gelten für den PC; am Handy werden
sie in 0a nachgemessen.

| Frage | Ergebnis |
|---|---|
| Geht Lesen ohne Editor-Modus? | **Ja.** Identity, Patch-Name, Patchnummer und Editor-Level (`1`) kommen ohne vorheriges Einschalten. |
| Antwortzeit einer kleinen Anfrage | rund **3–5 ms**. |
| Ein RQ1 über mehrere Blöcke? | **Ja.** Der Amp antwortet mit einem DT1 pro Block und überspringt die Lücken. |
| Ganzer Patch mit **einem** RQ1 (`20 00 00 00`, Größe `00 02 00 00`) | **80 DT1, 2649 Datenbytes, 0,27 s.** |
| Alle zehn Speicherplätze mit **einem** RQ1 (`20 10 00 00`, Größe `01 20 00 00`) | **800 DT1, 26 490 Datenbytes, 2,7 s.** |
| SYSTEM mit einem RQ1 (`10 00 00 00`) | 21 DT1, 131 Datenbytes, 23 ms. |
| Längste Nachricht | 238 Bytes. |
| Reihenfolge der DT1 | **nicht streng aufsteigend** (z. B. Contour-Blöcke und zwei SYSTEM-Blöcke vertauscht). |
| Meldet der Amp von sich aus? | **Ja, auch ohne Editor-Modus:** mitten in einer Anfrage kamen unaufgefordert Name, NS-Block und Gain/Volume des aktuellen Patches. Auslöser unbekannt. |
| Zuordnung Index → `PATCH(n+1)` | Patchnummer war `8`, der Name an `21 10 00 00` stimmt mit dem aktuellen Patch überein, und alle 80 Blöcke waren inhaltsgleich. Für Index 8 **bestätigt**; die Namen der übrigen Plätze sind plausibel (`20 10` = „KATANA“ = Panel). |
| Index 9 (`21 20 00 00`) | heißt **„PREVIEW“**: der Vorschau-Platz (passt zu `PREVIEW_MUTE`). `21 30 00 00` antwortet nicht. |

BTS selbst liest blockweise (ein RQ1 pro Block, höchstens 128 Bytes, 15 s Timeout). Das ist die Herkunft der „80 Anfragen“;
nötig ist es nicht.

### 4.3 Protokoll (`src/protocol/`)

- Roland-Nachrichten bauen und zerlegen (Header `F0 41 <dev> 01 05 07`), Prüfsumme.
- **Adressen intern immer linear rechnen.** Unteradressen sind in 7-Bit-Schreibweise (nach `7F` kommt `100`), Basis +
  Offset darf also nicht einfach addiert werden. Umrechnung beim Senden und Empfangen (wie BTS mit `nibble`/`7bitize`).
  Das gilt auch für die **Größe** im RQ1 (der Prototyp schickt sie unumgerechnet, bei über 127 Bytes falsch).
- **Kodierungen** der Werte: `u7` (1 Byte), `u2x4` und `u4x4` (Nibbles, z. B. Patchnummer, Delay-Zeit, Assign-Min/Max),
  `u2x7` (Befehle), `ascii(16)` (Patch-Name, Zeichen 32–125, mit Leerzeichen aufgefüllt).
- **Begrüßung** wie BTS bei Gen 3: Identity Request (Device-ID aus der Antwort übernehmen) → **Modellcode** prüfen
  (Byte 10 der Antwort: `06` = KATANA-100) → RQ1 Editor-Level, erwartet `1` → DT1 Editor-Modus an.
  Weicht Modellcode oder Editor-Level ab, **sperrt die App nicht**, sondern warnt deutlich und läuft **nur lesend**
  weiter; Schreiben lässt sich dann bewusst freischalten. Eine harte Sperre würde nach einem Firmware-Update die Probe kosten. Revision und Running Mode nutzt BTS bei Gen 3 nicht, wir auch nicht.
- Eingehende Roland-Nachrichten werden mit der gelernten Device-ID **und** mit `7F` akzeptiert (wie BTS).
- **Abmelden** (Editor-Modus aus) versucht die App beim bewussten Trennen und beim Wechsel in den Hintergrund nach längerer
  Zeit. Auf Android gibt es aber kein verlässliches „App wird beendet“, und nach dem Abziehen lässt sich nichts mehr senden.
  **„Editor-Modus bleibt an“ ist also der Normalfall.** Was das am Amp bewirkt, wird in „Phase 0 am PC“ mit dem Prototyp
  geprüft (Tab ohne Abmelden schließen, Amp bedienen, neu verbinden) und als Entscheidung in `protocol-notes.md` festgehalten.
- **Befehle:** Patch wählen (`PATCH_SELECT`), speichern (`PATCH_WRITE`, der Amp quittiert per DT1 an derselben Adresse),
  löschen. BTS sendet nach dem Speichern und nach dem Zurückspielen zusätzlich `PREVIEW_MUTE` und `EXPORT`. Deren Wirkung
  klären wir durch eigene Versuche, denn BTS selbst lässt sich nicht mitschneiden (Port exklusiv, USBPcap erfolglos).
- **Patchwechsel am Amp:** Der Amp meldet ihn per DT1 an `00 00 00 00` (Patchnummer, `u2x4`). Speichert man am Amp,
  meldet er `PATCH_WRITE`. (Aus der BTS-Logik abgeleitet, per Mitschnitt bestätigen.)
- **Speicherplätze:** Die Patchnummer läuft 0–9: Index 0 = **Panel** (nicht speicherbar), 1–4 = **A1–A4**, 5–8 = **B1–B4**,
  9 = **Vorschau-Platz „PREVIEW“** (nie beschreiben). Der Speicher eines Index n liegt im Block `PATCH(n+1)`: Panel = `20 10 00 00`, A1 = `20 20 00 00`
  usw. (für Index 8 am Amp bestätigt, siehe 4.2b; die übrigen in 0b durch Kanalwechsel gegenprüfen). Diese Zuordnung steht an **einer**
  Stelle im Code und hat einen eigenen Test, weil ein Versatz um eins Backups auf den falschen Platz schreiben würde.
- **Schreiben auf Speicherplätze wird geprüft:** danach zurücklesen und vergleichen, bei Abweichung klare Meldung.

### 4.4 Modell (`src/model/`)

Unsere eigene Parameterliste, aus der die Oberfläche erzeugt wird. Sie bildet ab, wie der Gen 3 seinen Speicher wirklich
organisiert:

- **Speicherlayout:** Block, Offset, Kodierung (siehe 4.3), Min/Max, Standardwert, **Versatz** (Rohwert = Anzeige + Versatz,
  auch negativ, teils mit Faktor), `readonly` für Bereiche, die man nur lesen darf.
- **Darstellung:** Name, Gruppe, Bedienelement, Einheit, Reihenfolge, „wichtig für Proben-Ansicht“, Umrechnung für die
  Anzeige (Tabellen wie Notenwerte oder Frequenzen).
- **Variationen („Farben“):** Viele Blöcke gibt es im Patch **mehrfach**. Das Schema beschreibt einen Block **einmal als
  Vorlage** mit seinen **Instanzen** (Basisadressen) und einer Regel „aktive Instanz = Funktion eines anderen Parameters“:
  - Der Farb-Block hat **fünf** Einträge (je 0–2): Booster, Mod, FX, Delay, Reverb.
  - Mod und FX bestehen je Instanz aus **zwei** Blöcken: einer mit dem Typ, einer mit den Parametern aller Typen.
  - **Delay 2** hat keine eigene Farbe. Es hängt an der Reverb-Farbe und am `LAYER_MODE` der jeweiligen Reverb-Variation
    (0 = Delay 2, 1 = beides, 2 = Reverb).
  - **Contour** wird über einen eigenen Regler (0–3) gewählt.
  - Die App bearbeitet immer die aktive Instanz.
- **Effekttypen:** Die Parameter **aller** Typen eines Effekts liegen an **eigenen, festen Adressen**. Es braucht keine
  Überlagerung, nur eine Sichtbarkeitsregel („zeigen, wenn Typ = X“).
- **Schwieriger Fall: Assigns/Expression.** Das Ziel ist eine Auswahl je Effekttyp, und Größe und Bereich von Min/Max hängen
  vom Ziel ab. Das muss das Schema können, bevor Phase 3 beginnt (Schema-Probe dort).
- **Versionsbezug:** Die Liste trägt Modell und das Datum der Prüfung am Amp. Eine Firmware-Version kommt dazu, sobald
  klar ist, wo der Amp sie meldet (offen, siehe 8).
- **Prüfung am echten Amp:** Ein Testwerkzeug liest jeden Block und vergleicht mit dem, was BTS am Display zeigt.
- Geschrieben werden **nur Adressen aus dieser Liste**, Werte werden auf Min/Max begrenzt, `readonly` wird nie geschrieben.
- Die Effektkette ist nur ein Parameter (Kettenvariante 0–8) plus einige Positionsschalter. Das ist billig.

### 4.5 State (`src/state/`)

Feste Regeln, damit die App in der Probe nicht hakt:

1. **Der Amp ist die Wahrheit.** Eigene Änderungen werden sofort angezeigt, dann gilt, was der Amp meldet.
2. **Regler ziehen:** Während des Ziehens und **300 ms danach** ignoriert die App eingehende Werte *für diese Adresse*.
   Danach gewinnt der Wert vom Amp. Eine weitere Echo-Erkennung gibt es nicht (BTS hat auch keine).
3. **Patchwechsel** (aus der App oder am Amp gemeldet): Warteschlange leeren, Bedienung kurz sperren, kurz warten
   (BTS: 500 ms), dann neu lesen. Kommt währenddessen ein weiterer Wechsel, wird das Lesen abgebrochen und neu begonnen.
4. **Lesen in einem Zug:** Ein ganzer Patch kommt mit **einer** Bereichsanfrage in rund 0,3 s (am PC gemessen, 4.2b).
   Das zweistufige Lesen entfällt. Nur falls die Messung am Handy in 0a deutlich schlechter ausfällt, kommt es zurück.
5. **Neu lesen**, wenn die App wieder in den Vordergrund kommt, und per Knopf „Neu lesen“. Grund: Regler am Amp ändern
   eventuell Werte, ohne sie zu melden (in Phase 0 per Mitschnitt prüfen).
6. **„Ungespeichert“** = Vergleich des aktuellen Patches mit dem **gespeicherten Platz** des Kanals (`PATCH(n+1)`, nach
   Patchwechsel und nach jedem Speichern im Hintergrund gelesen). Nicht mit dem zuletzt gelesenen aktuellen Patch, denn der
   kann nach Neu-Lesen oder Wiederverbinden schon verändert sein. Das zusätzliche Lesen kostet nur rund 0,3 s (4.2b).
   Beim Kanalwechsel gibt es **keine** Rückfrage (siehe 2).
7. **Zurück auf gespeicherten Stand** (ab 1b, auch per Doppeltipp auf einen Regler): nimmt die Werte aus dem gespeicherten Platz.
   Jedes Zurücksetzen zeigt kurz „Rückgängig“, damit ein versehentlicher Doppeltipp nichts kostet.
   Ein vollständiges Undo/Redo kommt erst in Phase 5.
   **Gemerkte Änderungen** (siehe 2): Beim Verlassen eines Kanals hält die App die Abweichungen vom gespeicherten Stand
   fest (nur im Arbeitsspeicher, pro Kanal, bis zum Speichern, Verwerfen oder App-Ende). „Zurückholen“ schreibt sie
   nach Antippen in den aktuellen Patch, nie von selbst.
8. **Nach Neustart oder Absturz schreibt die App nie** etwas von sich aus. Sie begrüßt den Amp neu und liest.
9. **Verbindungsabbruch** ist ein normaler Zustand (Kabel wackelt): Regler einfrieren, Status zeigen, nach dem
   Wiederverbinden neu lesen, nichts schreiben.
10. **Speichern** auf einen Amp-Speicherplatz nur nach ausdrücklicher Bestätigung.

### 4.6 Storage (`src/storage/`)

- **Eigenes Patch-/Backup-Dateiformat** (JSON), festgelegt in Phase 1a:
  - Formatversion, Datum, App-Version, Modellcode (Firmware, sobald ermittelbar)
  - Inhalt als **Rohbytes pro Speicherblock**, mit denselben Blockgrenzen wie das Gerät, eigenen stabilen Blockschlüsseln
    und Name als Klartext, dazu ein Feld `memo`
  - Rohbytes bleiben gültig, auch wenn sich unsere Parameterliste ändert. Später sind sie direkt in `.tsl` umwandelbar
    (das ist ebenfalls Rohbytes pro Block).
- **Komplett-Backup** = SYSTEM + Speicherplätze A1–B4 + Panel + aktueller (ggf. ungespeicherter) Patch. Mit
  Bereichsanfragen sind das **drei Anfragen und rund 3 s** (am PC gemessen, 4.2b), nicht 800 Anfragen. Ein Kabelzug bricht sauber ab (keine halbe Datei).
  Der Vorschau-Platz (Index 9) gehört nicht ins Backup.
  Readonly-Blöcke werden mitgesichert, aber nie zurückgeschrieben.
- Für Backups reicht eine **Blocktabelle** (Adresse, Größe). Die vollständige Parameterliste ist dafür nicht nötig.
- Dateien werden über das Android-Teilen-Menü exportiert (z. B. nach Google Drive) und importiert.
- **`.tsl` früh prüfen (1a):** Lässt sich ein Patch mit wenig Aufwand als Gen-3-`.tsl` schreiben, kommt der Export schon
  in 1a. Dann kann BTS am PC unser Backup einspielen: ein erprobter Rückweg lange vor Phase 4 und zugleich die beste
  Prüfung der Blockzuordnung.
- Die Bibliothek (Phase 4) legt **Dateien in einem sichtbaren Ordner** ab (Dokumente) statt in einer App-Datenbank:
  Sie überleben eine Deinstallation und brauchen keine Migrationen. Ein Index für die Suche darf in der App liegen,
  weil er sich aus den Dateien neu aufbauen lässt.

### 4.7 Mock-Amp und Mitschnitt (`src/mock/`)

- Simulierter Katana: hat den Speicher, antwortet auf RQ1, nimmt DT1 an, meldet Patchwechsel. Für Entwicklung und Tests ohne Amp.
- **Mitschnitt-Modus:** protokolliert echte Sitzungen (jede Nachricht mit Zeitstempel und Richtung) und exportiert sie als
  Datei. Diagnosewerkzeug für Probleme in der Probe und zum Klären offener Protokollfragen.
- Mitschnitte unter `captures/` bleiben privat. Bereinigte Auszüge können als Testdaten nach `tests/fixtures/`.
- **Tests gegen echte Mitschnitte von Anfang an (0b):** Der Mock bildet nur unsere Annahmen ab und würde eigene Irrtümer
  bestätigen. Abläufe wie Patchwechsel mitten im Lesen, unaufgeforderte Meldungen und vertauschte Blöcke (4.2b) werden
  deshalb aus aufgezeichneten Sitzungen nachgespielt.

### 4.8 Ordnerstruktur

```
katana-studio/
  src/
    app-info.ts     Name, Untertitel, Version
    midi/           Transport-Schnittstelle, Warteschlange, USB-MIDI-Pakete
    protocol/       SysEx, Adressen/Kodierung, Begrüßung, Befehle
    model/          Parameterliste (Layout + Darstellung)
    state/          Spiegel des Amps, Abläufe
    storage/        Patch-/Backup-Format, Export/Import
    mock/           Mock-Amp, Mitschnitt
    ui/             Svelte-Oberfläche
  android/          von Capacitor erzeugtes Android-Projekt mit dem USB-Plugin (Kotlin)
  tests/            Unit-Tests, fixtures/
  testpages/        Machbarkeitstests (WebUSB), per GitHub Pages erreichbar
  prototype/        katana-test.html, serve.js (Referenz)
  docs/             PLAN.md, HANDOFF.md, protocol-notes.md, testplan/
  tools/            nur lokal (extract-bts.js, in .gitignore)
```

## 5. Roadmap

Ab Phase 1 endet jede Phase mit einer Version, die in der Probe benutzbar ist, und mit einer abgehakten Checkliste am
echten Amp (`docs/testplan/`).

### Phase 0 am PC – Protokollfragen *(sofort, braucht kein Handy, läuft neben 0a)*
Mit dem Prototyp oder einem kleinen Testwerkzeug am Port „KATANA3“ mitschneiden und in `docs/protocol-notes.md` festhalten:
Patchwechsel-Meldung, Speichern am Amp, Regler am Amp, Auslöser der unaufgeforderten Meldungen, `EXPORT`/`PREVIEW_MUTE`,
Zuordnung Index → `PATCH(n+1)` für alle Kanäle, Ort der Firmware-Version, Verhalten bei eingeschaltetem Editor-Modus.
Die Antworten bestimmen die Regeln in 4.5; deshalb stehen sie vor dem Bau der State-Schicht fest, nicht danach.

**Vor der ersten Schreibfunktion überhaupt:** ein Komplett-Backup mit **BTS am PC**. Das ist das Sicherheitsnetz mit
erprobtem Rückweg, solange unser eigenes Zurückspielen noch nicht existiert.

### Phase 0a – USB-Nachweis am Handy *(entscheidet über alles)*
Vorher: erster Commit, öffentliches Repo, GitHub Pages für `testpages/`.

0. **Fünf-Minuten-Versuch:** Amp ans Handy, `katana-test.html` (Web MIDI) im Handy-Chrome öffnen. Erscheint wider
   Erwarten ein MIDI-Port, entfällt das USB-Plugin (siehe 4.2a).
1. **WebUSB-Testseite** im Handy-Chrome (scheitert voraussichtlich am belegten Interface, liefert aber die Deskriptoren): Gerät auswählen, **alle Deskriptoren roh anzeigen** (Interfaces, Altsettings,
   Endpunkt-Typ, Paketgröße), Interface übernehmen, Identity Request als USB-MIDI-Paket senden, Antwort zeigen.
   Alles auf dem Bildschirm protokollieren, mit Knopf „Log kopieren“.
2. Scheitert das (z. B. weil der Kernel das Interface belegt): **Test-APK** mit demselben Ablauf über die USB Host API und
   `force`. Dafür entsteht schon hier ein **minimales Capacitor-Gerüst mit CI-Build** (Debug-Schlüssel). Die Test-APK hat
   eine **eigene App-ID** (`…katanastudio.usbtest`), damit sie sich später nicht mit der echten App beißt, und einen
   Log-Bildschirm (Fehlersuche ohne Android Studio).
3. Klappt auch das nicht: anhalten und neu entscheiden.

Dazu:
- Am Handy prüfen: OTG-Einstellung (bleibt die Verbindung über 15 Minuten?), Akkuverbrauch, Brummen durch das Kabel,
  und ob das Handy Benachrichtigungstöne über den Amp ausgibt.
- **Ab in die Probe:** Die Testseite bzw. Test-APK bekommt drei grobe Regler (NS-Threshold, Gain, Volume) und geht
  so in die nächsten Proben. Sie löst schon den Auslöser des Projekts (Noise Gate) und zeigt, was in der Probe wirklich
  gebraucht wird, bevor 0b und Phase 1 gebaut sind. Die Reihenfolge in 1b wird danach noch einmal angesehen.

**Fertig, wenn:** das Handy die Identitätsantwort `F0 7E 10 06 02 41 07 05 …` empfängt, den Patch-Namen liest und per DT1
den NS-Threshold hörbar ändert. Interface, Altsetting, Endpunkte, Kabelnummer im USB-MIDI-Paket und Paketformat stehen in
`docs/protocol-notes.md`.

### Phase 0b – Fundament *(erst nach positivem 0a)*
- Vite + Svelte + TypeScript + ESLint + Capacitor, CI baut eine signierte APK. Signierschlüssel vorher doppelt sichern.
- Protokoll-Schicht neu mit Tests (Adressrechnung, Kodierungen, Prüfsumme, Pakete, Warteschlange), Mock-Amp-Grundgerüst, Mitschnitt-Modus.
- Android-USB-Plugin mit allen Pflichten aus 4.2, automatischer Start beim Einstecken.
  Schnittstelle: Methoden `open()`, `close()`, `send(bytes: number[])`, Ereignisse `data` (Bytes als Zahlen-Array),
  `attached`, `detached`, `error`. `minSdk 29`, `targetSdk` = aktuelle Android-Version. Log-Bildschirm in der App bleibt.
- Die Protokollfragen sind zu diesem Zeitpunkt schon am PC geklärt (siehe „Phase 0 am PC“).

**Fertig, wenn:** die signierte APK beim Einstecken von selbst startet, „Verbunden, KATANA-100“ zeigt und einen Parameter
lesen und schreiben kann. Die offenen Protokollfragen sind in `protocol-notes.md` beantwortet.

### Phase 1 – Proben-App

**Bedienkonzept** (gilt ab hier): Hochformat, Bedienung mit einer Hand. **Keine Drehregler**, sondern große waagerechte
Schieber mit Knöpfen für ±1/±5. Doppeltipp setzt auf den gespeicherten Wert zurück. Ein Regler springt beim Antippen **nicht**
auf die Tippstelle, er ändert sich nur durch Ziehen (Schutz vor Lautstärkesprüngen). Dunkles Design, Bildschirm bleibt an,
solange die App im Vordergrund und mit dem Amp verbunden ist. Sperrknopf gegen versehentliches Berühren.

**1a – Nur lesen** *(kann am Amp nichts verstellen)*
- Verbinden mit Statusanzeige, automatische Neuverbindung, Modellanzeige.
- Aktuellen Patch lesen und anzeigen (Name, Amp, Effekte mit aktiver Variation), Kanalwechsel am Amp folgen.
- **Komplett-Backup in eine Datei** (rein lesend, Umfang siehe 4.6) und Patch-Dateiformat.

*Fertig, wenn:* die App nach 10-mal Ab- und Anstecken jedes Mal neu verbindet, ein Kanalwechsel am Amp in unter 2 s
erscheint und die Rohbytes zweier Backups hintereinander gleich sind.

**1b – Live einstellen**
- Kanäle A1–B4 wählen (Panel nur anzeigen).
- **Amp:** Typ, Gain, Volume, Bass, Middle, Treble, Presence (soweit vorhanden).
- **Effekte:** Booster, Mod, FX, Delay, Reverb: an/aus, **Variation wählen**, Typ.
  Regler für **Booster, Delay und Reverb** (kleine Blöcke, unabhängig vom Typ). Mod und FX haben über 30 Typen mit rund
  210 eigenen Parametern; ihre Regler kommen in Phase 2. Delay 2 und Layer-Mode ebenfalls Phase 2.
- **Noise Suppressor:** an/aus, Threshold, Release.
- **Proben-Ansicht** mit den wichtigsten Reglern, „Zurück auf gespeicherten Stand“.

*Fertig, wenn:* eine Probe von 2 Stunden ohne Hänger läuft, eine Regleränderung sofort hörbar ist, ein Kanalwechsel
wartende Werte verwirft und ein Kabelzug zum Einfrieren und Neu-Lesen ohne Schreiben führt.

**1c – Speichern**
- **Speichern** auf den aktuellen Kanal: mit Bestätigung, Quittung abwarten, zurücklesen, vergleichen.
- **Einen Patch aus einem Backup zurückspielen**, damit das Backup ein echtes Sicherheitsnetz ist. Weg: Ziel-Kanal wählen,
  Backup-Daten in den aktuellen Patch schreiben, dann `PATCH_WRITE` mit Bestätigung, also derselbe Weg wie Speichern.
  Das direkte Schreiben in Speicherplätze (wie BTS mit `EXPORT`) gehört zu Phase 4.
- Vor dem ersten Speichern einer Sitzung bietet die App ein Backup an, wenn keines von heute existiert.

*Fertig, wenn:* Speichern nur nach Bestätigung möglich ist, das Zurückgelesene identisch ist, ein simulierter Fehler eine
Meldung zeigt und ein Patch aus dem Backup zurückgespielt werden kann.

### Phase 2 – Alle Klangparameter
- Alle Effekttypen mit allen Parametern, alle Variationen.
- Contour, Pedal FX, Solo, Send/Return, EQ (parametrisch und 10-Band), Effektkette.

### Phase 3 – Steuerung und System
- Schema-Probe für Assigns zuerst (siehe 4.4).
- Assigns, Expression-Pedal, Fußschalter (GA-FC), System- und USB-Einstellungen.
- Tuner nur, falls ein Mitschnitt zeigt, dass der Amp Tuner-Daten liefert (in BTS gibt es dafür keinen Hinweis).

### Phase 4 – Bibliothek und Austausch
- Patch-Bibliothek auf dem Gerät (Dateien in einem sichtbaren Ordner, siehe 4.6), Ordner/Suche.
- **Komplett-Wiederherstellen** aus einem Backup (automatisches Backup davor, Zurücklesen danach).
- **.tsl-Import/-Export** für Gen-3-Dateien (Tone Exchange). Dateien vom Katana MkII bleiben außen vor.

### Phase 5 – Eigene Extras
- Undo/Redo-Verlauf, A/B-Vergleich.
- Favoriten-Regler / Schnellzugriff pro Song, Setlisten.
- Weitere Ideen sammeln wir unterwegs.

### Später / optional
- Vorschau-Version als zweite App neben der stabilen (eigene App-ID, ohne Auto-Start).
- Update-Hinweis in der App, PC-Version (über Web MIDI), iOS (braucht Mac).

## 6. Qualität, Tests und Veröffentlichung

**Tests:** Unit-Tests (Vitest) für alles unterhalb der Oberfläche, besonders Adressrechnung, Kodierungen, Pakete, Warteschlange,
State-Regeln und Dateiformat. Pro Phase eine kurze **Checkliste am echten Amp mit dem Handy** in `docs/testplan/`.
Ende-zu-Ende-Tests der Oberfläche kommen später.

**CI (GitHub Actions):** bei jedem Push Typprüfung, ESLint, Tests und Build. Eine APK entsteht nur, wenn alles grün ist.

**Veröffentlichung:** Nur per **Versions-Tag** (z. B. `v0.3.0`) entsteht ein GitHub Release mit APK. Das ist die Version für
die Probe. `versionCode` wird automatisch hochgezählt, sonst lehnt Android das Update ab. Die App zeigt ihre Version in den
Einstellungen und im Protokoll-Export. Neue Versionen lädst du von der Release-Seite und installierst sie selbst.

**Signierschlüssel:** Jede APK wird damit signiert. Er liegt als verschlüsseltes Geheimnis in GitHub und **zusätzlich bei dir**
(Passwort-Manager oder USB-Stick). Geht er verloren, gehen Updates nur noch per Deinstallieren, und dabei verschwinden die
App-Daten. Deshalb wird er gesichert, bevor die erste signierte APK aufs Handy kommt.

## 7. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Der Katana spricht am Handy nicht mit uns | Phase 0a zuerst, mit WebUSB und notfalls Test-APK, bevor etwas anderes gebaut wird. |
| Handy-Akku reicht nicht für die Probe (lädt nicht, solange der Amp dranhängt) | In 0a messen. Falls nötig: USB-C-Hub mit Durchladen testen (klappt nicht mit jedem Handy), dunkles Design, Bildschirm-an nur bei verbundener App im Vordergrund. |
| OTG schaltet sich ab, Kabel wackelt | In 0a prüfen. Kurzes USB-C-Datenkabel, am besten mit Winkelstecker. Die App verbindet automatisch neu (4.5/9). |
| Falsche Adresse schreibt Unsinn in den Amp | Nur bekannte Adressen, Werte begrenzen, `readonly` nie schreiben, BTS-Backup am PC vor der ersten Schreibfunktion, Zurücklesen nach dem Speichern. |
| Signierschlüssel geht verloren | Doppelt sichern (siehe 6). |
| Google verlangt ab 2027 auch beim Sideloading einen verifizierten Entwickler | Vor 2027 prüfen, ob sich der Schlüssel mit dem kostenlosen Hobby-Konto registrieren lässt. Installation per ADB bleibt als Ausweg. |
| Datenverlust in der App | Datei-Export von Anfang an, Rohbyte-Format mit Versionsnummer. |
| Fehlerhaftes Update kurz vor der Probe | Releases nur per Versions-Tag, Installation nur von Hand. |
| Firmware-Update ändert das Protokoll | Modellcode und Editor-Level prüfen (bei Abweichung nur lesend, siehe 4.3). In „Phase 0 am PC“ klären, wo der Amp seine Firmware-Version meldet, und dann beim Verbinden mit der Version der Parameterliste vergleichen. |
| Markenbeschwerde wegen öffentlichem Repo | Kein „BOSS“ im Titel, Hinweis „inoffiziell“, keine Logos, kein Auspack-Werkzeug im Repo. Bei Beschwerde umbenennen. |

## 8. Offen, wird in Phase 0 geklärt

- USB: Interface, Altsetting, Endpunkte, Paketformat (0a).
- Akku, OTG, Kabel am Nothing Phone (3a) Pro (0a).
- Am PC mit dem Prototyp (Phase 0 am PC): Verhalten, wenn der Editor-Modus an bleibt.
- Per eigenem Mitschnitt (Phase 0 am PC): Meldungen bei Patchwechsel, Speichern und Reglern am Amp; Wirkung von `EXPORT` und
  `PREVIEW_MUTE`; Zuordnung Index → `PATCH(n+1)` für die übrigen Kanäle; wo die Firmware-Version steht; Tuner-Daten;
  was die unaufgeforderten Meldungen des Amps auslöst (4.2b).
- Am Handy nachmessen (0a): Dauer einer Bereichsanfrage über den ganzen Patch.
- **Schon geklärt (4.2b):** Bereichsanfragen, Lesezeiten, Lesen ohne Editor-Modus, Index 9 = Vorschau-Platz.
