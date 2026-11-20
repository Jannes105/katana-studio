# Test plan: Phase 3a (explanations)

Work through this on the phone with the signed release APK of Phase 3a (`katana-studio-0.7.0.apk` or 0.7.1), connected to
the amp. Phase 3a adds **explanations**: a long press (hold about half a second without moving) on a knob, a
choice, a switch, an amp type, an effect type, a chain block or a row in the Control tab opens a window from below
with what it does, when you need it, a typical start value and sometimes a sound tip. Nothing else on the screen
changes. **A long press never changes a value.** Note results and surprises below each item.

Done criterion from PLAN "Phase 3a": every parameter and type the app shows has a text in English and German
(test), keys and lengths match (test), a long press provably changes nothing (test and phone), the windows fit
412×915, 375×812 and 375×667 without scrolling, and this test plan is done on the phone.

## Results

*(not run yet)*

## Before you start

- [ ] Install v0.7.0 from the GitHub release (same signing key, installs over it).
- [ ] Use a channel you can spare. Nothing here should change the patch; if "Unsaved" appears after a long press,
      that is a bug (note which control).

## 1. Rehearsal tab

- [ ] The hint line says "Drag: change · Double tap: saved value · Hold: explain" (on small screens it may be
      hidden, as before).
- [ ] Hold **Gain**: a short buzz, the window opens with "Amp" above the title; the value stays the same.
- [ ] Hold Gain and then drag up while still holding: **nothing changes**; release: still nothing.
- [ ] Drag Gain right away (without holding still first): it changes as before, no window.
- [ ] Double tap a changed knob: back to the saved value, as before.
- [ ] Hold an amp type that is **not** selected (e.g. Lead): the window explains it; the amp type stays.
- [ ] Hold **Variation**, **NS**, **Contour**: windows open; nothing switches.
- [ ] Open "More": hold Threshold, a contour type, Resonance, Power Amp, a Cabinet Resonance button: the window
      opens above the "More" window; closing it leaves "More" open.

## 2. Effects tab

- [ ] Hold a row in the list (e.g. Delay): it explains the active type; the page does not open.
- [ ] Hold a switch: explains on/off; the effect does not switch.
- [ ] On an effect page: hold a variation button (does not switch), the type button (explains the current type),
      a knob, a choice (segment buttons and lists): each explains, nothing changes.
- [ ] Open the type list and hold a type you have not selected: its window opens above the list; the type stays.
- [ ] Mod/FX: hold knobs of a few types (Chorus low and high band, Pitch Shifter voice 2, Harmonist User Voice
      notes, Graphic EQ band): each has a text.
- [ ] EQ, Pedal FX, Solo, Send/Return pages: hold a few knobs and choices.

## 3. Chain tab

- [ ] Hold a block (e.g. Booster): its window opens ("Signal order" above the title); the block does **not** move
      and does not get selected.
- [ ] Drag a block as before: it moves, no window.

## 4. Control tab

- [ ] Amp knobs: hold a target row: explains; the list does not open.
- [ ] Pedals: hold a row (EXP pedal, GA-FC EXP 1): explains the input; the page does not open. On the page, hold
      Function, Target, Min, Max.
- [ ] Switches: hold a GA-FC function mode switch, GA-FC FS1, a footswitch row.
- [ ] System: hold a section row (explains the section), then on a page hold a choice and a knob. **No SYSTEM
      value changes** (SYSTEM is stored at once on the amp, so check carefully).

## 5. Language and size

- [ ] Switch the language in the connection window: the explanations switch too.
- [ ] Hold Gain (the longest text): the window fits without scrolling on the phone, in both languages.
- [ ] Turn the phone sideways only if you use it that way; the app is made for upright use.

## 6. Reading the texts

- [ ] Read a handful of explanations per area. Note anything wrong, unclear or too long (key and language), so it
      can be fixed. Start values are suggestions, not rules.
