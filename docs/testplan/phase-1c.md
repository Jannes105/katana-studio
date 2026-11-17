# Test plan: Phase 1c (saving)

Work through this at the amp with the phone and the signed release APK of Phase 1c (`katana-studio-0.4.0.apk`).
From 1c on the app **saves onto the amp's channels** (A1–B4, never the Panel), always after a confirmation, and
loads patches from files into a channel. Use a channel you can spare for the first saves. Note results and
surprises below each item; captures from the log screen ("Copy capture") go into `captures/` (git-ignored).

Done criterion from PLAN "Phase 1c": saving is only possible after a confirmation, what is read back is
identical, a simulated fault shows a message, and a patch from a backup can be restored.

## Results

**2026-11-17, v0.4.0 at the amp with the phone, one pass through everything:** seemed to work. Observed: saving
and pulling the cable right away, then plugging in again, ends with the channel saved. That is expected: the amp
saves within about 2 ms of PATCH_WRITE (protocol-notes 2.15), long before the cable is out; the pull only
interrupts the app's check, and after reconnecting the app reads the slot again (it never writes on its own).
Also noticed: the page could be scrolled although it showed nothing more; fixed after v0.4.0 (only the content
area scrolls when it does not fit).

## Before you start

- [ ] With the installed v0.3.0: "Back up everything" and keep the file (the way back is the .tsl import into
      BOSS Tone Studio, or loading it with v0.4.0 below).
- [ ] Install v0.4.0 from the GitHub release (same signing key, installs over it).
- [ ] The connection window says "Writing: on (current patch, saving after confirmation)".

## 1. Saving

- [ ] Without changes the button "Save to A1" (your channel) is only outlined; after turning a knob it is filled
      and the header shows **Unsaved**.
- [ ] Tap it: the window "Save to …?" names channel and patch. The first time today (no backup from today in the
      app) it offers **Back up first** and **Save without backup**. "Back up first" opens the share menu; after
      that the window offers **Save**.
- [ ] **Cancel** (or close the window): nothing is saved (switch the channel away and back on the amp: the old
      value is there).
- [ ] **Save**: the hint "Saved to … · checked" appears, the header shows **Saved**. Switch away and back on the
      amp: the new value is there. BOSS Tone Studio (later, on the PC) shows the same.
- [ ] A second save in the same session does not offer a backup again.
- [ ] On the **Panel** (choose it on the amp) the button is locked.
- [ ] Remembered changes of a channel (switch away with unsaved changes, come back) disappear after saving there.
- [ ] Saving on the amp (hold the channel button) still works and the app follows (header **Saved**).

## 2. Revert all (now whole blocks)

- [ ] Turn a **Mod or FX knob on the amp** (not adjustable in the app yet), then "Revert all to saved": the knob's
      value goes back too (header **Saved**); **Undo** brings it back.

## 3. Renaming

- [ ] Tap the patch name in the header: a field with the name. Enter a new name (try an umlaut: "ä" becomes "ae";
      more than 16 characters are cut), **Apply**: the header shows it, **Unsaved**.
- [ ] Save: BOSS Tone Studio (later) shows the new name on that channel.
- [ ] Double tap is not available on the name; "Revert all" brings the stored name back.

## 4. Loading a patch from a file (restore)

- [ ] Connection window → **Load a patch from a file** → choose the backup from "Before you start". The window
      lists Panel, A1–B4 and the current patch with their names.
- [ ] Choose a patch and another channel as target → **Load into …**: the amp switches to that channel, the
      sound changes, the banner says "… loaded into … · not saved yet", header **Unsaved**.
- [ ] Listen; then switch the channel on the amp: the loaded patch is gone from the amp (it was not saved), the
      banner disappears; coming back offers it as remembered changes.
- [ ] Load again and tap **Save** in the banner: same confirmation as saving; afterwards the channel holds the
      patch from the file (switch away and back).
- [ ] Load a **.tsl** exported from the app ("A1–B4 as .tsl") or from BOSS Tone Studio: its patches are listed by
      position; incomplete ones are marked and cannot be chosen.
- [ ] A file that is neither (e.g. a photo): a readable message in the connection window, nothing happens.

## 5. Faults (done criterion)

The mock in the browser covers the simulated faults ("Saving from the app: No acknowledgement / Wrong content"
in the connection window; automatic tests in `tests/state/saving.test.ts`). At the amp:

- [ ] **Pull the cable right after tapping Save**: a red banner "Saving … was interrupted"; after plugging in the
      header shows whether the channel holds the change (Saved/Unsaved).
- [ ] **Switch the channel on the amp right after tapping Save**: same banner, no crash.

## 6. Open from earlier phases

- [ ] Rehearsal of 2 hours without hangs (1b), with saving in between: \_\_
- [ ] On the phone, saving and loading a whole patch work as at the PC (protocol-notes 2.13 and 2.15 were measured
      on the PC; the phone's USB may be faster): \_\_
- [ ] Time of a channel change on the amp until the app shows it (1a): \_\_ s.
