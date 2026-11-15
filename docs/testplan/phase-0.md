# Test plan: Phase 0

Work through this at the amp. Results go into `docs/protocol-notes.md` (the "Result / decision" field of each
question, and section 3 for the USB values). Captures go into `captures/` (git-ignored, may contain your patches).

**Status 2026-11-15:** Part A done except the items marked open; Part B done except B5. The open items are listed
in PLAN section 9.2 (B: amp, C: phone, D20: fixtures).

## Part A: Phase 0 on the PC

Setup: Windows PC, Chrome, amp connected by USB and switched on, BOSS driver installed.

Note: most experiments ran with `tools/katana-probe.ps1` (winmm on the same port) instead of the capture page.
The capture page stays available; the steps below name its buttons.

### A0. Preparation

- [x] **Full backup with BOSS Tone Studio on the PC.** Keep the file outside the repo. This is the safety net
      before anything writes to the amp.
- [x] Close BOSS Tone Studio (the MIDI port is exclusive).
- [x] Start the static server for `testpages/` and open `http://localhost:8080/capture/` in Chrome.
      *(or run `tools/katana-probe.ps1`)*
- [x] Press **Connect**. Status shows "Connected to KATANA3", model code `06` (KATANA-100).
- [x] Write down the identity reply if it differs from `F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7`.
      *(same reply)*

For every experiment: **Start** in the checklist panel, markers for each action on the amp, **End**, type notes,
then **Download JSON** and move the file to `captures/`.

### A1. Read-only experiments (nothing is written from the PC)

- [x] **Sanity check:** "Read full current patch" reports about 80 DT1 / 2649 bytes; "Read SYSTEM" about 21 DT1 /
      131 bytes. Note deviations.
- [x] **Q7 firmware version:** "Dump candidate areas", look for the version, note address or "not found".
      *(not found; the command area answers only single reads, so the dump shows nothing there)*
- [x] **Q6 slot mapping:** "Read all ten stored slots", check the names. Then select PANEL, A1 … B4 on the amp one
      by one and press "Verify mapping for the current channel" each time. Fill in the table in Q6 and update
      section 2.7 of the notes. *(PANEL and A1–B4 confirmed)*
- [x] **Q4 unsolicited messages:** two minutes idle; full patch read five times; all slots; patch name; channel
      switch followed by a full read. Note when UNSOLICITED lines or duplicates appear.
      *(explained: they are the reports of editor mode, see Q8)*
- [x] **Q1 patch change:** send nothing, select every channel and PANEL on the amp with a marker before each.
      Note what the amp reports.
- [x] **Q3 knobs and buttons:** snapshot A, move one control, snapshot B and diff. Repeat for every control on
      the panel. Fill in the table in Q3. *(all knobs and the effect buttons done)*
- [x] ~~**Q9 tuner:** tuner on, play strings, tuner off, with markers. Note any incoming data.~~
      *Dropped: no tuner known on the amp.*
- [x] **Q2 saving on the amp:** on a channel you can spare, change a knob and save on the amp. Note what the amp
      reports; "Verify mapping" should then show identical. (The amp overwrites that channel; the backup from A0
      covers it.) *(reported; with a real change: slot identical afterwards)*

### A2. Write experiments (tick the backup checkbox in the tool first)

- [x] **NS threshold:** "Read current value", move the slider, hear the change. Does the amp echo the write?
      *(audible: done in 0a; no echo, notes 2.13)*
- [x] **Q8 editor mode on:** "Editor mode ON", operate the amp, note anything that behaves differently.
- [x] Repeat with editor mode on: **Q1** (patch change), **Q3** (two or three controls), **Q4** (full read five
      times), **Q9** (tuner), **Q2** (save on the amp). *(and the comparison with editor mode off: silent)*
- [x] **PATCH_SELECT:** select two or three channels from the tool. Does the amp switch? What does it report back?
- [x] **Q8 editor mode left on:** download the capture, close the tab without "Editor mode OFF", operate the amp,
      reconnect and "Dump candidate areas"; power-cycle the amp, reconnect, dump again; then "Editor mode OFF".
      *(left on and read back: done; a power cycle resets it to off)*
- [x] **Q5 EXPORT / PREVIEW_MUTE:** not now. Skip until the procedure is written in the notes. *(deferred to Phase 4)*

### A3. Wrap-up

- [x] Every question Q1–Q4 and Q6–Q9 has a dated "Result / decision" in `docs/protocol-notes.md`, with the capture
      file name.
- [x] Statuses in section 2 of the notes updated (what moved from "derived" to "confirmed").
- [x] Decisions that change PLAN 4.5 (re-reading, sign-off, patch change handling) are noted for the plan.
- [ ] One clean capture of a patch change and one of a full patch read set aside as candidates for test fixtures.
      *(open, PLAN 9.2 D20)*

## Part B: Phase 0a on the phone

Setup: Nothing Phone (3a) Pro, USB-C data cable to the amp, amp in the normal USB mode. Before starting: repo is
public and GitHub Pages serves `testpages/` and the prototype.

### B1. Five-minute Web MIDI attempt

- [x] ~~Open `prototype/katana-test.html` from GitHub Pages in Chrome on the phone, amp connected, press Connect.~~
- [x] ~~Result noted in section 3 of the notes.~~ *Skipped: WebUSB showed the vendor class, for which Android creates
      no MIDI port.*

### B2. WebUSB test page

- [x] Open `testpages/usb/` from GitHub Pages in Chrome on the phone and select the amp.
- [x] Copy the full descriptor dump ("Copy log") into the notes, even if the next steps fail.
- [x] Claim the interface and send the identity request. Note success or the exact error text.
      *(fails: "Unable to claim interface")*

### B3. Test APK (if WebUSB could not claim the interface)

- [x] Install the test APK (app ID ending in `.usbtest`), plug in the amp, grant USB permission.
- [x] Identity reply received. Note whether `force` was needed for the claim.
- [x] Copy the log into the notes.
- [x] ~~If this fails too: stop and decide anew (PLAN, Phase 0a step 3).~~ *Not needed.*

### B4. Values for the notes (section 3)

- [x] Interface number, alternate setting, IN and OUT endpoint addresses and types, max packet size.
- [x] Cable number and packet format (4-byte USB-MIDI packets confirmed or not).
- [x] Full patch read time on the phone (PC: 0.27 s). *(0.284 s)*

### B5. Living with the cable

- [ ] **15-minute OTG stability:** leave it connected, read something every few minutes. Does the connection drop?
      Is an OTG setting needed, and does it switch itself off?
- [ ] **Battery drain:** note the percentage before and after a fixed time with the screen on.
- [ ] **Hum / noise:** listen with the cable plugged and unplugged, at rehearsal volume.
- [ ] **Notification sounds:** trigger a notification on the phone. Does it come out of the amp?

### B6. Done when

- [x] The phone receives the identity reply `F0 7E 10 06 02 41 07 05 …`.
- [x] The phone reads the patch name.
- [x] The phone changes the NS threshold by DT1 and the change is audible.
- [x] Interface, alternate setting, endpoints, cable number and packet format are written down in
      `docs/protocol-notes.md`.
- [x] The test page or test APK has its three rough sliders (NS threshold, gain, volume) and is ready for the
      next rehearsal.
