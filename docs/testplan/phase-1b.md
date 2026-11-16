# Test plan: Phase 1b (live adjusting)

Work through this at the amp with the phone and the signed release APK of Phase 1b (`katana-studio-0.3.0.apk`).
From 1b on the app **writes** to the amp, but only into the current patch (the edit buffer). It never saves:
anything you want to keep, save on the amp (hold the channel button). Note results and surprises below each item;
captures from the log screen ("Copy capture") go into `captures/` (git-ignored).

Done criterion from PLAN "Phase 1b": a rehearsal of 2 hours runs without hangs, a knob change is audible at once,
a channel change drops waiting values, and a pulled cable freezes the values and leads to reading again without
writing.

## Before you start

- [ ] With the installed v0.2.0: "Back up everything" and keep the file (the way back is the .tsl import into
      BOSS Tone Studio).
- [ ] Install v0.3.0 from the GitHub release (same signing key as v0.2.0, so it installs over it).
- [ ] The app connects by itself, shows channel, name and a green dot; the connection window says
      "Writing: on".

## 1. Rehearsal tab

- [ ] **Drag** Gain, Volume, Bass, Middle, Treble, Presence: the sound changes at once, the header shows
      **Unsaved**, the knob turns orange with a dot at the stored position.
- [ ] NS Threshold and Release: audible (threshold most clearly with gain up and the guitar silent).
- [ ] **Double tap** a changed knob: it goes back to the stored value; the hint "… back to saved · Undo" appears.
      **Undo** brings the value back. After about 6 s the hint disappears by itself.
- [ ] **Tap** an amp type (e.g. Clean → Crunch): the amp type LED on the amp follows, the sound changes.
- [ ] **Variation** (amp) and **NS on/off** by tapping: audible, the amp follows.
- [ ] **More**: contour Off/1/2/3, Freq Shift of the active contour, Resonance, power amp variation.
- [ ] **Revert all to saved**: every change goes back, header shows **Saved**; Undo brings them back.
- [ ] Turn a knob **on the amp** right after the app wrote it: after a moment the app shows the amp's value.

## 2. Effects tab

- [ ] Switch Booster, Mod, FX, Delay, Reverb **on and off** in the list: the LEDs on the amp follow.
- [ ] Effect page: **tap another variation** (green/red/yellow): the colour on the amp follows, the type and
      knobs below change to that variation.
- [ ] **Choose a type** from the list (e.g. booster BLUES DRIVE → OVERDRIVE): audible; the type is orange
      (changed against the stored slot).
- [ ] **Booster knobs**: Drive, Bottom, Tone (−50…+50 from the centre), Solo, Solo Level, Effect Level, Direct
      Mix.
- [ ] **Delay knobs**: Time (5 ms per step), Feedback, High Cut, Effect Level, Direct Mix. With the type PAN also
      Tap Time; MODULATE also Mod Rate and Depth; SDE-3000 its own set (no High Cut). Does each knob sound like
      its name? (The addresses were checked by writing and reading back, not by listening; protocol-notes 2.8.)
- [ ] **Reverb knobs**: Time, Pre Delay, Low Cut, High Cut, Density, Effect Level, Direct Mix; SPRING also Spring
      Color.
- [ ] Mod and FX: on/off, variation and type work; their knobs say "later phase".

## 3. Channels

- [ ] Tap the **channel display**: the picker shows A1–B4. Choose another channel: the amp switches, the app
      follows in under 2 s.
- [ ] Change a knob, switch to another channel and back: the banner offers **Restore**; it writes the change into
      the current patch (with Undo). **Discard** forgets it. A channel with remembered changes has a dot in the
      picker.
- [ ] Choosing the active channel does nothing (it would otherwise reload the stored slot).

## 4. Done criterion

- [ ] **Channel change drops waiting values:** drag a knob and, while dragging, switch the channel on the amp.
      The new channel stays as stored (compare with the amp or BOSS Tone Studio later).
- [ ] **Pulled cable:** pull the cable while dragging. Banner "Amp unplugged · values frozen"; nothing changes on
      the amp. Plug in again: the app reads again and writes nothing by itself (the value on the amp is the one
      from before the pull).
- [ ] **Knob change audible at once** (section 1).
- [ ] **Rehearsal of 2 hours** without hangs: \_\_ (date, notes; also PLAN 9.2 C: OTG over 15 minutes, battery,
      hum, notification sounds).

## 5. Open from Phase 1a

- [ ] Time of a channel change on the amp until the app shows it: \_\_ s.
- [ ] Turn a knob on the amp while the app is reading ("Read again" in the connection window, turn GAIN at once):
      the final value in the app matches the amp.
