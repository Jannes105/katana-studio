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
| Sprache | **Englisch:** Code, Bezeichner, Kommentare, Commit-Nachrichten, README und `docs/protocol-notes.md` (so ist es üblich). **Deutsch:** nur `PLAN.md` und `HANDOFF.md` als Arbeitsdokumente. **Oberfläche der App:** Englisch als Grundsprache, Deutsch als zweite Sprache; die App folgt der Handy-Sprache und lässt sich in den Einstellungen umschalten. Parameternamen bleiben in beiden Sprachen **englisch wie am Amp** (Gain, Bass, Threshold …). Die Texte liegen gesammelt an einer Stelle, je Sprache eine Tabelle, von Anfang an. |
| Arbeitsweise im Repo | **Branch und Pull Request**, kein direktes Arbeiten auf `main`. `main` ist geschützt: Die CI muss grün sein, kein Force-Push, Squash-Merge, gemergt wird von dir. (Entscheidung 16.11.2026) |
| Test-App | `usbtest/` wird **gelöscht**, sobald die echte App den USB-Teil übernommen hat und in der Probe funktioniert. Bis dahin bleibt sie für Probe und Fehlersuche. Das Kotlin-Plugin wandert in die echte App. (Entscheidung 16.11.2026) |
| Versionen | **Capacitor 8, `minSdk 29`, `targetSdk 36`, Kotlin 2.2.20, JDK 21.** Alles Weitere (Gradle, Android-Gradle-Plugin, Node) wird nicht eigens festgeschrieben. (Entscheidung 16.11.2026) |
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
│ Transport      Android-USB │ Web MIDI │ Mock           │
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
- ~~WebUSB~~: entfällt. Im Handy-Chrome scheitert `claimInterface` am vom Kernel belegten Interface (gemessen in 0a,
  siehe 4.2a). Die Testseite `testpages/usb/` bleibt nur als Deskriptor-Anzeige.

**Gemessene USB-Werte** (Phase 0a, Nothing Phone (3a) Pro, Einzelheiten in `protocol-notes.md` Abschnitt 3):
**Interface 3** (Klasse `FF/03/00`, Roland-Deskriptor `06 24 F1 02 …`), **Altsetting 0**, **Bulk OUT `0x03`** und
**Bulk IN `0x84`** (je 512 Bytes), **Kabelnummer 0**, normale 4-Byte-USB-MIDI-Pakete (CIN 4–7 für SysEx). Ein
Lesevorgang liefert oft mehrere Pakete; unbenutzte Bytes im letzten Paket sind **nicht** genullt (die CIN gibt die Länge).

**Pflichten des Plugins** (Android-Fallstricke, alle umzusetzen):
- Nur das **MIDI-Interface** (3) übernehmen, Audio-Interfaces (1, 2) nicht anfassen. `claimInterface(…, force = true)`
  ist **nötig**, der Kernel belegt das Interface. Altsetting 0 per `setInterface` wählen. Die Auswahlregel der
  Test-APK (Herstellerklasse, Bulk- oder Interrupt-Endpunkt IN und OUT, kein isochroner Endpunkt) traf richtig und
  wird übernommen; die Werte oben dienen als Prüfung, nicht als feste Zahlen.
- Endpunkte können **Bulk oder Interrupt** sein; beides unterstützen (Altsetting 1 bietet Interrupt, ungenutzt).
- Empfangen in einem eigenen Lese-Thread (`UsbRequest.queue` oder `bulkTransfer` mit Timeout).
- Berechtigung: Geräte-Filter `VID 0x0582 / PID 0x02F0` für `USB_DEVICE_ATTACHED` im Manifest, dann fragt Android nur
  einmal („Immer mit dieser App öffnen“). Für `requestPermission` einen expliziten, veränderbaren PendingIntent
  (`FLAG_MUTABLE`, `setPackage`) verwenden.
- `USB_DEVICE_DETACHED` zur Laufzeit registrieren (`RECEIVER_NOT_EXPORTED`).
- `launchMode="singleTask"`, Einstecken bei laufender App über `onNewIntent`.

**Sende-Warteschlange** (`src/protocol/queue.ts`; liegt im Protokoll, weil sie Antworten über Adressen und
Blocktabelle zuordnet, und `midi/` nichts aus `protocol/` laden darf. Regeln am 16.11.2026 festgelegt):
- **Kein fester Abstand für kleine Nachrichten** (gemessen, `protocol-notes.md` 2.13): Der Amp nahm 20 DT1 ohne Pause
  an und beantwortete 30 RQ1 hintereinander vollständig. Die 20 ms von BTS entfallen. Für **große DT1** (ganze Blöcke,
  Zurückspielen in 1c) bleibt vorerst der BTS-Abstand (20 ms plus Länge ÷ 3,125 ms), bis das gemessen ist. Am Handy
  wird der Test einmal mit der Test-APK wiederholt. „Groß“ heißt: **mehr als 16 Datenbytes** (der Patch-Name
  mit 16 Bytes läuft also ohne Abstand).
- Zum Transport ist immer nur **ein Sendevorgang** unterwegs; was solange wartet, wird bei Bedarf ersetzt (siehe unten).
- Der Amp quittiert einen geschriebenen Wert **nicht** und meldet ihn auch nicht zurück (kein Echo). Geprüft wird
  nur durch Zurücklesen. Eine Antwort zeigt den Stand zum Zeitpunkt der Antwort, nicht der Anfrage.
- Wird ein Regler gezogen, ersetzt der neueste Wert den noch nicht gesendeten Wert derselben Adresse (nur bei
  gleicher Länge; ein Einzelwert und ein ganzer Block werden nie zusammengelegt).
- Lässt sich **gezielt leeren** (bei Patchwechsel, siehe 4.5): Wartendes wird verworfen, die offene Anfrage
  abgebrochen; deren späte Antworten kommen dann als normale Meldungen an.
- **Jede** angenommene eingehende Nachricht geht an die State-Schicht, Antworten wie Meldungen. Falsche Prüfsumme
  oder fremde Device-ID: verworfen und protokolliert, zählt auch nicht als Antwort.
- **Sicherheitsnetz:** Die Warteschlange verweigert jeden DT1 in die Speicherplätze (`20 10 00 00` bis
  `21 2F 7F 7F`, Vorschau-Platz eingeschlossen) und `PATCH_WRITE` ohne ausdrückliches Kennzeichen, zusätzlich zur
  Prüfung im Modell. Freigabe für die Speicherplätze erst in Phase 4.
- Leseanfragen gehen in der Reihenfolge raus, in der sie gestellt wurden (keine Prioritäten, bis Phase 1 sie verlangt).
- **Immer nur ein RQ1 offen.** Die Antwort besteht bei Bereichsanfragen aus vielen DT1 (ein DT1 pro Block, siehe 4.2b).
  Antworten werden **nach Adresse zugeordnet, nicht nach Reihenfolge**: In allen späteren Läufen kamen die Blöcke
  aufsteigend, aber mit Editor-Modus an schiebt der Amp seine Meldungen (Regler, Kanalwechsel) jederzeit dazwischen.
  Ein Ende-Zeichen gibt es nicht; fertig ist die Anfrage, wenn alle erwarteten Blockadressen da sind. Das ist jetzt
  umsetzbar: Die **Blocktabelle** (80 Blöcke je Patch, 21 für SYSTEM) steht in `protocol-notes.md` 2.12 und kommt als
  feste Tabelle in den Code. Eine Einzelabfrage (kein Blockanfang, z. B. Befehlsbereich) ist mit dem ersten DT1
  an genau ihrer Adresse fertig. **Timeout = kein Fortschritt:** 500 ms ohne passende Nachricht (gezählt ab der
  letzten), dann eine Wiederholung der ganzen Anfrage (schon empfangene Blöcke bleiben), dann Fehler an die
  State-Schicht. Ein fester Timeout müsste für „alle Plätze lesen“ über 3 s lang sein und würde kleine Anfragen
  unnötig lange hängen lassen.
