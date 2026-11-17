# Test plan: Phase 2 (all sound parameters)

Work through this at the amp with the phone and the signed release APK of Phase 2 (`katana-studio-0.5.0.apk`).
From Phase 2 on the app sets every sound parameter of a patch: the knobs of all mod and FX types, Delay 2 and
layer mode, EQ 1 and EQ 2, pedal FX, solo, send/return, the chain, contour type and cabinet resonance. All of it
writes only into the current patch; saving stays as in 1c. Note results and surprises below each item; captures
from the log screen ("Copy capture") go into `captures/` (git-ignored).

The addresses were checked on the amp without listening (write, read back, no other byte changed, restore;
protocol-notes 2.8). This plan is where **listening** comes in: if a knob sounds different from its name, note
the effect, type and knob.

Done criterion from PLAN "Phase 2": every parameter of the list is checked on the amp, every value in the
captures lies in the ranges, a patch set in the app shows the same values in BOSS Tone Studio (sample per area,
via `.tsl` import), "Revert all" and saving cover the mod/FX knobs, and this test plan is done at the amp.

## Results

*(not run yet)*

## Before you start

- [ ] With the installed v0.4.2: "Back up everything" and keep the file.
- [ ] Install v0.5.0 from the GitHub release (same signing key, installs over it).
- [ ] Use a channel you can spare; everything below changes only the current patch until you save.

## 1. Effects tab and chain tab

- [ ] The **Effects** tab lists only Booster, Mod, FX, Delay, Reverb and Noise Suppressor (as before).
- [ ] The new **Chain** tab shows the signal path from Input (top) to Speaker (bottom): every block on one
      line, the amp as the wide block, FV as a small mark; Solo below. It fits the screen without scrolling.
- [ ] **Drag** a block with ⇅ (e.g. Booster) up or down: the chain shows where it would land and only stops on
      places the amp allows; on release the order changes and you hear it. Try a block across the amp (EQ 1,
      Pedal FX) and Send/Return to the end. Header **Unsaved**, orange dot at Input.
- [ ] **Tap** a block: the bar at the bottom offers on/off, ▲▼ (one step) and Page. Amp, Delay 2 and Reverb
      cannot move (no ⇅, no arrows).
- [ ] Each page (also EQ, Pedal FX, Send/Return, Solo) opens from both tabs; "back" returns to where you were.
- [ ] Compare one changed chain with the chain in BOSS Tone Studio (later, after saving).

## 2. Mod and FX

- [ ] Open Mod, choose a few types (Chorus, Phaser, Harmonist, Pitch Shifter, Graphic EQ, Comp, DC-30). Each shows
      its knobs on pages of at most six; page tabs, arrows and swiping switch pages; nothing scrolls.
- [ ] Turn knobs and **listen**: rate, depth, level etc. do what their names say. Note any that do not.
- [ ] Harmonist: with "1VOICE" there is no Voice 2 page; with "2VOICE" there is. Setting a harmony to USER adds
      its "User Voice" pages. Master Key is on the "Main" page.
- [ ] Choices with many values (Comp type, Wah type, Guitar Sim type) open a list.
- [ ] The same for FX. Changing the variation (colour) shows the knobs of that variation's type.
- [ ] Turn a mod knob **on the amp**: the app follows on the open page.
- [ ] Double tap on a knob sets it back to the stored value, with **Undo**.

## 3. Delay 2 and layer mode

- [ ] Delay page → tab **Delay 2**: switch it on. The app shows the note about the reverb colour; the reverb
      page then shows layer mode **Both** (the amp sets it by itself, protocol-notes 2.8). Listen: a second delay.
- [ ] Reverb page: layer mode **Delay 2 / Both / Reverb**; switching to Reverb turns Delay 2 off in the app.
      Note what layer mode "Delay 2" does to the switch (not measured yet).
- [ ] Delay 2 knobs follow the type (as Delay).

## 4. EQ, pedal FX, solo, send/return

- [ ] **EQ 1 / EQ 2:** on/off, position (Amp In / Amp Out), type Parametric / GE-10; the GE-10 bands on two pages.
      Listen to a big cut or boost.
- [ ] **Pedal FX:** on/off, position, type Pedal Wah / Pedal Bend / Wah 95E with their knobs (pedal position
      moves the wah without a pedal).
- [ ] **Solo:** on/off, level, and the solo EQ page. (The KATANA-100 has no solo delay; the app does not show it.)
- [ ] **Send/Return:** on/off, position, mode, levels (only meaningful with something in the loop).

## 5. Rehearsal tab "More"

- [ ] With a contour selected, **Type 1–4** of that contour is shown and switches the sound.
- [ ] **Cabinet Resonance** Vintage / Modern / Deep switches.
- [ ] The window fits without scrolling.

## 6. Revert, save, BOSS Tone Studio

- [ ] Change knobs in several areas (mod, EQ, chain), then "Revert all to saved": everything goes back, **Undo**
      brings it back.
- [ ] Save on the channel ("Saved to … · checked"). Switch away and back on the amp: everything is there.
- [ ] Later on the PC: export the channel as `.tsl` from the app (or a backup) and import it into BOSS Tone
      Studio; compare a sample per area (mod knobs, EQ, pedal FX, chain).
