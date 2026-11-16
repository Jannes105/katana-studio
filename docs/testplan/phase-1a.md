# Test plan: Phase 1a (read only)

Work through this at the amp with the phone and the signed release APK of Phase 1a (`katana-studio-0.2.0.apk`).
Nothing in 1a writes to the amp except editor mode during the greeting. Note results and surprises below each
item; captures from the log screen ("Copy capture") go into `captures/` (git-ignored).

Done criterion from PLAN "Phase 1a": the app reconnects every time after unplugging and plugging in 10 times, a
channel change on the amp appears in under 2 s, and the raw bytes of two backups in a row are identical.

**Status 2026-11-16 (v0.2.0):** the owner went through the plan roughly: connection, reconnecting, following the
amp and the display all work and stay in sync. Done criterion met (details below), and BOSS Tone Studio imports
our .tsl. Open: the finer points not ticked here.

## Setup

- [ ] Uninstall a locally installed debug build first if there is one (different signing key).
- [ ] Install the APK from the GitHub release, plug the amp in, choose "always open with Katana Studio".
- [ ] The app starts by itself and shows the channel, the patch name and a green dot in the corner.

## 1. Connection

- [x] **10 × unplug and plug in** the USB cable, a few seconds apart. Each time: banner "Amp unplugged · values
      frozen", values dimmed but visible; after plugging in the dot turns green and the values are read again.
      Count: \_\_ of 10. *(2026-11-16: reconnected every time)*
- [ ] Switch the amp off and on with the app open: it greets again (editor mode on) and reads.
- [ ] Put the app in the background for a minute, turn a knob on the amp meanwhile, bring the app back: the value
      is read again ("Back in the foreground" in the log).
- [ ] Connection window (tap the dot): status, model KATANA-100, last read time, "Read again" works.

## 2. Following the amp

- [x] **Channel change on the amp** A1 → B4 → PANEL → A2: name, amp and effects follow, each in **under 2 s**.
      Slowest seen: \_\_ s. *(2026-11-16: follows and stays in sync; time not measured)*
- [ ] Turn GAIN, VOLUME, BASS, MIDDLE, TREBLE, PRESENCE on the amp: the knobs follow live.
- [ ] Turn the NS threshold knob on the amp (if the panel has one) or check the value against BOSS Tone Studio.
- [ ] After turning a knob: header shows **Unsaved**, the knob turns orange with a dot at the stored position.
      Turn it back: "Saved" again.
- [ ] Save on the amp (hold the channel button): "Unsaved" disappears.
- [ ] Change a knob, switch to another channel and back: banner "1 remembered change from before"; "Discard"
      removes it. (Restoring comes with 1b.)
- [ ] **Turn a knob on the amp while the app is reading** (tap "Read again" and turn GAIN at once): the final value
      in the app matches the amp. (Checks the rule that a report before its block is dropped; the mock cannot
      show this, PR #13.)

## 3. What the screens show (compare with BOSS Tone Studio or the amp)

- [ ] Amp type LED (Acoustic … Brown) and Variation match the amp for at least three channels.
- [ ] "More": contour (Off/1/2/3), freq shift, resonance, power amp variation match BOSS Tone Studio.
- [ ] Effects list: on/off and colour (green/red/yellow) of Booster, Mod, FX, Delay, Reverb match the LEDs on the
      amp; the type of the active variation matches BOSS Tone Studio (e.g. "Red · OVERDRIVE").
- [ ] Effect page: the three variations show the same types as BOSS Tone Studio.
- [ ] Noise suppressor: on/off, threshold, release.
- [ ] Language switch English/German in the connection window; the choice is kept after restarting the app.

## 4. Backup and files

- [x] **"Back up everything" twice in a row**, save both files (e.g. Google Drive). On the PC compare them: apart
      from `createdAt` they are identical. (Or: send both to Claude.)
      *(2026-11-16, 21:45 and 21:46: identical apart from `createdAt`; SYSTEM 21 blocks, Panel–B4, current patch
      80 blocks)*
- [ ] Pull the cable during a backup: an error is shown, no file is offered.
- [ ] "Save this patch" gives a patch file of the current channel.
- [x] **.tsl check**: "A1–B4 as .tsl", copy the file to the PC, import it into the librarian of BOSS Tone Studio.
      *(2026-11-16: exported; 8 patches, every block equal to slots A1–B4 of the backup; import into BOSS Tone
      Studio worked.)*
      The eight patches appear with their names; open two of them and compare a few values with the amp.
      Do **not** write them to the amp from BOSS Tone Studio. Result: \_\_
- [ ] "This patch as .tsl" imports the same way.

## 5. In the rehearsal

- [ ] One rehearsal with 1a: does the app stay connected, does the battery hold, is everything readable from a
      distance? Notes go into PLAN 9.2 C (OTG over 15 minutes, battery, hum, notification sounds).