- Eine Meldung des Amps, deren Adresse im Bereich der offenen Anfrage liegt, ist von einer Antwort nicht zu
  unterscheiden. Das ist unschädlich, solange der neueste Wert gewinnt (der Amp meldet ja den aktuellen Stand).
- **Schreiben geht vor Lesen:** Ein Reglerwert (DT1) wartet nie hinter einer laufenden Hintergrund-Leseanfrage.

### 4.2a Befund USB (15.11.2026)

**Ergebnis von Phase 0a:** Die Vermutungen unten haben sich bestätigt. WebUSB scheitert am belegten Interface, die
Test-APK mit `force` klappt, das Paketformat ist das übliche USB-MIDI-Format. Die Werte stehen in 4.2. Der Rest
dieses Abschnitts ist die Begründung von damals.

- Der Katana meldet sich als **herstellerspezifisches Gerät** (`VID_0582 PID_02F0`, Klasse `FF/FF`), unter Windows
  bedient vom Roland-Treiber `RDID1254`. Er ist **kein** Standard-USB-MIDI-Gerät.
- Der **„Generic“-USB-Modus** (ab Firmware 1.07, beim Einschalten [MOD] halten) kann laut Roland **nur Audio, kein MIDI**.
  Der Amp bleibt im normalen Modus.
- Folge: Android sieht den Amp nicht als MIDI-Gerät. Die App spricht die USB-Schnittstelle selbst an.
- Das **USB-MIDI-Paketformat** ist bei Roland-Geräten dieser Art üblich. Belegt ist das durch den Linux-Treiber
  (`snd-usb-audio`, Roland-Sonderbehandlung inkl. Altsetting-Umschaltung) und Erfahrungen mit dem BOSS GT-1. **Für den Gen 3
  in 0a bestätigt** (Interface 3, Altsetting 0, Bulk).
- **WebUSB im Handy-Chrome** ist gescheitert, wie erwartet: `claimInterface(3)` meldet „Unable to claim interface“,
  der Kernel hält es. Die Test-APK holt es sich mit `force`.
- **Am Quelltext geprüft (15.11.2026):**
  - *Android zeigt den Amp nicht als MIDI-Gerät.* Das Android-Framework legt ein MIDI-Gerät nur an, wenn ein Interface
    die Klasse Audio mit Unterklasse MIDI-Streaming hat (`UsbDescriptorParser.hasMIDIInterface()`). Bei Klasse `FF`
    geschieht das nicht, einen Ausweichweg gibt es dort nicht. Web MIDI im Handy-Chrome fällt damit sehr wahrscheinlich
    aus; der Fünf-Minuten-Versuch mit `katana-test.html` am Handy bleibt trotzdem der erste Schritt in 0a, weil er nichts kostet.
  - *Der Linux-Kernel erkennt Roland-Geräte dieser Art automatisch* (Sammeleintrag für `VID 0582` mit Klasse `FF` in
    `sound/usb/quirks-table.h`, MIDI-Erkennung über den Roland-Deskriptor `06 24 F1 02 …`). Hat der Handy-Kernel diesen
    Treiber, belegt er das Interface. Beim Nothing Phone ist das so (WebUSB scheitert genau daran).

### 4.2b Messungen am Amp (15.11.2026, am PC über den Boss-Treiber, nur gelesen)

Gemessen mit einem kleinen Testwerkzeug direkt am MIDI-Port „KATANA3“. Die Zeiten gelten für den PC; am Handy dauerte
der ganze Patch in 0a 0,284 s, also praktisch gleich.

| Frage | Ergebnis |
|---|---|
| Geht Lesen ohne Editor-Modus? | **Ja.** Identity, Patch-Name, Patchnummer und Editor-Level (`1`) kommen ohne vorheriges Einschalten. |
| Antwortzeit einer kleinen Anfrage | rund **3–5 ms**. |
| Ein RQ1 über mehrere Blöcke? | **Ja.** Der Amp antwortet mit einem DT1 pro Block und überspringt die Lücken. |
| Ganzer Patch mit **einem** RQ1 (`20 00 00 00`, Größe `00 02 00 00`) | **80 DT1, 2649 Datenbytes, 0,27 s.** |
| Alle zehn Speicherplätze mit **einem** RQ1 (`20 10 00 00`, Größe `01 20 00 00`) | **800 DT1, 26 490 Datenbytes, 2,7 s.** |
| SYSTEM mit einem RQ1 (`10 00 00 00`) | 21 DT1, 131 Datenbytes, 23 ms. |
| Längste Nachricht | 238 Bytes. |
| Reihenfolge der DT1 | Im ersten Lauf einmal vertauscht (Contour-Blöcke, zwei SYSTEM-Blöcke), in **allen späteren Läufen aufsteigend** (PC und Handy). Zugeordnet wird trotzdem nach Adresse. |
| Meldet der Amp von sich aus? | **Nur mit Editor-Modus an.** Die „unaufgeforderten Meldungen“ des ersten Laufs (Name, NS-Block, Gain/Volume) waren Meldungen des Editor-Modus, der von einer früheren Sitzung noch an war. Mit Editor-Modus aus meldet der Amp gar nichts (siehe 4.3). |
| Zuordnung Index → `PATCH(n+1)` | Für **Panel und A1–B4 bestätigt** (je 80 von 80 Blöcken gleich). |
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
  (Byte 10 der Antwort: `06` = KATANA-100) → RQ1 Editor-Level, erwartet `1` → DT1 Editor-Modus an (`7F 00 00 01` = `01`).
- **Editor-Modus an ist Pflicht**, nicht nur BTS-Nachbau (gemessen, `protocol-notes.md` Q8): Ohne ihn meldet der Amp
  **nichts**, weder Kanalwechsel noch Regler noch Speichern. Lesen und `PATCH_SELECT` gehen auch ohne. Das Umschalten
  wird **nicht quittiert**, der Zustand ist aber **zurücklesbar** (RQ1 `7F 00 00 01`, Größe 1). Die App schaltet ihn
  beim Verbinden ein und prüft ihn durch Zurücklesen, auch nach jedem Wiederverbinden.
- Der **Befehlsbereich** `7F 00 00 0x` antwortet nur auf **Einzelabfragen** (Größe 1); eine Bereichsanfrage darüber
  bleibt unbeantwortet.
  Weicht Modellcode oder Editor-Level ab, **sperrt die App nicht**, sondern warnt deutlich und läuft **nur lesend**
  weiter; Schreiben lässt sich dann bewusst freischalten. Den Editor-Modus schaltet sie bei abweichendem
  Editor-Level trotzdem ein (wahrscheinlichster Grund: Firmware-Update am selben Amp; ohne Editor-Modus wäre die
  App blind für Änderungen am Amp). Bei **fremdem Modell oder Hersteller** schreibt sie gar nichts, auch nicht den
  Editor-Modus, weil unklar ist, was der Befehl dort bewirkt. Lesen geht auch ohne. (Entscheidung 16.11.2026) Eine harte Sperre würde nach einem Firmware-Update die Probe kosten. Revision und Running Mode nutzt BTS bei Gen 3 nicht, wir auch nicht.
