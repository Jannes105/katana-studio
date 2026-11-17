# Test plan: Phase 3 (control and system)

Work through this at the amp with the phone, the GA-FC and the signed release APK of Phase 3
(`katana-studio-0.6.0.apk`). Phase 3 adds the **Control** tab: what the effect knobs on the amp control per
effect type, the expression inputs (EXP pedal on the amp, GA-FC EXP 1–3), the footswitches, and the SYSTEM
settings (global EQ, line out, USB, power amp in, MIDI, GA-FC function mode). Assigns are part of the patch
(unsaved until you save); **SYSTEM applies to every channel and the amp stores it at once** (protocol-notes 2.6).
Note results and surprises below each item; captures from the log screen ("Copy capture") go into `captures/`
(git-ignored).

All addresses were checked on the amp without listening (write, read back, no other byte changed, restore;
protocol-notes 2.6 and 2.8). This plan is where **listening and the GA-FC** come in.

Done criterion from PLAN "Phase 3": every parameter of the list is checked on the amp, every value in the
captures lies in the ranges, the list matches the address map of BOSS Tone Studio, the SYSTEM layout is in
protocol-notes, an assign set in the app shows the same in BOSS Tone Studio (sample via `.tsl`), the GA-FC does
on the amp what the app set, a SYSTEM change survives switching off and on, and this test plan is done at the amp.

## Results

*(not run yet)*

## Before you start

- [ ] With the installed v0.5.0: "Back up everything" and keep the file (it holds SYSTEM too).
- [ ] Install v0.6.0 from the GitHub release (same signing key, installs over it).
- [ ] Use a channel you can spare; assigns change only the current patch until you save. SYSTEM changes are
      kept at once: note what you change there so you can set it back.

## 1. Control tab

- [ ] The tab bar has five equal tabs; **Control** (Steuerung) fits next to the others.
- [ ] Four areas: **Amp knobs, Pedals, Switches, System**. No area and no page scrolls.

## 2. Amp knobs

- [ ] Each of the five effects shows the target of its knob on the amp; Mod and FX name the active type.
- [ ] Choose a target for the current mod type (e.g. Chorus → Low Rate), then **turn the Mod knob on the amp**:
      it now changes that parameter (listen; the effect page follows). Back to **Preset**: the knob does what it
      did before.
- [ ] Change the mod type on the amp or in the app: the row shows the target of the new type.
- [ ] Header **Unsaved**; "Revert all" and saving include the assigns.

## 3. Pedals

- [ ] Each input shows "function · target" and, for an effect, the range (e.g. "DELAY · Time, 200 ms – 800 ms").
- [ ] Open GA-FC EXP 1: set the function to DELAY, the target to Time: Min/Max jump to 1 ms – 2000 ms. Change the
      target to Feedback: Min/Max jump to 0 – 100. Knobs show the unit of the target.
- [ ] Double tap on Min or Max sets it back to the stored value, with **Undo**.
- [ ] **Without a pedal this cannot be heard.** With a pedal in EXP 1 of the GA-FC: heel = Min, toe = Max; note
      what happens with a factory Max of 127 and target Preset.
- [ ] Only if a pedal is at hand: a type after the harmonist (Humanizer, Heavy Octave, Pedal Bend) with Min/Max
      set; BOSS Tone Studio computes those positions differently (protocol-notes 2.8), the amp decides.

## 4. Switches and GA-FC

- [ ] **GA-FC function mode** (top, every channel): SW1–SW4, PANEL show what the amp has (SW2 DELAY TAP since the
      test of 2026-11-17).
- [ ] Set e.g. SW1 SOLO ON/OFF, SW2 DELAY TAP, SW3 GLOBAL EQ ON/OFF. At the GA-FC: **hold EFFECT**, then press 1,
      2, 3: solo, tap tempo of the delay, global EQ on/off. Does the System area in the app follow the global EQ
      switch? (Whether the amp reports SYSTEM changes is not measured yet.)
- [ ] GA-FC FS1–3 of the patch and the footswitch on the amp: note whether anything on your GA-FC uses them.

## 5. System

- [ ] Every system page shows the orange note "applies to every channel · the amp stores it at once".
- [ ] **Global EQ:** on/off, memory 1–3, position, type parametric / GE-10, the knobs on two pages; listen to a big
      cut or boost. Switching memory shows that memory's settings.
- [ ] **Line Out** (in the rehearsal room with the line out connected): air feel REC / LIVE / BLEND, custom on/off,
      M1/M2 with mic type, distance, position, ambience. Listen at the desk.
- [ ] **USB** (only when recording): levels, loop back. **Power Amp In** (only with the input in use). **MIDI**:
      channel, CC and PC numbers (nothing to hear without a MIDI device).
- [ ] Switch the amp **off and on**: after reconnecting, the app shows the same system values.

## 6. Backup and BOSS Tone Studio

- [ ] "Back up everything" after the changes: the file holds SYSTEM with the new values.
- [ ] Later on the PC: export the channel as `.tsl` and import it into BOSS Tone Studio; compare the knob target
      and one pedal assign. In BOSS Tone Studio's system page compare global EQ and the GA-FC functions.
