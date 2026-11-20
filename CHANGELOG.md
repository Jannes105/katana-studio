# Changelog

What changed in each release of Katana Studio. The section of a version becomes the text of its GitHub Release,
so every version bump adds one here.

## 0.7.1 – 2026-11-18

### Changed
- New launcher icon (a knob, with a monochrome version for themed Android icons) and a matching splash screen
  instead of the default ones.

## 0.7.0 – 2026-11-17

### New
- Explanations for everything: long-press a knob, choice, switch, amp type, effect type, chain block or a row in
  the Control tab. A window shows what it does, when you need it, a typical start value and often a sound tip.
- Covers every parameter shown in the app (over 1000, including assigns and SYSTEM) and all 77 amp and effect
  types, in English and German.
- A long press never changes a value: moving the finger first means drag, and after the explanation opens the
  touch does nothing else.

## 0.6.0 – 2026-11-17

### New
- **Control tab:** what the effect knobs on the amp control for each effect type, the expression inputs (EXP jack
  on the amp, GA-FC EXP 1–3), the footswitches and the GA-FC function mode.
- **SYSTEM settings:** global EQ (with its memories), line out, USB, power amp in and MIDI. They apply to all
  channels and the amp keeps them at once.
- Every assign and SYSTEM address was checked on the amp.

## 0.5.0 – 2026-11-17

### New
- All sound parameters: the knobs of every mod and FX type (up to six per page), Delay 2 with layer mode, EQ 1 and
  EQ 2, pedal FX, solo and send/return.
- **Chain tab:** the signal path as a vertical diagram; reorder blocks by drag and drop.
- Contour type and cabinet resonance in "More".

## 0.4.2 – 2026-11-17

### Changed
- Rehearsal tab redesigned: amp type, variation and the six amp knobs on top; quick switches for NS on/off,
  Contour and More under the thumb. NS threshold and release moved into "More". The tab fits any screen height
  without scrolling.

## 0.4.1 – 2026-11-17

### Fixed
- The whole page could be dragged around although there was nothing more to show. Only the content area scrolls
  now.

## 0.4.0 – 2026-11-17

### New
- **Save** onto the current channel (A1–B4) with a confirmation. The app waits for the amp's acknowledgement,
  reads the channel back and compares it. Before the first save of the day it offers a backup.
- **Load a patch from a file** (backup, patch file or `.tsl`) into any channel, listen to it, then save it the
  same way.
- **Rename** a patch by tapping its name.
- "Revert all" now also restores values the app has no knob for yet.

## 0.3.0 – 2026-11-16

### New
- The app writes to the amp: amp type, variation and the six amp knobs, noise suppressor, contour, resonance and
  power amp, changed live while you play. Nothing is saved on the amp unless you save there.
- Effects: switch booster, mod, FX, delay and reverb on and off, pick the variation and the type; knobs for
  booster, delay and reverb.
- Double tap a knob to go back to the saved value, "Revert all to saved", and undo for every revert.
- Pick the channel A1–B4 in the app. Unsaved changes of a channel you leave are kept and can be brought back.

## 0.2.0 – 2026-11-16

### New
- Reads the whole current patch and follows channel changes and knobs on the amp; unsaved changes are marked.
- Rehearsal tab with amp type, variation, the six amp knobs and the noise suppressor; effects list with each
  effect's variation and type (read only).
- **Full backup** of all channels into a file, export through the share menu.
- `.tsl` export that BOSS Tone Studio imports into its library.
- English and German.

## 0.1.0 – 2026-11-16

### New
- First signed release: the app starts when the amp is plugged in, shows "Connected, KATANA-100" and reads and
  writes the noise suppressor threshold. Log screen for troubleshooting.