- Eingehende Roland-Nachrichten werden mit der gelernten Device-ID **und** mit `7F` akzeptiert (wie BTS).
- **Abmelden** (Editor-Modus aus) versucht die App beim bewussten Trennen und beim Wechsel in den Hintergrund nach längerer
  Zeit. Auf Android gibt es aber kein verlässliches „App wird beendet“, und nach dem Abziehen lässt sich nichts mehr senden.
  **„Editor-Modus bleibt an“ ist also der Normalfall.** Gemessen: Das ist unschädlich, der Amp lief so lange normal.
  Abmelden bleibt deshalb ein Versuch ohne Gewähr.
- **Befehle:** Patch wählen (`PATCH_SELECT`), speichern (`PATCH_WRITE`, der Amp quittiert per DT1 an derselben Adresse),
  löschen. BTS sendet nach dem Speichern und nach dem Zurückspielen zusätzlich `PREVIEW_MUTE` und `EXPORT`. Deren Wirkung
  klären wir durch eigene Versuche, denn BTS selbst lässt sich nicht mitschneiden (Port exklusiv, USBPcap erfolglos).
- **Meldungen des Amps** (mit Editor-Modus an, gemessen, `protocol-notes.md` Q1–Q3):
  - *Kanalwechsel am Amp:* fünf Status-Bytes `7F 01 01 01`–`05`, dann `01`–`04` noch einmal, dann DT1 `00 00 00 00`
    mit der neuen Patchnummer (`00 0n`), alles in rund 100 ms. Der Patch-Inhalt kommt **nicht** mit, die App liest ihn.
    Beim Panel kommt zusätzlich `30 00 02 00` (Stellung der fünf Effekt-Regler).
  - *`PATCH_SELECT` aus der App:* zuerst ein Echo an `7F 00 01 00`, dann Patchnummer, Status-Bytes und die Patchnummer
    noch einmal (12 Nachrichten in rund 150 ms).
  - *Speichern am Amp:* DT1 `7F 00 01 04` mit dem Index als zwei Nibbles (`00 08` für B4), danach die Status-Bytes;
    keine Patchnummer.
  - *Regler am Amp:* ein DT1 pro Wert, etwa alle 50 ms während des Drehens, an der Adresse des Parameters.
  - Die Status-Bytes `7F 01 01 01`–`05` sind die Farbe von Booster, Mod, FX, Delay und Reverb (0–2), `3` = aus
    (gemessen). Sie kommen auch, wenn am Amp ein Effekt-Taster die Farbe wechselt.
  - Nach dem **Aus- und Einschalten** des Amps ist der Editor-Modus wieder aus (gemessen).
  - **Signal für „Patch gewechselt“ ist der DT1 an `00 00 00 00`**, egal woher der Wechsel kam.
- **Speicherplätze:** Die Patchnummer läuft 0–9: Index 0 = **Panel** (nicht speicherbar), 1–4 = **A1–A4**, 5–8 = **B1–B4**,
  9 = **Vorschau-Platz „PREVIEW“** (nie beschreiben). Der Speicher eines Index n liegt im Block `PATCH(n+1)`: Panel = `20 10 00 00`, A1 = `20 20 00 00`
  usw. (für Panel und A1–B4 am Amp bestätigt, siehe 4.2b). Diese Zuordnung steht an **einer**
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
  - Der Farb-Block (`04 00`, gemessen) hat **fünf** Einträge (je 0–2): Booster, Mod, FX, Delay, Reverb. Die
    An/Aus-Schalter liegen im Block `08 00` (6 Bytes: Booster, Mod, FX, Delay, vermutlich Delay 2, Reverb).
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
- **Umgesetzt (1a, Scheibe 1, 16.11.2026):** Schema in `src/model/schema.ts` (`ParamDef` mit Offset, Kodierung,
  Min/Max, Darstellung, Bedienelement, `readonly`, `rehearsal` und Status C/D; `VariantGroup` für die fünf Effekte
  mit drei Instanzen, Farbe und Schalter). Parameterliste für 1a in `src/model/params.ts`: Name, Amp mit Typ und
  Variation, Resonance, Farben, Schalter, Typ jeder Variation, Noise Suppressor (seit Scheibe 5 auch Contour,
Endstufen-Variation und die Typnamen). Das Modell rechnet nur aus
  **Rohbytes pro Block** (`PatchImage` in `src/model/patch.ts`), jeder Block hat einen stabilen Schlüssel (Offset als
  drei Hex-Stellen, z. B. `000600`). Typ-Lagen sind aus den Speicherplätzen der Mitschnitte abgeleitet
  (`protocol-notes.md` 2.8, Status D). Effekttypen zeigen „Type n“ und bleiben schreibgeschützt, bis unsere eigene
  Namenstabelle existiert.

### 4.5 State (`src/state/`)

Feste Regeln, damit die App in der Probe nicht hakt:

1. **Der Amp ist die Wahrheit.** Eigene Änderungen werden sofort angezeigt, dann gilt, was der Amp meldet.
2. **Regler ziehen:** Während des Ziehens und **300 ms danach** ignoriert die App eingehende Werte *für diese Adresse*.
   Danach gewinnt der Wert vom Amp. Gemessen: Der Amp schickt **kein Echo** auf geschriebene Werte. Die Regel bleibt
   trotzdem, weil sie billig ist und zwei echte Fälle abfängt: die Antwort einer Hintergrund-Leseanfrage, die vor dem
   Schreiben beantwortet wurde, und gleichzeitiges Drehen am Amp. Eine Echo-Erkennung braucht es nicht.
3. **Patchwechsel** (aus der App oder am Amp gemeldet, Signal ist der DT1 an `00 00 00 00`): Warteschlange leeren,
   Bedienung kurz sperren, warten, bis die Meldungen des Amps **100 ms Ruhe** haben (höchstens 300 ms nach dem Signal),
   dann neu lesen. Gemessen: Der ganze Meldungsschwall ist nach rund 150 ms vorbei, und ein Lesen danach stimmte jedes
   Mal mit dem Speicherplatz überein; die 500 ms von BTS sind nicht nötig. Kommt währenddessen ein weiterer Wechsel,
   wird das Lesen abgebrochen und neu begonnen.
4. **Lesen in einem Zug:** Ein ganzer Patch kommt mit **einer** Bereichsanfrage in rund 0,3 s (am PC gemessen, 4.2b).
   Das zweistufige Lesen entfällt. Nur falls die Messung am Handy in 0a deutlich schlechter ausfällt, kommt es zurück.
5. **Neu lesen**, wenn die App wieder in den Vordergrund kommt, und per Knopf „Neu lesen“. Das ist nur noch ein
   **Sicherheitsnetz**: Mit Editor-Modus an meldet der Amp jeden Regler, und im Vergleich vorher/nachher hatte sich
   kein Byte unbemerkt geändert. Es fängt aber verpasste Meldungen ab (App im Hintergrund, Kabel kurz weg) und
   kostet nur 0,3 s.
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

**Umgesetzt (1a, Scheibe 3, 16.11.2026)** in `src/state/connection.ts`: Der State hält den aktuellen Patch und den
gespeicherten Platz des Kanals als Rohbytes pro Block (`PatchImage`). Gelesen wird mit **einer** Bereichsanfrage
(Regel 4), danach der gespeicherte Platz im Hintergrund (Regel 6); „ungespeichert“ ist der Byte-Vergleich beider,
ebenso nach jedem Speichern am Amp (`7F 00 01 04`, Platz wird neu gelesen). Meldungen des Amps werden nach Adresse
eingearbeitet; kommt eine Reglermeldung während des Lesens vor ihrem Block, wird sie verworfen, weil der Block
danach neuer ist. Beim Kanalwechsel merkt sich die App die ungespeicherten Bytes des verlassenen Kanals (Regel 7,
Abschnitt 2), bis zum Speichern dort oder „Verwerfen“; „Zurückholen“ (schreibt) kommt mit 1b. Neu-Lesen nach
Wiederverbinden und bei Rückkehr in den Vordergrund (Regel 5, über das `visibilitychange`-Ereignis des WebView,
kein eigenes Plugin). Schreiben geht allgemein über `setValue(Parameter, Wert)` mit Begrenzung auf Min/Max und
ohne `readonly`-Parameter; die Oberfläche von 1a nutzt es nicht.

### 4.6 Storage (`src/storage/`)

- **Eigenes Patch-/Backup-Dateiformat** (JSON), festgelegt in Phase 1a:
  - Formatversion, Datum, App-Version, Modellcode (Firmware, sobald ermittelbar)
  - Inhalt als **Rohbytes pro Speicherblock**, mit denselben Blockgrenzen wie das Gerät, eigenen stabilen Blockschlüsseln
    und Name als Klartext, dazu ein Feld `memo`
  - Rohbytes bleiben gültig, auch wenn sich unsere Parameterliste ändert. Später sind sie direkt in `.tsl` umwandelbar
    (das ist ebenfalls Rohbytes pro Block).
- **Komplett-Backup** = SYSTEM + Speicherplätze A1–B4 + Panel + aktueller (ggf. ungespeicherter) Patch. Mit
  Bereichsanfragen sind das **drei Anfragen und rund 3 s** (am PC gemessen, 4.2b), nicht 800 Anfragen. Ein Kabelzug bricht sauber ab (keine halbe Datei).
  Der Vorschau-Platz (Index 9) gehört nicht ins Backup. Die Bereichsanfrage über alle Speicherplätze
  (`20 10 00 00`, Größe `01 20 00 00`) liefert ihn aber mit (Blöcke ab `21 20 00 00`); er wird beim Empfang
  herausgefiltert. Alternativ endet die Anfrage vor ihm (Größe `01 10 00 00`, neun Plätze).
  Readonly-Blöcke werden mitgesichert, aber nie zurückgeschrieben.
- Für Backups reicht eine **Blocktabelle** (Adresse, Größe). Die vollständige Parameterliste ist dafür nicht nötig.
- Dateien werden über das Android-Teilen-Menü exportiert (z. B. nach Google Drive) und importiert.
- **`.tsl` früh prüfen (1a):** Lässt sich ein Patch mit wenig Aufwand als Gen-3-`.tsl` schreiben, kommt der Export schon
  in 1a. Dann kann BTS am PC unser Backup einspielen: ein erprobter Rückweg lange vor Phase 4 und zugleich die beste
  Prüfung der Blockzuordnung.
- **Umgesetzt (1a, Scheibe 6, 16.11.2026):** Format in `src/storage/format.ts` (`format: "katana-studio"`,
  `kind` `backup` oder `patch`, `formatVersion` 1, Datum, App-Version, Modellcode, `firmware` null, `memo`).
  Rohbytes je Block als Hex ohne Leerzeichen unter dem stabilen Blockschlüssel (`000600`), Blöcke in
  Geräte-Reihenfolge, sodass zwei Backups desselben Amps denselben Text ergeben (bis auf Zeit und Version).
  Einlesen prüft Kennung, Version, Blockschlüssel, Länge und 7-Bit-Werte. Komplett-Backup in
  `src/state/backup.ts`: SYSTEM, Plätze 0–8 (Anfrage endet vor dem Vorschau-Platz, Größe `01 10 00 00`) und der
  aktuelle Patch, drei Bereichsanfragen; unvollständig, Kabelzug oder Kanalwechsel bricht ab, ohne Datei.
  Export über das Teilen-Menü (`@capacitor/filesystem` schreibt in den Cache, `@capacitor/share` teilt;
  `src/storage/files-android.ts`), im Browser als Download. Zusätzlich „Diesen Patch sichern“ als Patch-Datei aus
  dem Spiegel, ohne Lesen. Knöpfe im Verbindungsfenster. Zurückspielen kommt mit 1c.
- **`.tsl` geprüft (1a, Scheibe 7, 16.11.2026):** billig, deshalb schon in 1a. Eine Gen-3-`.tsl` ist JSON mit je
  Patch „Blockname → Bytes als Hex-Texte“, und die 80 Blocknamen liegen eins zu eins auf unserer Blocktabelle
  (`protocol-notes.md` 2.14). Export „Diesen Patch als .tsl“ und „A1–B4 als .tsl“ (acht Patches aus einem
  Komplett-Backup) in `src/storage/tsl.ts`. BTS hat die Datei am 16.11.2026 importiert (Testplan 1a): ein
  erprobter Rückweg für unsere Backups, lange vor Phase 4.
- Die Bibliothek (Phase 4) legt **Dateien in einem sichtbaren Ordner** ab (Dokumente) statt in einer App-Datenbank:
  Sie überleben eine Deinstallation und brauchen keine Migrationen. Ein Index für die Suche darf in der App liegen,
  weil er sich aus den Dateien neu aufbauen lässt.

### 4.7 Mock-Amp und Mitschnitt (`src/mock/`)

- Simulierter Katana: hat den Speicher, antwortet auf RQ1, nimmt DT1 an, meldet Patchwechsel. Für Entwicklung und Tests ohne Amp.
- **Mitschnitt-Modus:** protokolliert echte Sitzungen (jede Nachricht mit Zeitstempel und Richtung) und exportiert sie als
  Datei. Diagnosewerkzeug für Probleme in der Probe und zum Klären offener Protokollfragen.
- Mitschnitte unter `captures/` bleiben privat. Bereinigte Auszüge können als Testdaten nach `tests/fixtures/`.
- **Umgesetzt (0b, 16.11.2026):** `src/mock/mock-amp.ts` (Mock-Amp hinter der Transport-Schnittstelle, mit
  Verzögerungen wie am Amp und Aktionen „am Amp“: Regler, Kanaltaster, Speichern, Aus/Ein), `capture.ts`
  (Mitschnitt im Dateiformat von `katana-probe.ps1`, damit alle Mitschnitte gleich nachspielbar sind; Obergrenze
  200 000 Ereignisse; `sanitizeCapture` ersetzt Patch-Namen durch neutrale und entfernt die Notizen),
  `replay.ts` (spielt einen Mitschnitt als Transport nach). `tests/local/` prüft Blocktabelle und Warteschlange
  gegen **alle** Mitschnitte in `captures/`, läuft aber nur dort, wo der Ordner liegt (nicht in der CI). Für die
  CI gibt es seit 1a bereinigte Auszüge in `tests/fixtures/` (siehe 9.2 D 20).
- **Tests gegen echte Mitschnitte von Anfang an (0b):** Der Mock bildet nur unsere Annahmen ab und würde eigene Irrtümer
  bestätigen. Abläufe wie Patchwechsel mitten im Lesen, unaufgeforderte Meldungen und vertauschte Blöcke (4.2b) werden
  deshalb aus aufgezeichneten Sitzungen nachgespielt.

### 4.8 Ordnerstruktur

```
katana-studio/
  src/
    app-info.ts     Name, Untertitel, Version
    midi/           Transport-Schnittstelle, USB-MIDI-Pakete
    protocol/       SysEx, Adressen/Kodierung, Blocktabelle, Warteschlange, Begrüßung, Befehle
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

### Phase 0 am PC – Protokollfragen *(erledigt bis auf die Reste in 9.2 B)*
Mit dem Prototyp oder einem kleinen Testwerkzeug am Port „KATANA3“ mitschneiden und in `docs/protocol-notes.md` festhalten:
Patchwechsel-Meldung, Speichern am Amp, Regler am Amp, Auslöser der unaufgeforderten Meldungen, `EXPORT`/`PREVIEW_MUTE`,
Zuordnung Index → `PATCH(n+1)` für alle Kanäle, Ort der Firmware-Version, Verhalten bei eingeschaltetem Editor-Modus.
Die Antworten bestimmen die Regeln in 4.5; deshalb stehen sie vor dem Bau der State-Schicht fest, nicht danach.

**Vor der ersten Schreibfunktion überhaupt:** ein Komplett-Backup mit **BTS am PC**. Das ist das Sicherheitsnetz mit
erprobtem Rückweg, solange unser eigenes Zurückspielen noch nicht existiert.

### Phase 0a – USB-Nachweis am Handy *(erledigt: Fertig-Kriterium erfüllt über die Test-APK, Reste in 9.2 C)*
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

### Gestaltungsrunde – vor Phase 1 *(Entscheidung 16.11.2026)*

Bisher ist nur festgelegt, **was** die App kann, nicht **wie sie aussieht**. Die Oberfläche aus 0b ist eine reine
Test-Oberfläche zum Wegwerfen. Bevor die echte Oberfläche gebaut wird, kommt deshalb eine eigene Runde nur für die
Gestaltung:

1. **Nutzung klären:** Wie wird die App in der Probe benutzt? Welche Regler zuerst, was muss auf einen Blick sichtbar
   sein, was passiert mit umgehängter Gitarre, was auf der Bühne?
2. **Entwürfe:** die wichtigsten Bildschirme (Proben-Ansicht, Kanalwahl, Effekt-Seite, Verbindungsstatus, Log),
   möglichst **klickbar im Browser mit dem Mock-Amp**, damit sie sich am Handy ausprobieren lassen.
3. **Entscheiden**, dann erst die echte Oberfläche bauen. Das Bedienkonzept unten ist dabei ein Vorschlag, kein
   fester Stand.

**Ergebnis Schritt 1: Nutzung in der Probe** (Befragung 16.11.2026)

- **Kanalwechsel am Amp bzw. Fußschalter**, nicht in der App. Die App **folgt** dem Kanal und zeigt ihn. Eine
  Kanalwahl in der App bleibt (1b), ist aber Nebensache und darf einen Schritt tiefer liegen.
- **Kein Regler dominiert.** Am ehesten verstellt werden **Gain, Volume, Amp-EQ** (Bass, Middle, Treble, Presence)
  und der **Noise Suppressor** (Threshold). Das ist der Inhalt der Proben-Ansicht, und zwar **alles ohne Scrollen**.
- **Effekte kaum:** Sie sind pro Kanal fertig eingestellt. Sie bekommen eine **eigene Seite**, nicht die
  Proben-Ansicht. Auch ihr An/Aus-Zustand muss **nicht** auf einen Blick sichtbar sein.
- **Auf einen Blick sichtbar:** **Kanal und Patch-Name** (groß) und der Hinweis **„ungespeichert“**. Der
  Verbindungsstatus nur **klein in einer Ecke**.
- **Handhaltung wechselnd:** mal in der Hand mit umgehängter Gitarre, mal abgelegt (Amp, Ständer). Folgt daraus:
  große Bedienelemente und gut lesbar aus etwas Abstand.
- **Speichern meist ja:** Ein Feintuning wird am Ende meist gespeichert. „Speichern“ muss gut erreichbar sein
  (immer mit Bestätigung, 4.5 Regel 10).
- **Bedienform offen:** Statt fester Schieber mit ±1/±5 sollen Varianten im Vergleich ausprobiert werden.
- Besondere Störungen auf der Bühne wurden nicht genannt.

**Schritt 2: Entwürfe** (16.11.2026): klickbar in `design.html` (nur Dev-Server, nicht in der APK; Code in
`src/ui/design/`, zum Wegwerfen). Drei Richtungen für die Proben-Ansicht: **A Fader** (breite Balken, relativ
ziehen, ±1), **B Kacheln** (große Zahlen, Antippen öffnet ein Blatt unten mit Wischfläche und ±1/±5), **C Regler**
(Drehregler-Optik, hoch/runter ziehen, Wert groß oben beim Ziehen). Gemeinsam: Kanal und Name groß oben (antippen =
Kanalwahl), „ungespeichert“ darunter, Verbindungspunkt klein in der Ecke, „Speichern“ und „Alles zurück“ unten,
Leiste für gemerkte Änderungen, Seiten Effekte und Log, Zustände für getrennt, Fehler und nur lesend. Ein
Amp-Simulator spielt Kanalwechsel, Regler und Speichern am Amp, Kabelzug und Fehler nach.

**Tendenz (16.11.2026): Richtung C** (Drehregler). Effekte mit vielen Reglern bekommen je eine **eigene Seite**
im selben Stil (Effektliste → Effekt antippen → Typ, Farbe, alle Regler); die Proben-Ansicht bleibt beim Amp und
beim Noise Suppressor.

- **Farben nah an BOSS Tone Studio** (Wunsch 16.11.2026): fast schwarzer Hintergrund (`#1A1C1F`, Flächen
  `#292929`), weiße Schrift in Abstufungen, Akzent helles Cyan `#33D6FF` (auch die Regler), Effekt-LEDs grün
  `#40C057`, rot `#E62B0E`, gelb `#FCC419`. Die Werte sind am installierten BTS abgelesen. Übernommen werden nur
  Farbwerte, keine Grafiken oder Bilder (Abschnitt 2, Rechtliches). „Ungespeichert“ ist orange, damit es sich
  vom LED-Gelb abhebt.
- **Variationen erklären:** Grün/Rot/Gelb allein sagt nichts. Die Effektliste zeigt deshalb zur aktiven Farbe
  den Typ („Rot · Overdrive“). Die Effekt-Seite zeigt alle drei Farben mit ihrem Typ und einen Satz Erklärung
  (drei eigene Einstellungen je Effekt, am Amp per Taster umgeschaltet).
- **Effekt-Seite skizziert** (`EffectDetail.svelte`): An/Aus, die drei Variationen, Typ-Auswahl, alle Regler der
  aktiven Variation (Booster: Drive, Bottom, Tone, Effect Level, Direct Mix, Solo Level). Regler mit Mittelstellung
  (Bottom, Tone) zeichnen ihren Bogen von der Mitte aus. Typen und Regler sind Platzhalter, bis das Schema der
  Parameterliste (9.2 E 23) die Adressen hat.
- **Probe-Tab = alles Allgemeine außer Effekten** (16.11.2026), in zwei Ebenen. Immer sichtbar: Amp-Typ
  (Acoustic, Clean, Pushed, Crunch, Lead, Brown) mit Variation, die sechs Amp-Regler, NS Threshold und Release.
  „Mehr“ öffnet ein Fenster von unten (kein Scrollen): Contour (Aus/1/2/3 mit Freq Shift), Resonance, Endstufen-Variation. EQ, Solo und
  Send/Return sind in BTS Blöcke der Effektkette und kommen auf die Effekte-Seite (Phase 2).
- **Feinschliff (16.11.2026), erste Runde:** näher an Hardware statt Baukasten. Regler mit Skala (11 Striche wie
  0–10), Kappe und dünnem leuchtendem Bogen. Amp-Typ, Contour und Variation als **LED-Auswahl** wie am Gerät statt
  Knopfreihen. Kanal als dunkles „Display“ mit leuchtender Schrift. Abschnitte mit feiner Linie statt Karten,
  Effektliste als eine Fläche mit Trennlinien und schmalen Schaltern. Leisten mit farbigem Rand statt
  Vollfarbe, Navigation mit Symbolen, Erklärtexte gekürzt. Speichern ist ausgefüllt nur bei Ungespeichertem.

**Flexibilität:** Alles unterhalb von `src/ui/` (Protokoll, Warteschlange, State, Mock) ist frei von Darstellung; ESLint
erzwingt das. Die Oberfläche lässt sich daher jederzeit und auch mehrfach umgestalten, ohne den Rest anzufassen.
Festgelegt sind nur Svelte als Werkzeug und Webtechnik in der App. Nach den ersten Proben mit Phase 1 ist ein
Umgestalten ausdrücklich eingeplant.

### Phase 1 – Proben-App

**Bedienkonzept** (Vorschlag, wird in der Gestaltungsrunde überprüft): Hochformat, Bedienung mit einer Hand. **Keine Drehregler**, sondern große waagerechte
Schieber mit Knöpfen für ±1/±5. Doppeltipp setzt auf den gespeicherten Wert zurück. Ein Regler springt beim Antippen **nicht**
auf die Tippstelle, er ändert sich nur durch Ziehen (Schutz vor Lautstärkesprüngen). Dunkles Design, Bildschirm bleibt an,
solange die App im Vordergrund und mit dem Amp verbunden ist. Sperrknopf gegen versehentliches Berühren.

**1a – Nur lesen** *(kann am Amp nichts verstellen)*
- Verbinden mit Statusanzeige, automatische Neuverbindung, Modellanzeige.
- Aktuellen Patch lesen und anzeigen (Name, Amp, Effekte mit aktiver Variation), Kanalwechsel am Amp folgen.
- **Komplett-Backup in eine Datei** (rein lesend, Umfang siehe 4.6) und Patch-Dateiformat.

*Fertig, wenn:* die App nach 10-mal Ab- und Anstecken jedes Mal neu verbindet, ein Kanalwechsel am Amp in unter 2 s
erscheint und die Rohbytes zweier Backups hintereinander gleich sind.

*Scheiben (abgestimmt 16.11.2026, je ein PR):* 1. Modell: Schema, Parameterliste für 1a, Decodieren aus Rohblöcken,
Demo-Patches für den Mock. 2. Testdaten aus Mitschnitten (9.2 D 20). 3. State: ganzer Patch mit einer
Bereichsanfrage, Kanalwechsel folgen, gespeicherter Platz und „ungespeichert“, Neu-Lesen nach Vordergrund und
Wiederverbinden. 4. Oberfläche C: Kopf und Probe-Tab, nur lesend (ersetzt `src/ui/` aus 0b). 5. Oberfläche C:
Effekte-Liste und Effekt-Seite, nur lesend. 6. Storage: Dateiformat und Komplett-Backup. 7. `.tsl`-Prüfung (früh,
neben 3), Testplan `docs/testplan/phase-1a.md`, Release.

*Stand 1a:* Scheiben 1–3 gemergt (#11, #12, #13). Scheibe 4 (16.11.2026): Die Oberfläche aus 0b ist ersetzt.
`src/ui/App.svelte` (Kopf, Leisten für getrennt, Wiederverbinden, Fehler, nur lesend und gemerkte Änderungen mit
„Verwerfen“, Tabs Probe/Effekte/Log), `Header.svelte` (Kanal-Display, Name, Gespeichert/Ungespeichert,
Verbindungspunkt), `ProbeView.svelte` (Amp-Typ als LED-Auswahl, Variation, sechs Regler, Noise Suppressor mit
LED, „Mehr“ mit Resonance), `Knob.svelte`, `Sheet.svelte`, Farben in `theme.css`. Alles nur anzeigend; geänderte
Werte (gegen den gespeicherten Platz) sind orange mit Punkt an der gespeicherten Stellung. Hinter dem
Verbindungspunkt: Status, Neu lesen, Neu verbinden, Log, Sprachwahl (Englisch/Deutsch, gemerkt), Hinweis
„inoffiziell“ und im Browser die Mock-Aktionen (Kanal, Regler, Speichern am Amp, Kabel). Contour und
Endstufen-Variation fehlen noch, weil ihre Adressen nicht bekannt sind. Der Entwurf (`design.html`,
`src/ui/design/`) bleibt als Vorlage bis Ende 1a. Gemergt als #14.
Scheibe 5 (16.11.2026): `src/ui/EffectsView.svelte`. Liste mit Booster, Mod, FX, Delay, Reverb und Noise
Suppressor: LED in der Farbe der aktiven Variation, „Farbe · Typ“, Schalter an/aus (nur Anzeige), Punkt bei
Abweichung vom gespeicherten Platz. Antippen öffnet die Effekt-Seite mit An/Aus und den drei Variationen samt Typ;
die aktive ist hervorgehoben, geänderte Typen orange. Regler folgen mit 1b (Booster, Delay, Reverb) bzw. Phase 2
(Mod, FX). Die Typnamen stehen seit 16.11.2026 in eigenen Tabellen in `src/model/params.ts` (Booster 23, Mod/FX 31,
Delay 8, Reverb 5), damit sind die Effekttypen auch beschreibbar (für 1b). Dazu kamen Contour (Auswahl Aus/1/2/3,
Freq Shift je Contour) und Endstufen-Variation in die Liste und ins Fenster „Mehr“. Quelle für Namen und Lagen ist
eine lokale Analyse der BTS-Dateien (`tools/extract-bts.js` nach `bts-extract/`, beides nicht im Repo, von
ESLint und Prettier ausgenommen); jeder Wert in den Mitschnitten liegt in diesen Bereichen. Gemergt als #15.
Scheibe 6: Dateiformat und Komplett-Backup (siehe 4.6), gemergt als #16. Scheibe 7 (16.11.2026): `.tsl`-Export
(siehe 4.6), Testplan `docs/testplan/phase-1a.md`, Version 0.2.0. Gemergt als #17, Release
[v0.2.0](https://github.com/Jannes105/katana-studio/releases/tag/v0.2.0) am 16.11.2026.

**Phase 1a ist abgeschlossen (16.11.2026).** Am Amp mit dem Handy und v0.2.0 grob durchgetestet: Verbinden,
Neuverbinden nach Ab- und Anstecken (jedes Mal), Kanalwechsel und Regler am Amp folgen, Anzeige synchron. Zwei
Backups hintereinander sind bis auf die Uhrzeit byte-gleich, die `.tsl` stimmt Block für Block mit dem Backup
überein, und BTS am PC hat sie in seine Bibliothek importiert. **Noch offen** (kein Hindernis für 1b): die Zeit
des Kanalwechsels ist nicht gemessen, und der Fall „Regler drehen während des Lesens“
(`docs/testplan/phase-1a.md`).

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
**Umgesetzt (0b):** Workflow „Release“ (`.github/workflows/release.yml`). Ablauf: Version in `package.json` erhöhen
(per PR), nach dem Merge den passenden Tag `vX.Y.Z` auf `main` setzen. Der Workflow prüft, baut, signiert, prüft die
Signatur und legt das Release mit `katana-studio-X.Y.Z.apk` an. Ein Tag, der nicht zur Version in `package.json` passt,
bricht ab. `versionCode` = Laufnummer des Release-Workflows (steigt mit jedem Lauf), `versionName` = Version aus
`package.json` (auch `src/app-info.ts` liest sie dort, es gibt nur eine Stelle). Von Hand gestartet
(„Run workflow“) baut er dieselbe signierte APK nur als Artefakt, ohne Release. Lokale Builds bleiben unsigniert bzw.
mit Debug-Schlüssel; eine lokal installierte Debug-Version muss vor der ersten signierten deinstalliert werden.

**Signierschlüssel:** Jede APK wird damit signiert. Er liegt als verschlüsseltes Geheimnis in GitHub und **zusätzlich bei dir**
(Passwort-Manager oder USB-Stick). Geht er verloren, gehen Updates nur noch per Deinstallieren, und dabei verschwinden die
App-Daten. Deshalb wird er gesichert, bevor die erste signierte APK aufs Handy kommt.
Die Workflows lesen ihn aus den Geheimnissen `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` und
`ANDROID_KEY_ALIAS`.

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
| Firmware-Update ändert das Protokoll | Modellcode und Editor-Level prüfen (bei Abweichung nur lesend, siehe 4.3). Die Firmware-Version ließ sich bisher nicht auslesen; findet sie sich, wird sie beim Verbinden mit der Version der Parameterliste verglichen. |
| Markenbeschwerde wegen öffentlichem Repo | Kein „BOSS“ im Titel, Hinweis „inoffiziell“, keine Logos, kein Auspack-Werkzeug im Repo. Bei Beschwerde umbenennen. |

## 8. Offen

- Am Handy (Rest von 0a, siehe 9.2 C): Akku, OTG über 15 Minuten, Brummen, Benachrichtigungstöne über den Amp.
- Am Amp: große DT1 ohne Abstand (vor 1c).
- Am Handy: die Sendetests aus `protocol-notes.md` 2.13 einmal mit der Test-APK wiederholen.
- Später: `PATCH_WRITE` vom PC aus (vor 1c), Wirkung von `EXPORT` und `PREVIEW_MUTE` (Phase 4), Ort der
  Firmware-Version (bisher nicht gefunden, kein Hindernis).
- **Entfallen:** Tuner-Daten (dir ist kein Tuner am Amp bekannt; nur falls sich doch einer findet, wird es nachgeholt).
- **Geklärt** (4.2, 4.2b, 4.3): USB-Werte, Bereichsanfragen und Lesezeiten an PC und Handy, Lesen ohne Editor-Modus,
  Editor-Modus ist Pflicht und darf an bleiben, Meldungen bei Kanalwechsel, Reglern und Speichern, Zuordnung A1–B4,
  Index 9 = Vorschau-Platz, Herkunft der „unaufgeforderten Meldungen“.

## 9. Stand und Vorbereitung für Phase 0b

### 9.0 Stand Phase 0b (16.11.2026)

In sechs Scheiben umgesetzt, je ein PR:

1. Gerüst: Vite, Svelte, TypeScript, ESLint mit Schichtregeln, Capacitor-Android-Projekt, CI-Job `app` (Pflicht-Prüfung
   für `main`). (#3)
2. Protokoll-Schicht mit Tests: SysEx, Adressen, Kodierungen, Blocktabellen, Warteschlange mit den am 16.11.
   besprochenen Regeln, Begrüßung. (#4)
3. Mock-Amp, Mitschnitt-Modus, Nachspielen echter Mitschnitte; Blocktabelle gegen alle 33 Mitschnitte geprüft. (#5)
4. Android-USB-Plugin mit allen Pflichten aus 4.2; Auto-Start beim Einstecken am Handy bestätigt. (#6)
5. Minimale Oberfläche: „Verbunden, KATANA-100“, NS-Threshold lesen und schreiben (am Handy hörbar), Log-Bildschirm. (#7)
6. Signierte APK aus der CI (Workflow „Release“), Version an einer Stelle, `versionCode` automatisch. (#8, #9)

**Phase 0b ist abgeschlossen (16.11.2026).** Fertig-Kriterium aus 5 erfüllt mit dem Release
[v0.1.0](https://github.com/Jannes105/katana-studio/releases/tag/v0.1.0): Die signierte APK startet beim Einstecken von
selbst, zeigt „Verbunden, KATANA-100“, liest den NS-Threshold richtig und schreibt ihn hörbar. Die Protokollfragen für 0b
sind in `protocol-notes.md` beantwortet. Beim ersten Release-Lauf scheiterte nur die Signaturprüfung am anderen
Ausgabeformat von `apksigner` (build-tools 37); behoben in #9, der Tag wurde vor dem ersten Release neu gesetzt.

**Als Nächstes:** die Gestaltungsrunde (Abschnitt 5, vor Phase 1).

Noch offen, aber nicht Teil von 0b: 9.2 C (Akku, OTG über 15 Minuten, Brummen, Benachrichtigungstöne), ~~9.2 D 20~~
(Testdaten, erledigt in 1a), 9.2 E 23 (Schema der Parameterliste, vor 1b),
große DT1 ohne Abstand messen (vor 1c), `usbtest/` löschen, sobald die echte App in der Probe funktioniert.

---

Stand 15.11.2026 abends (Vorbereitung, unten). Einzelheiten und Mitschnitt-Namen stehen in `docs/protocol-notes.md`.

### 9.1 Erledigt

- **Phase 0a:** Fertig-Kriterium erfüllt. Die Test-APK (`usbtest/`) liest und schreibt am Amp, die Änderung am
  NS-Threshold war hörbar. WebUSB im Chrome scheitert am belegten Interface, das Kotlin-Plugin ist also nötig.
  USB-Werte: Interface 3, Altsetting 0, Bulk OUT `0x03` / IN `0x84`, Kabelnummer 0, normales USB-MIDI-Paketformat.
  Ganzer Patch am Handy in 0,284 s.
- **Phase 0 am PC:** Der Amp meldet Kanalwechsel, Regler und Speichern von sich aus, aber **nur mit Editor-Modus an**.
  Zuordnung Index → `PATCH(n+1)` für A1–B4 bestätigt. `PATCH_SELECT` funktioniert. Blocktabelle eines Patches
  (80 Blöcke) liegt vor.
- Werkzeuge: Testseiten, Mitschnitt-Werkzeug, `tools/katana-probe.ps1`, CI für Test-APK und Pages.

### 9.2 Vor dem Start von 0b nötig

**A. Dokumente nachziehen** (reine Schreibarbeit, kein Amp nötig) – *erledigt 15.11.2026*

1. Diesen Plan an die Messungen anpassen. Überholt sind:
   - 4.2 / 4.2a: USB-Werte eintragen, WebUSB als Weg streichen. „Fertig, wenn alle Blockadressen da sind“ ist jetzt
     umsetzbar, weil die Blocktabelle existiert.
   - 4.2b: Die Reihenfolge der Blöcke war in allen neuen Läufen aufsteigend. Die „unaufgeforderten Meldungen“ sind
     die Meldungen des Editor-Modus.
   - 4.3: Editor-Modus einschalten ist **Pflicht** (nicht nur BTS-Nachbau), der Zustand ist zurücklesbar, das
     Umschalten wird nicht quittiert. Meldungen bei Kanalwechsel (`00 00 00 00` und Status-Bytes `7F 01 01 01`–`05`)
     und beim Speichern (`7F 00 01 04`) eintragen. Der Befehlsbereich `7F 00 00 0x` antwortet nur auf Einzelabfragen.
   - 4.5: Regel 5 (Neu-Lesen) ist nur noch Sicherheitsnetz. Regel 3: Wartezeit nach Patchwechsel neu festlegen.
   - 4.6: Die Bereichsanfrage über alle Speicherplätze liefert den Vorschau-Platz mit; er muss herausgefiltert werden.
   - Abschnitt 8: Liste der offenen Punkte kürzen.
2. `docs/testplan/phase-0.md` abhaken, den Tuner-Punkt als entfallen markieren.
3. Im Mitschnitt-Werkzeug vermerken, dass „Dump candidate areas“ im Befehlsbereich nichts zeigt.

**B. Restliche Protokollfragen, die die State-Schicht betreffen** (am Amp, zusammen etwa eine halbe Stunde)

4. ~~**Echo beim Schreiben**~~ *erledigt 15.11.2026:* kein Echo, weder mit noch ohne Editor-Modus. Regel 2 in 4.5
   bleibt aus anderen Gründen.
5. ~~**Sendeabstand über USB**~~ *erledigt 15.11.2026 (am PC):* Für kleine Nachrichten ist kein Abstand nötig.
   Offen: große DT1 (vor 1c) und eine Wiederholung am Handy mit der Test-APK.
6. ~~**Die fünf Effekt-Regler einzeln**~~ *erledigt 15.11.2026:* Index 0–4 = Booster, Mod, FX, Delay, Reverb.
   Status-Bytes = Farbe der Variation (0–2), 3 = aus. Der Reverb-Schalter liegt an `08 05`, nicht `08 04`.
7. ~~**Effekt-Taster am Amp**~~ *erledigt:* Kurzer Druck wechselt die Farbe (Farb-Block `04 00`), nur bei
   eingeschaltetem Effekt. Ein- und Ausschalten geht über den Regler (auf null = aus). Halten meldet nichts.
8. ~~**Speichern mit echter Änderung**~~ *erledigt:* Speicherplatz danach identisch mit dem aktuellen Patch.
9. ~~**Editor-Modus nach Aus- und Einschalten**~~ *erledigt:* Er ist danach **aus**. Die App schaltet ihn bei
   jedem Verbinden ein (4.3).
10. ~~**Panel**~~ *erledigt:* Index 0 liegt in `20 10 00 00` (80 von 80 Blöcken gleich).

Nicht nötig für 0b, kommt später: `PATCH_WRITE` vom PC aus (vor 1c), `EXPORT` / `PREVIEW_MUTE` (Phase 4),
Ort der Firmware-Version (bisher nicht gefunden, kein Hindernis).

**C. Am Handy** (Rest von 0a, geht nebenbei in einer Probe)

11. 15 Minuten angesteckt: bleibt die Verbindung, braucht es eine OTG-Einstellung?
12. Akkuverbrauch über eine feste Zeit.
13. Brummen durch das Kabel bei Probenlautstärke.
14. Kommen Benachrichtigungstöne des Handys aus dem Amp? (Der Amp meldet sich auch als Audio-Gerät.)
15. Eine Probe mit der Test-APK und ihren drei Reglern. Danach die Reihenfolge in 1b noch einmal ansehen.

**D. Entwicklungsumgebung und Repo**

16. ~~**Signierschlüssel**~~ *erledigt 16.11.2026:* erzeugt (PKCS12, RSA 4096, Alias `katana-studio`), Passwort im
    Passwort-Manager, Datei auf USB-Stick und an einem zweiten Ort. In GitHub als Geheimnisse
    `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` und `ANDROID_KEY_ALIAS` (Schlüssel-Passwort = Passwort
    der Datei).
17. ~~**Lokaler Build**~~ *erledigt 16.11.2026:* Temurin JDK 21.0.13, Android-Kommandozeilen-Werkzeuge 23.0
    (Einrichtung per `tools/setup-android-sdk.ps1`), SDK-Pakete `platform-tools`, `platforms;android-36`,
    `build-tools;35.0.0`. `usbtest/` baut lokal (erster Lauf 2:42 min). `adb` ist über WLAN mit dem Handy gekoppelt
    und findet es selbst im Netz. Hinweise: `sdkmanager` ist durch das Programm `android` ersetzt (immer mit
    `--no-metrics` aufrufen); ein lokaler Debug-Build hat einen anderen Schlüssel als der CI-Build.
18. ~~**Arbeitsweise im Repo festlegen**~~ *entschieden 16.11.2026:* Branch und Pull Request, `main` geschützt
    (siehe Abschnitt 2). Eingerichtet 16.11.2026: Die Workflows laufen auch bei Pull Requests; Pflicht-Prüfung ist
    der Job `test` (Tests der Testseiten), der Test-APK-Build läuft nur bei Änderungen an `usbtest/` und ist keine
    Pflicht. Seit 16.11.2026 ist zusätzlich der Job `app` (Workflow „App“: Typprüfung, Lint, Tests, Build,
    Debug-APK der echten App) Pflicht-Prüfung.
19. ~~**CI aufräumen**~~ *weitgehend erledigt 16.11.2026:* checkout, setup-node, setup-java, setup-gradle und
    upload-artifact laufen überall auf v5 (Node 24). Offen sind nur die Pages-Actions (`configure-pages`,
    `upload-pages-artifact`, `deploy-pages`) in `pages.yml`, sobald es dafür Node-24-Versionen gibt.
20. ~~**Testdaten:**~~ *erledigt 16.11.2026 (1a, Scheibe 2):* vier bereinigte Auszüge in `tests/fixtures/`:
    ganzer Patch mit allen Speicherplätzen und `PATCH_SELECT`, Kanalwechsel am Amp, Reglerstrom, Speichern am Amp.
    Patch-Namen sind durch neutrale ersetzt („PATCH 1“ …), die Werte bleiben (harmlos), Notizen entfallen.
    Erzeugt mit `MAKE_FIXTURES=1 npx vitest run tests/local/make-fixtures` (nur am eigenen PC); geprüft in der CI
    von `tests/fixtures.test.ts` mit denselben Prüfungen wie `tests/local/captures.test.ts`.

**E. Entscheidungen**

21. ~~**Verhältnis von Test-App und echter App**~~ *entschieden 16.11.2026:* `usbtest/` wird gelöscht, sobald
    die echte App (im Wurzelverzeichnis) den USB-Teil übernommen hat (siehe Abschnitt 2).
22. ~~**Versionen festschreiben**~~ *entschieden 16.11.2026:* Capacitor 8, `minSdk 29`, `targetSdk 36`,
    Kotlin 2.2.20, JDK 21.
23. **Schema der Parameterliste** (4.4) als Entwurf, zumindest für die Blöcke von Phase 1b (Amp, Booster, Delay,
    Reverb, Noise Suppressor, Farben). Für 0b selbst reicht die Blocktabelle. *Teilweise erledigt 16.11.2026:*
    Schema und Liste für 1a stehen (4.4), die Typnamen auch. Für 1b fehlen noch die Regler von Booster, Delay
    und Reverb.

### 9.3 Bereit für die Implementierung, wenn

- A (Dokumente) erledigt ist und der Plan dem gemessenen Stand entspricht,
- aus B mindestens die Punkte 4 und 5 beantwortet sind (sie bestimmen Warteschlange und State-Regeln),
- der Signierschlüssel gesichert ist (16, erledigt) und der lokale Build läuft (17, erledigt),
- die Entscheidungen 18, 21 und 22 getroffen sind (erledigt 16.11.2026).

Alles andere (Rest von B, C, 19, 20, 23) kann parallel zu 0b laufen.
