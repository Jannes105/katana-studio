# Protocol notes: BOSS Katana 100 Gen 3

The living reference for everything we know about the wire protocol. `docs/PLAN.md` says what we build;
this file says what the amp actually does. Update it whenever an experiment gives a result.

Tools for the experiments: `tools/katana-probe.ps1` (PowerShell + winmm, used for most results) and
`testpages/capture/` (Chrome on the PC); both on port "KATANA3" with BOSS Tone Studio closed.
Checklist to work through: `docs/testplan/phase-0.md`.

## 1. Status legend

Every statement carries one of these:

| Mark | Meaning |
|---|---|
| **[C date]** | Confirmed on the amp by our own measurement or capture, with the date. |
| **[D]** | Derived from analysis (how BOSS Tone Studio behaves, Linux driver source, Roland conventions). Not verified on the amp. |
| **[O]** | Open. Nobody knows yet; see the question ID in section 5. |

Test setup for everything marked [C]: Windows PC with the BOSS driver (Web MIDI in Chrome or winmm from
`katana-probe.ps1`), amp in the normal ("Vendor") USB mode. Section 3 is measured on the phone with the test APK.

## 2. What is known

### 2.1 USB identity

| Item | Value | Status |
|---|---|---|
| Vendor / product ID | `0582` / `02F0` | [C 2026-11-15] |
| Device class | vendor specific, `FF/FF`; not a standard USB-MIDI device | [C 2026-11-15] |
| Windows driver | Roland vendor driver `RDID1254`; the MIDI port is called "KATANA3" and is exclusive | [C 2026-11-15] |
| "Generic" USB mode (firmware 1.07 and later, hold [MOD] at power-on) | audio only, no MIDI, according to Roland; we stay in the normal mode | [D] |
| Android MIDI | Android only creates a MIDI device for class Audio / subclass MIDI Streaming, so the amp will not show up as a MIDI device (checked in the framework source) | [D] |
| Linux kernel | `snd-usb-audio` has a catch-all for `VID 0582` with class `FF` and detects MIDI through the Roland descriptor `06 24 F1 02 …`; if the phone kernel has it, it claims the interface | [D] |
| USB-MIDI packet format (4-byte event packets) on the vendor interface | standard packets, cable 0, interface 3 alt 0, bulk `0x03` / `0x84` | [C 2026-11-15] section 3 |

### 2.2 Identity request and reply

- Request (universal SysEx, broadcast): `F0 7E 7F 06 01 F7`
- Reply: `F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7` [C 2026-11-14]

| Byte index | Value | Meaning | Status |
|---|---|---|---|
| 2 | `10` | device ID; taken from the reply and used in every Roland message | [C 2026-11-14] |
| 5 | `41` | manufacturer: Roland | [C 2026-11-14] |
| 6–9 | `07 05 00 00` | not interpreted by us | [O] |
| 10 | `06` | model code, `06` = KATANA-100 | [D] (value seen on the amp; the meaning comes from analysis) |
| 11–13 | `00 00 00` | not interpreted by us | [O] |

The reply does **not** carry a firmware version (PLAN section 1). The older reading "firmware 06 00 00 00" in
HANDOFF.md is superseded: the `06` is the model code. Where the firmware version lives is Q7.

### 2.3 SysEx framing

```
F0 41 <dev> 01 05 07 <cmd> <addr x4> <data ...> <checksum> F7
```

| Item | Value | Status |
|---|---|---|
| Manufacturer | `41` | [C 2026-11-14] |
| Model ID | three bytes `01 05 07` | [C 2026-11-14] |
| `<cmd>` = `11` | RQ1, read: 4 address bytes + 4 size bytes | [C 2026-11-14] |
| `<cmd>` = `12` | DT1, write or report: 4 address bytes + data | [C 2026-11-14] |
| Checksum | `(128 - (sum(address + data) % 128)) % 128`; for RQ1 the size bytes take the place of the data | [C 2026-11-14] |
| Accepted device IDs on receive | the learned one and `7F` (as BOSS Tone Studio does) | [D] |
| Longest message seen | 238 bytes | [C 2026-11-15] |

### 2.4 Address math

- Addresses and sizes are four 7-bit digits. After `7F` comes `01 00`, so base + offset must never be added
  byte by byte. Convert to a linear number (`b0*128^3 + b1*128^2 + b2*128 + b3`), calculate, convert back. [D]
- The same holds for the **size field of RQ1**: a size above 127 is not a plain byte count in the last byte.
  Range sizes in 7-bit notation work on the amp (`00 02 00 00`, `01 20 00 00`). [C 2026-11-15]
- Implementation with tests: `src/protocol/address.ts` in the app (addresses are linear numbers inside the app);
  `testpages/shared/katana.js` (`toLinear`, `fromLinear`, `addOffset`) for the test pages.

### 2.5 Value encodings

All [D] unless noted.

| Name | Layout | Used for |
|---|---|---|
| `u7` | one byte 0–127 | most parameters; NS threshold write confirmed [C 2026-11-14] |
| `u2x4`, `u4x4` | 2 or 4 bytes, one nibble each, most significant first | patch number, delay time, assign min/max |
| `u2x7` | 2 bytes of 7 bits | commands |
| `ascii(16)` | 16 characters, codes 32–125, padded with spaces | patch name [C 2026-11-14] |

For patch indexes 0–9, `u2x4` and `u2x7` give the same two bytes (`00 0n`), so which of the two PATCH_SELECT uses
cannot be told from small values.

### 2.6 Memory map

| Address | Area | Status |
|---|---|---|
| `00 00 00 00` | current patch number (index 0–9), read works without editor mode | [C 2026-11-15] |
| `10 00 00 00` | SYSTEM: 21 blocks, 131 data bytes in one range read | [C 2026-11-15] |
| `20 00 00 00` | current patch (edit buffer): 80 blocks, 2649 data bytes, range size `00 02 00 00` | [C 2026-11-15] |
| `20 10 00 00` … `21 20 00 00` | ten stored patches, one every `00 10 00 00`; 800 blocks, 26 490 data bytes with range size `01 20 00 00` | [C 2026-11-15] |
| `21 30 00 00` | does not answer | [C 2026-11-15] |
| `30 00 00 00` | a temporary area according to analysis; never read by us | [D] |
| `7F 00 00 00` | command area, see 2.9 | [D], single addresses as marked there |

**Layout of SYSTEM** (local analysis of BOSS Tone Studio, 2026-11-17; block lengths as measured in 2.12; names
as in its address map). Offsets from `10 00 00 00`. Our list is `src/model/system.ts` (129 parameters, compared
entry by entry with the address map: same offset, size and range for all 129).

**Writes to SYSTEM [C 2026-11-17]** (`katana-probe.ps1 -ParamTest -System -NoAsk [-AllTypes] -Only …`, PC, after
a complete backup and a SYSTEM backup by the tool, agreed with the owner beforehand; captures
`param-test-20261117-202428.json`, `…202529.json`, `…202750.json`): all 129 addresses in three groups (MIDI and
GA-FC 34, USB/line out/power amp in 21, global EQ 74 including the bands of the type not selected) were written,
read back, changed no other SYSTEM byte and were restored; SYSTEM was as at the start after each group. Nobody
listened. Writing global EQ select or on/off changed nothing else (no coupled byte like layer mode in 2.8).

**Kept over a power cycle [C 2026-11-17]**: GA-FC SW2 `10 00 22 01` set from 7 (SOLO) to 4 (DELAY TAP) by a
single DT1 (`-SetOnly`, `set-20261117-202856.json`); after the owner switched the amp off and on, `10 00 22 00`
read `07 04 07 07 07`. A DT1 to SYSTEM is stored at once; no save command (unlike PATCH_WRITE for patches).

| Block | Name | Bytes | Content |
|---|---|---|---|
| `00 00` | COM | 1 | stereo expand 0/1; BOSS Tone Studio shows no control for it, not in our list |
| `02 00` | USB_COM | 5 | +0 input level ("to effect level", raw = dB + 20), +1 effect out level, +2 mix level, +4 dry out level (0–100, shown ×2 %), +3 loopback 0/1 |
| `04 00` | GLOBAL_COM | 2 | +0 global EQ on/off, +1 selected memory 0–2 |
| `06 00` … `0A 00` | GLOBAL_EACH(1–3) | 2 | +0 position 0 INPUT, 1 OUTPUT, 2 LINE OUT, 3 SP OUT; +1 type 0 parametric, 1 GE-10 |
| `0C 00` … `10 00` | GLOBAL_PEQ(1–3) | 11 | as the patch EQ (2.8): low cut, gains ±20 dB, freqs 0–27, Q 0–5, high cut, level |
| `12 00` … `16 00` | GLOBAL_GE10(1–3) | 11 | ten bands and level, ±24 dB |
| `18 00` | LINEOUT_COM | 3 | +0 custom memory M1/M2, +1 air feel mode (0 REC, 1 LIVE, 2 BLEND; BOSS Tone Studio lists REC, BLEND, LIVE), +2 custom on/off |
| `1A 00`, `1C 00` | LINEOUT(1, 2) | 5 | custom M1/M2: mic type 0–4 (DYN57, DYN421, CND451, CND87, RBN121), mic distance 0–20 cm, mic position 0–10 cm, ambience pre-delay, ambience level |
| `1E 00` | POWERAMPIN | 3 | HPF type 0–4 (flat, −6 … −24 dB/oct), HPF freq (raw = Hz − 1, 1–100 Hz), level ±20 dB |
| `20 00` | POWERADJUST | 1 | power control 0–8; hidden for the KATANA-100 by BOSS Tone Studio's model table, not in our list |
| `22 00` | GAFC | 5 | GA-FC function mode: SW1–SW4, PANEL, same ten functions as the patch's GA-FC FS1–3 (2.8) |
| `24 00` | MIDI_COM | 1 | Rx channel 0–15 |
| `26 00` | MIDI_CC | 19 | CC number per control: booster, mod, FX, delay, reverb, send/return, EXP pedal, GA-FC EXP 1–3, GA-FC FS1–3, GA-FC expand EXP 1–3 and FS1–3; raw 0–30 = CC#1–31, 31–62 = CC#64–95 |
| `28 00` | MIDI_PC | 9 | program change number per channel (PANEL, A1–B4), raw = number − 1 |

On the owner's amp (capture `katana-probe-20261117-181446.json`): global EQ on, memory 1 (parametric, output)
with low cut and −6 dB low-mid; line out air feel LIVE, custom off; GA-FC SW1–4 and PANEL all SOLO ON/OFF (SW2 DELAY
TAP since the power-cycle test above); MIDI
and USB at the factory values.

### 2.7 Patch index and stored slots

The patch number runs 0–9. The stored patch of index n lives in block `PATCH(n+1)`, address
`20 10 00 00 + n * 00 10 00 00` (7-bit math). This mapping is in one place in the code (`storedPatchAddress`)
with its own test, because an off-by-one would write backups to the wrong slot.

| Index | Channel | Stored at | Status |
|---|---|---|---|
| 0 | Panel (cannot be saved to) | `20 10 00 00` | **[C 2026-11-15]** index ↔ slot: with PANEL selected, patch number `00 00`, 80 of 80 blocks identical (Q6); name "KATANA" |
| 1 | A1 | `20 20 00 00` | **[C 2026-11-15]** index ↔ slot: 80 of 80 blocks identical (Q6); channel label confirmed by the owner (names match the channels) |
| 2 | A2 | `20 30 00 00` | **[C 2026-11-15]** index ↔ slot: 80 of 80 blocks identical (Q6); channel label confirmed by the owner (names match the channels) |
| 3 | A3 | `20 40 00 00` | **[C 2026-11-15]** index ↔ slot: 80 of 80 blocks identical (Q6); channel label confirmed by the owner (names match the channels) |
| 4 | A4 | `20 50 00 00` | **[C 2026-11-15]** index ↔ slot: 80 of 80 blocks identical (Q6); channel label confirmed by the owner (names match the channels) |
| 5 | B1 | `20 60 00 00` | **[C 2026-11-15]** index ↔ slot: 80 of 80 blocks identical (Q6); channel label confirmed by the owner (names match the channels) |
| 6 | B2 | `20 70 00 00` | **[C 2026-11-15]** index ↔ slot: 80 of 80 blocks identical (Q6); channel label confirmed by the owner (names match the channels) |
| 7 | B3 | `21 00 00 00` | **[C 2026-11-15]** index ↔ slot: 80 of 80 blocks identical (Q6); channel label confirmed by the owner (names match the channels) |
| 8 | B4 | `21 10 00 00` | **[C 2026-11-15]**: patch number was 8, the name matched the current patch, all 80 blocks were identical |
| 9 | "PREVIEW" slot (never write) | `21 20 00 00` | name "PREVIEW" read there [C 2026-11-15]; its role as preview slot is [D] |

### 2.8 Known offsets inside a patch

Offsets are relative to the patch base (`20 00 00 00` for the current patch, the slot address for a stored one).
Parameter names are our own. The full parameter list will be our own table in `src/model/`.

| Offset | Content | Encoding | Status |
|---|---|---|---|
| `00 00` + 0 | patch name | `ascii(16)` | [C 2026-11-14] read; **[C 2026-11-17]** written (`katana-probe.ps1 -NameTest`, current patch only, `captures/name-test-20261117-124207.json`): a 16-byte DT1 reads back as written, no other block changes; the amp turns characters outside 32–125 (tested 126 and 31) into spaces; a DT1 of only the first 4 bytes changes only those 4 |
| `06 00` + 0 | amp gain | `u7` | [D]; the amp sent this block unsolicited as "gain/volume" [C 2026-11-15]; write unverified |
| `06 00` + 1 | amp volume | `u7` | same as gain |
| `06 00` + 2 | amp bass | `u7` | [D] |
| `06 00` + 0 … 4 | gain, volume, bass, middle, treble (knobs in panel order) | `u7` 0–100 | [C 2026-11-15] reported, Q3 |
| `06 00` + 6 | power amp variation | `u7` 0/1 | **[C 2026-11-16]** written (`-ParamTest`), read back, change seen or heard |
| `06 00` + 7 | amp type: 0 Acoustic, 1 Clean, 2 Pushed, 3 Crunch, 4 Lead, 5 Brown | `u7` 0–5 | **[C 2026-11-16]** written (`-ParamTest`), read back, change seen or heard (1 Clean → 2 Pushed); order also fits the stored slots and the analysis |
| `06 00` + 8 | resonance | `u7` 0–100 | **[C 2026-11-16]** written (`-ParamTest`), read back, change seen or heard |
| `06 00` + 9 | amp variation | `u7` 0/1 | **[C 2026-11-16]** written (`-ParamTest`), read back, change seen or heard |
| `0A 00`, `0C 00`, `0E 00` | booster, one block per variation (colour 0, 1, 2); byte 0 = type | 8 bytes each | [C 2026-11-16, variation 0] written unattended (`-ParamTest -NoAsk`): read back, no other byte of the patch changed; meaning from the layout, not listened to; the booster knob moves `0A 01` and `0A 06` (Q3) |
| `10 00`, `12 00`, `14 00` | mod type per variation, 0–30 (same type list as FX) | 1 byte each | type byte [C 2026-11-16, variation 0] written unattended (`-ParamTest -NoAsk`): read back, no other byte of the patch changed; meaning from the layout, not listened to |
| `16 00`, `18 00`, `1A 00` | FX type per variation, 0–30 | 1 byte each | type byte [C 2026-11-16, variation 0] written unattended (`-ParamTest -NoAsk`): read back, no other byte of the patch changed; meaning from the layout, not listened to |
| `1C 00`, `1E 00`, `20 00` | mod parameters of all types, per variation | 225 bytes each | [D]; the mod knob moves `1D 37` and `1D 3B` (Q3) |
| `22 00`, `24 00`, `26 00` | FX parameters of all types, per variation | 225 bytes each | [D]; the FX knob moves `23 19`. The knob reports were taken with colour 0 for mod; for FX `23 19` lies in the first FX block `22 00` |
| `28 00`, `2A 00`, `2C 00` | delay per variation; byte 0 = type, bytes 1–4 = time | 17 bytes each; time `u4x4` in ms | [C 2026-11-16, variation 0] written unattended (`-ParamTest -NoAsk`): read back, no other byte of the patch changed; meaning from the layout, not listened to; `00 01 09 00` = 400 ms in most slots; the delay knob moves `28 05` and `28 07` |
| `2E 00`, `30 00`, `32 00` | Delay 2 per variation (same layout as delay) | 17 bytes each | [D] analysis |
| `40 00` + 0 | contour select: 0 off, 1–3 | `u7` 0–3 | [C 2026-11-16] written unattended (`-ParamTest -NoAsk`): read back, no other byte of the patch changed; meaning from the layout, not listened to; 0, 1 or 3 in the stored slots |
| `42 00`, `44 00`, `46 00` | contour 1–3: byte 0 type (0–3), byte 1 freq shift (raw = shown + 50, −50…+50) | 2 bytes each | freq shift of contour 3 [C 2026-11-16] written unattended (`-ParamTest -NoAsk`): read back, no other byte of the patch changed; meaning from the layout, not listened to; type byte [D] |
| `34 00`, `36 00`, `38 00` | reverb per variation; byte 0 = type, byte 1 presumably layer mode (0 Delay 2, 1 both, 2 reverb) | 13 bytes each | [C 2026-11-16, variation 0] written unattended (`-ParamTest -NoAsk`): read back, no other byte of the patch changed; meaning from the layout, not listened to (layer mode not written); the reverb knob moves `34 0A`; byte 1 = 1 only in a slot with Delay 2 switched on; layer mode confirmed by analysis |
| `04 00` + 0 … 4 | colour (variation 0–2) of BOOSTER, MOD, FX, DELAY, REVERB | `u7` | [C 2026-11-15] reported by the effect buttons, Q3; [C 2026-11-16] written for all five (`-ParamTest`), LED followed |
| `08 00` + 0 … 3, 5 | on/off of BOOSTER, MOD, FX, DELAY, REVERB (+4 Delay 2) | `u7` 0/1 | [C 2026-11-15] reported, Q3; [C 2026-11-16] written for all five (`-ParamTest`), LED followed; +4 [D] analysis |
| `06 00` + 5 | presence (sixth amp knob) | `u7` | [C 2026-11-15] reported, Q3 |
| `58 00` + 0 | noise suppressor switch | `u7` 0/1 | **[C 2026-11-16]** written (`-ParamTest`), read back, change seen or heard |
| `58 00` + 1 | noise suppressor threshold | `u7` 0–100 | **[C 2026-11-14]** written by DT1, change was audible |
| `58 00` + 2 | noise suppressor release | `u7` 0–100 | **[C 2026-11-16]** written (`-ParamTest`), read back, change seen or heard |
| `5A 00` | send/return | | [D] |
| `5C 00` ff. | assigns, see "Assigns" below | | **[C 2026-11-17]** for instance (1); the (2) blocks [O] |

**Blocks for Phase 2** (local analysis of BOSS Tone Studio, 2026-11-17; names as in the `.tsl` file, 2.14).
Byte offsets from the block start; raw ranges. **[C 2026-11-17]** for everything in this table except the solo
delay (KATANA Artist only, see below): `katana-probe.ps1 -ParamTest -NoAsk -AllTypes -Status D` (PC, current patch only, no PATCH_WRITE, after a
complete backup; `captures/param-test-20261117-143857.json`): 538 addresses, mod and FX in variation 0, Delay 2
in reverb variation 0, contour in the selected contour. 525 were written, read back, changed no other byte and
were restored; the whole patch was as before after each one. Nobody listened; the meaning rests on the layout
of BOSS Tone Studio. Our list was also compared entry by entry with its address map (1535 entries including all
variations: same block, offset, encoding and range).

- **Delay 2 switch and layer mode are coupled** [C 2026-11-17]: writing the switch `08 00` + 4 from 0 to 1 also
  set the layer mode of reverb variation 0 (`34 00` + 1) from 2 (reverb) to 1 (both); writing the layer mode from
  2 to 1 also set the switch from 0 to 1. Restoring either restored both. The amp did not send anything for the
  coupled byte (editor mode was on, nothing else was listened for); the app reads the coupled byte back after
  writing (`alsoChanges` in the parameter list). The other directions (layer mode 0, switch 1 → 0) are not
  measured.
- **Solo delay `3E 00` ignores writes** [C 2026-11-17]: all 11 parameters read back unchanged after a DT1 of one
  parameter, nothing else changed (solo was off). Same with **solo on** (`-Set 'solo.on=1'`, restored after)
  and with a **whole-block DT1** of all 14 bytes (`-WholeBlock`; send level as control in the same run was
  taken): `captures/param-test-20261117-144802.json`, `…144822.json`. In every capture the block holds BOSS Tone
  Studio's defaults (on 0, carry-over 1, 400 ms, feedback 22, effect level 50, …), in some stored slots with
  effect level 0, so it can change somehow, but not by DT1 into the current patch. How BOSS Tone Studio or the
  amp sets it is open. **Explanation** (owner's remark, then local analysis): BOSS Tone Studio shows the solo
  delay only for the KATANA Artist; its model table switches it off for the KATANA-100 (and 50, 212, head). The
  block is part of every Gen 3 patch because the format is shared. So the KATANA-100 has no solo delay; the
  block is not in our list and the app neither shows nor writes it (backups and `.tsl` keep it as raw bytes).

| Block | `.tsl` name | Bytes | Content |
|---|---|---|---|
| `02 00` | OTHER | 3 | +0 chain variant 0–8, +1 cabinet resonance 0–2, +2 master key 0–11 (harmonist) |
| `08 00` + 4 | SW | 1 | Delay 2 on/off |
| `1C 00` … `20 00` | FX_DETAIL(1–3) | 225 | mod variations 0–2: the parameters of all 31 types at fixed offsets (210 parameters: 205 × `u7` and 5 × `u4x4`, namely pre delay 1/2 of pitch shifter and harmonist, 0–300 ms, and the DC-30 echo repeat rate, 40–600) |
| `22 00` … `26 00` | FX_DETAIL(4–6) | 225 | FX variations 0–2, same layout as mod |
| `2E 00` … `32 00` | DELAY(4–6) | 17 | Delay 2, one block per **reverb** variation, same layout as delay |
| `34 00` … `38 00` + 1 | REVERB | 1 | layer mode 0 Delay 2, 1 both, 2 reverb |
| `3A 00` | SOLO_COM | 2 | +0 solo on/off, +1 effect level 0–100 |
| `3C 00` | SOLO_EQ | 10 | +0 position 0/1, +1 on/off, +2 low cut 0–17, +3 low gain (raw = shown + 24), +4 mid freq 0–27, +5 mid Q 0–5, +6 mid gain, +7 high gain (±24), +8 high cut 0–14, +9 level (±24) |
| `3E 00` | SOLO_DELAY | 14 | **KATANA Artist only, not used by the KATANA-100.** +0 on/off, +1 carry-over 0/1, +2…5 time `u4x4` 1–2000 ms, +6 feedback, +7 effect level 0–120, +8 direct level, +9 filter 0–2, +10 high cut 0–14, +11 mod on/off, +12 mod rate, +13 mod depth |
| `42 00` … `46 00` + 0 | CONTOUR(1–3) | 1 | contour type 0–3 |
| `48 00` | PEDALFX_COM | 3 | +0 position 0/1, +1 on/off, +2 type 0–2 |
| `4A 00` | PEDALFX | 15 | pedal wah (+0 wah type 0–5, +1 pedal position, +2 min, +3 max, +4 effect level, +5 direct mix), pedal bend (+6 pitch ±24, +7 pedal position, +8 effect level, +9 direct mix), wah 95E (+10 pedal position, +11 min, +12 max, +13 effect level, +14 direct mix) |
| `4C 00`, `4E 00` | EQ_EACH(1, 2) | 3 | EQ 1 / EQ 2: +0 position 0/1 (before/after the amp), +1 on/off, +2 type 0 parametric, 1 graphic |
| `50 00`, `52 00` | EQ_PEQ(1, 2) | 11 | +0 low cut 0–17, +1 low gain (±20), +2 low-mid freq 0–27, +3 low-mid Q 0–5, +4 low-mid gain, +5 high-mid freq, +6 high-mid Q, +7 high-mid gain, +8 high gain, +9 high cut 0–14, +10 level (all gains ±20, raw = shown + 20) |
| `54 00`, `56 00` | EQ_GE10(1, 2) | 11 | 31 Hz … 16 kHz and level, ±24 (raw = shown + 24) |
| `5A 00` | SENDRETURN | 5 | +0 on/off, +1 position 0–2, +2 mode 0/1, +3 send level, +4 return level |

**Chain:** BOSS Tone Studio builds the order from five values: the chain variant (`02 00` + 0, 0–8), the pedal FX
position (`48 00` + 0), the send/return position (`5A 00` + 1) and the two EQ positions (`4C 00` + 0, `4E 00` +
0). The variant sets where booster, mod, FX and Delay 1 sit relative to the amp (9 orders, e.g. variant 2:
booster, mod, FX, amp); the positions place pedal FX, send/return and the EQs. Our own table of the orders goes
into `src/model/`. [D]

Type ranges (by analysis, 2026-11-16, consistent with every stored slot in the captures): booster 0–22, mod and FX
0–30 (one list), delay 0–7, reverb 0–4, amp type 0–5. The names are in our own tables in `src/model/params.ts`.

**Inside a variation block** (booster, delay, reverb; offsets from the block of the active variation, byte 0 =
type). From local analysis of BOSS Tone Studio (2026-11-16): layout and ranges from its address map, which knob
shows for which type from its effect pages. Every value in every capture lies in these ranges. **[C 2026-11-16]** for variation 0 of each effect except reverb layer mode ([D]): written unattended, read back, no other byte of the patch changed, the whole patch as before after restoring. The bytes of other types were written too (`-AllTypes`), since they exist whatever the type. Nobody listened; that a byte means what its name says rests on the layout of BOSS Tone Studio and on the knob reports of Q3 (`0A 01`, `0A 06`, `28 05`, `28 07`, `34 0A` match drive, effect level, feedback, effect level, effect level).
Ranges are raw values; "shown" is raw minus the offset.

| Block | Byte | Parameter | Raw range | Shown / notes |
|---|---|---|---|---|
| booster | 1 | drive | 0–120 | |
| booster | 2, 3 | bottom, tone | 0–100 | −50…+50 (raw = shown + 50) |
| booster | 4 | solo switch | 0/1 | |
| booster | 5, 6, 7 | solo level, effect level, direct mix | 0–100 | |
| delay | 1–4 | time | `u4x4` 1–2000 | ms |
| delay | 5 | feedback | 0–100 | |
| delay | 6 | high cut | 0–14 | 630 Hz … 12.5 kHz, 14 = flat; not on the SDE-3000 page |
| delay | 7 | effect level | 0–120 | |
| delay | 8 | direct mix | 0–100 | "direct level" in the address map |
| delay | 9 | tap time | 0–100 | %; PAN only |
| delay | 10, 11 | mod rate, mod depth | 0–100 | MODULATE and SDE-3000 |
| delay | 12 | range | 0/1 | 8 kHz / 17 kHz; called LPF in the address map; SDE-3000 only |
| delay | 13 | filter | 0/1 | SDE-3000 only |
| delay | 14, 15 | feedback phase, delay phase | 0/1 | normal / inverse; SDE-3000 only |
| delay | 16 | mod switch | 0/1 | SDE-3000 only |
| reverb | 1 | layer mode | 0–2 | Delay 2 / both / reverb (Phase 2) |
| reverb | 2 | time | 0–99 | shown 1–100 (raw = shown − 1); unit unverified |
| reverb | 3–6 | pre delay | `u4x4` 0–500 | ms |
| reverb | 7 | low cut | 0–17 | 0 = flat, then 20 Hz … 800 Hz |
| reverb | 8 | high cut | 0–14 | as delay |
| reverb | 9 | density | 0–10 | |
| reverb | 10, 11 | effect level, direct mix | 0–100 | |
| reverb | 12 | spring color | 0–100 | SPRING only |

**Assigns** (Phase 3; local analysis of BOSS Tone Studio, 2026-11-17). Each assign block has one field per
effect: booster, delay, reverb, then the 31 mod/FX types (34 fields). The target field picks a parameter of that
effect; 0 is "Preset" (0–100), the others are the effect's own knobs. Min and max store the raw value of the
target in a wider field of their own (`u7` 0–127, `u4x4` for times: delay 0–2000, reverb 0–500 ms, …; 49 bytes
per min or max block). Every stored slot in every capture holds the same factory state: expression pedal
function 3 (Pedal FX/FV), all targets 0, all minimums 0, maximums 127 (or the largest time), GA-FC switches
`68 00` = 0, 4, 1 and `6A 00` = 2, 6, 5. Expression functions: 0 Volume, 1 Foot Volume, 2 Pedal FX, 3 Pedal
FX/FV, 4 Booster, 5 Mod, 6 FX, 7 Delay, 8 Delay 2, 9 Reverb.

Schema probe **[C 2026-11-17]** (`katana-probe.ps1 -ParamTest -NoAsk -Status D -Only '^assign\.'`, PC, current
patch only, no PATCH_WRITE, after a complete backup; `captures/param-test-20261117-171042.json`, `…171057.json`):
expression function `5E 00` + 0, delay target `60 00` + 1, delay min `62 00` + 1…4 and delay max `64 00` + 1…4
(`u4x4`) were written, read back, changed no other byte and were restored. Two findings:

- **The amp stores min/max raw, without checking the target range**: with the delay target set to feedback
  (0–100) a max of 1800 read back as 1800. The app must clamp to the target's range itself.
- **Changing the target does not touch min/max** (target 0 → 1: no other byte changed). BOSS Tone Studio sets
  min/max to the full range of the new target in that case; the app has to do the same.

Not checked yet: what the amp does with a value beyond the target range (e.g. the factory max 127 with target
Preset 0–100); this needs a pedal and listening.

| Block | `.tsl` name | Bytes | Content |
|---|---|---|---|
| `5C 00` | ASSIGN_KNOBS | 34 | target of the effect knob on the amp, one field per effect (booster, delay, reverb, 31 mod/FX types) |
| `5E 00` | ASSIGN_EXPPDL_FUNC | 1 | expression pedal on the amp: function 0–9 |
| `60 00` | ASSIGN_EXPPDL_DETAIL | 34 | its target per field |
| `62 00`, `64 00` | ASSIGN_EXPPDL_MIN / MAX | 49 each | its min/max per field: booster +0, delay +1…4, reverb +5…8, the 22 types chorus … octave +9…30, pitch shifter +31…34, harmonist +35…38, humanizer, phaser 90E, flanger 117E, wah 95E +39…42, DC-30 +43…46, heavy octave +47, pedal bend +48 |
| `66 00` | ASSIGN_FS | 2 | footswitch on the amp, tip and ring: 0 CH 1/2, 1 BANK A/B, 2 SOLO ON/OFF |
| `68 00` | ASSIGN_GAFCFS(1) | 3 | GA-FC FS1–3: 0 BANK A/B, 1 PEDAL FX, 2 SEND/RETURN, 3 EQ, 4 DELAY TAP, 5 DELAY2 TAP, 6 BOOSTER SOLO, 7 SOLO, 8 GLOBAL EQ, 9 EQ2 (each "ON/OFF" except the taps; BOSS Tone Studio lists 9 after 3) |
| `6C 00`, `70 00`, `74 00`, `78 00` | ASSIGN_GAFCEXPPDL1_FUNC/DETAIL/MIN/MAX(1) | 1, 34, 49, 49 | GA-FC EXP 1, same layout as the pedal on the amp |
| `7C 00`, `01 00 00`, `01 04 00`, `01 08 00` | …EXPPDL2…(1) | | GA-FC EXP 2 |
| `01 0C 00`, `01 10 00`, `01 14 00`, `01 18 00` | …EXPPDL3…(1) | | GA-FC EXP 3 |
| `6A 00`, `6E 00`, `72 00`, `76 00`, `7A 00`, `7E 00`, `01 02 00` … `01 1A 00` (every second block) | the same names with (2) | | not used by BOSS Tone Studio for the Gen 3 (only its MkII code refers to them); not in our list, kept raw. Open: what the amp uses them for (the factory values of `6A 00` differ from `68 00`) [O] |

**All 451 addresses [C 2026-11-17]** (`katana-probe.ps1 -ParamTest -NoAsk -Status D -Only '^assign.'`, PC,
current patch only, no PATCH_WRITE; `captures/param-test-20261117-174139.json`): the 447 not yet checked by
the schema probe were written, read back, changed no other byte and were restored; the whole patch was as
before after each one. Nobody listened (no pedal plugged in); the meaning rests on the layout.

**The GA-FC on the amp** [C 2026-11-17] (the original GA-FC: six footswitches, two EXP PEDAL jacks, no pedal
plugged in; `katana-probe.ps1 -EditorMode 1 -Listen 150`, read-only, capture `katana-probe-20261117-181446.json`).
The owner pressed the switches in a fixed order; with editor mode on the amp reported every action as usual:

| On the GA-FC | Reported by the amp |
|---|---|
| 1–4 | patch number 1–4 (channels of the current bank), followed by the patch as after a channel change on the amp |
| PANEL | patch number 0 (Panel); also one block of the TEMP area (`30 00 02 00`, 5 bytes) |
| EFFECT short | nothing; switches the GA-FC to effect mode |
| in effect mode 1, 2, 3, 4, PANEL | switch bytes `08 00` + 0, 1, 2, 3, 5 (booster, mod, FX, delay, reverb) and the colour status `7F 01 01 0n`; changes of the current patch (unsaved), not of a stored slot. One press on 4 toggled the delay three times within 0.1 s (bounce or tap; not repeated) |
| EFFECT short again | nothing; back to channel mode |
| EFFECT held, then 1–4 | solo `3A 00` + 0 toggled (three reports for four presses) |
| PANEL held | patch number 5 (bank A → B) |

SYSTEM was the same before and after; the assign blocks did not change. The SYSTEM block `10 00 22 00` (GA-FC
functions SW1–4 and PANEL, same table of ten functions as the patch's GA-FC FS1–3) reads `07 07 07 07 07` =
SOLO ON/OFF on this amp, which fits the solo reports after holding EFFECT: holding EFFECT selects the function
mode, and the functions there come from SYSTEM (system-wide), not from the patch. What the patch's GA-FC FS1–3
(`68 00`) do with the original GA-FC was not seen; they may belong to the GA-FC EX. [D]

Our list (`src/model/assigns.ts`, 451 parameters) was compared entry by entry with the address map of BOSS Tone
Studio for instance (1): same offset, size and range for all 451, none missing. Two details from the analysis:

- The function Delay 2 of an expression input uses the delay field.
- BOSS Tone Studio's own assign page keeps a second table of min/max positions per type; it agrees with the
  address map up to the harmonist and is off for humanizer … pedal bend (e.g. heavy octave and pedal bend both at
  +41, which is flanger 117E). The address map fits the factory values in every capture (pitch shifter and
  harmonist max 300 ms at +31 and +35, DC-30 max 600 at +43), so our list follows the address map.

**Checking a [D] address on the amp:** `npm run params:export` writes our parameter list from `src/model` to
`tools/param-list.json` (generated, git-ignored; since Phase 2, before that the probe had its own copy).
`tools/katana-probe.ps1 -ParamTest` (optionally `-Only <regex>`, `-Status D`, `-Set 'key=value'` to set patch
parameters first and restore them at the end, `-WholeBlock` to write each value as a DT1 of its whole block)
goes through that list in the current patch: read, write a nearby value, read back, ask whether the change was heard or
seen, write the original value back and read again. Variation parameters use the active variation. Results go to
`captures/param-test-<time>.json`. The app writes only parameters marked [C] (`writable()` in
`src/model/schema.ts`), so every address passes this check before the app can change it.

### 2.9 Editor handshake and commands

Handshake the app will use (the order BOSS Tone Studio uses for the Gen 3): identity request, take the device ID,
check the model code (`06`), RQ1 editor level (expect `1`), DT1 editor mode on. [D] as a sequence; single steps:

| Address | Name (working label) | Use | Status |
|---|---|---|---|
| `7F 00 00 00` | editor level | RQ1, 1 byte; the amp answers `01` | [C 2026-11-15] |
| `7F 00 00 01` | editor mode | DT1 `01` = on, `00` = off; not acknowledged, reads back by RQ1 size 1. **Required** for any report from the amp | [C 2026-11-15], Q8 |
| `7F 00 00 02` | running mode | not used for the Gen 3 | [D] |
| `7F 00 00 03` | revision | not used for the Gen 3 | [D] |
| `7F 00 01 00` | PATCH_SELECT | DT1 with the patch index | [C 2026-11-15] for indexes 1–8, data `00 0n`; see Q6 for what the amp reports back |
| `7F 00 01 04` | PATCH_WRITE | DT1 `00 nn` saves the current patch into slot index `nn` (BOSS Tone Studio sends `00` + the index as one byte; for 1–8 the same as two nibbles), acknowledged by a DT1 at the same address; saving **on the amp** is reported here too | [C 2026-11-15] as a report (Q2); **[C 2026-11-17]** sent from the PC onto the current channel B4: acknowledged, slot verified (2.15). Saving onto another index than the current one is [D] and never done by us |
| `7F 01 01 01` … `05` | five status bytes | reported on every patch change, save and colour change: colour of BOOSTER, MOD, FX, DELAY, REVERB (0–2), `03` = off | [C 2026-11-15], Q3 |
| `7F 00 01 0E` | PATCH_CLEAR | clear a patch | [D], never sent |
| `7F 01 01 09` | PREVIEW_MUTE | 1 byte; BOSS Tone Studio sends `01` before EXPORT, `00` after a preview | [D] from BOSS Tone Studio, never sent; Q5 |
| `7F 01 01 0A` | EXPORT | 2 bytes; BOSS Tone Studio sends `40 nn` after saving into `nn` (`7F 7F` after writing many slots) and waits for a DT1 reply there | [D] from BOSS Tone Studio, never sent; saving works without it (2.15), Q5 |

- **Reading works without editor mode**: identity, patch name, patch number and editor level were all answered
  without switching it on. [C 2026-11-15]
- The command area answers **single reads only** (size 1); a range RQ1 over it gets no reply. [C 2026-11-15]
- Sign-off (editor mode off) cannot be guaranteed on Android, so "editor mode stays on" is the normal case; as
  far as seen it is harmless. [C 2026-11-15], Q8
- With editor mode on, a patch change on the amp is reported by a DT1 at `00 00 00 00` (patch number), saving on
  the amp by a DT1 at PATCH_WRITE, knobs by DT1 at their parameter address. With editor mode off nothing is
  reported. [C 2026-11-15], Q1–Q3 and Q8.

### 2.10 Measured timings (PC, BOSS driver, 2026-11-15, read-only)

All [C 2026-11-15]. On the phone the full patch took 0.284 s (section 3).

| Measurement | Result |
|---|---|
| Reply time of a small request | about 3–5 ms |
| Full current patch, one RQ1 (`20 00 00 00`, size `00 02 00 00`) | 80 DT1, 2649 data bytes, 0.27 s |
| All ten stored slots, one RQ1 (`20 10 00 00`, size `01 20 00 00`) | 800 DT1, 26 490 data bytes, 2.7 s |
| SYSTEM, one RQ1 (`10 00 00 00`) | 21 DT1, 131 data bytes, 23 ms |
| Longest message | 238 bytes |

Send pacing: BOSS Tone Studio waits 20 ms plus message length ÷ 3.125 ms between messages [D]. **The amp does not
need this for small messages** [C 2026-11-15], see 2.13. BOSS Tone Studio itself reads block by block (one RQ1 per
block, at most 128 bytes, 15 s timeout) and waits 500 ms after a patch change before reading [D]; neither is
required for reading, as the range reads above show.

### 2.11 Behaviour notes

- **One RQ1 can span many blocks.** The amp answers with one DT1 per block and skips the gaps between blocks.
  There is no end marker. [C 2026-11-15]
- **Block order:** once not strictly ascending (first run: contour blocks and two SYSTEM blocks swapped); in every
  later run on PC and phone ascending. Replies are still matched by address, not by order. [C 2026-11-15]
- **Unsolicited messages come from editor mode.** The name/NS/gain blocks seen in the middle of a request in the
  first run were reports of editor mode, left on by an earlier session (the probe later read the editor mode byte
  as `01` without having written it). With editor mode off the amp sends nothing by itself. [C 2026-11-15], Q4/Q8
- Consequence for tools: an unsolicited DT1 whose address lies inside the range of the outstanding RQ1 cannot be
  told apart from a reply. The capture tool counts it as a reply and lists addresses that arrive twice as
  "duplicates".
- Knobs on the amp are reported live with editor mode on [C 2026-11-15] Q3. Re-reading on return to the
  foreground stays as a safety net.
- Traffic of BOSS Tone Studio itself cannot be captured: the port is exclusive, and USBPcap/Wireshark only showed
  descriptors. [C 2026-11-14]

### 2.12 Block table of a patch (probe run 2026-11-15)

Read with `tools/katana-probe.ps1` (read-only, winmm on the port "KATANA3"). [C 2026-11-15]

A patch has **80 blocks** with 2649 data bytes. Blocks start every `00 02 00` (256 linear) from the patch base;
the last one is at `+01 1E 00`. All ten stored slots have the same 80 blocks. Second run confirmed the timings in
2.10 (266 ms per patch, 2656 ms for all slots, 23 ms for SYSTEM, 3 ms for a small read). In this run the order
was ascending in every reply and nothing arrived unsolicited (see Q4).

Offset of the block (7-bit, relative to the patch base) and its length in bytes:

| Offsets | Length |
|---|---|
| `00 00` | 16 (name) |
| `02 00` | 3 |
| `04 00` | 5 |
| `06 00` | 10 (amp) |
| `08 00` | 6 |
| `0A 00`, `0C 00`, `0E 00` | 8 each |
| `10 00` … `1A 00` (6 blocks) | 1 each |
| `1C 00` … `26 00` (6 blocks) | 225 each |
| `28 00` … `32 00` (6 blocks) | 17 each |
| `34 00`, `36 00`, `38 00` | 13 each |
| `3A 00` | 2 |
| `3C 00` | 10 |
| `3E 00` | 14 |
| `40 00` | 1 |
| `42 00`, `44 00`, `46 00` | 2 each |
| `48 00` | 3 |
| `4A 00` | 15 |
| `4C 00`, `4E 00` | 3 each |
| `50 00` … `56 00` (4 blocks) | 11 each |
| `58 00` | 3 (NS) |
| `5A 00` | 5 |
| `5C 00` | 34 |
| `5E 00` | 1 |
| `60 00` | 34 |
| `62 00`, `64 00` | 49 each |
| `66 00` | 2 |
| `68 00`, `6A 00` | 3 each |
| `6C 00`, `6E 00` | 1 each |
| `70 00`, `72 00` | 34 each |
| `74 00` … `7A 00` (4 blocks) | 49 each |
| `7C 00`, `7E 00` | 1 each |
| `01 00 00`, `01 02 00` | 34 each |
| `01 04 00` … `01 0A 00` (4 blocks) | 49 each |
| `01 0C 00`, `01 0E 00` | 1 each |
| `01 10 00`, `01 12 00` | 34 each |
| `01 14 00` … `01 1A 00` (4 blocks) | 49 each |
| `01 1C 00` | 5 |
| `01 1E 00` | 1 |

Checked 2026-11-16 against every capture in `captures/` (`tests/local/captures.test.ts`): each recorded range
request was answered with exactly the blocks of this table (and of the SYSTEM table below), and the app's send
queue completes each of them when the capture is replayed. [C 2026-11-16]

This table is what "a range request is complete when all expected block addresses have arrived" (PLAN 4.2) needs,
and it is the block table for backups (PLAN 4.6). What the blocks mean: see 2.8 (name, colours, amp, switches and
NS confirmed; the variation blocks of the five effects derived). In the code each block has a stable key, its
offset as three hex digits (`000600` for the amp block, `011E00` for the last one).

Other areas: SYSTEM has 21 blocks at `10 00 00 00` … `10 00 28 00` (every `02 00`, block `10 00 2A 00` onward
absent). Their lengths in order (from capture `katana-probe-20261115-181535.json`, 131 bytes in total):
1, 5, 2, 2, 2, 2, 11, 11, 11, 11, 11, 11, 3, 5, 5, 3, 1, 5, 1, 19, 9. [C 2026-11-15] The setup area answers a range read with a single block `00 00 00 00` = 2 bytes (patch number as two
nibbles, `00 08` for B4). `21 30 00 00` does not answer. TEMP `30 00 00 00` has three blocks (1, 5, 1 bytes).

### 2.13 Writes: echo and send pacing (2026-11-15)

`tools/katana-probe.ps1 -WriteTest`, PC, winmm through the BOSS driver. Only the NS threshold of the current patch
(`20 00 58 01`) was written, around its value 40, and restored afterwards. Run once with editor mode off (capture
`katana-probe-20261115-232749.json`) and once with editor mode on (`…232824.json`); the results were the same.

| Test | Result |
|---|---|
| **Echo of our own DT1** (three writes, listen 800 ms each) | **No echo**, not a single message, with editor mode off **and on**. The value reads back as written. (Commands are different: PATCH_SELECT is echoed, see Q6.) [C 2026-11-15] |
| 20 DT1 in a burst at 20 / 10 / 5 / 2 / 0 ms gap, then read back | Last value stuck every time, no error, nothing sent by the amp. At "0 ms" the driver needed about 1 ms per message (20 DT1 in 20 ms). [C 2026-11-15] |
| DT1 immediately followed by RQ1, 10 rounds | 10 of 10 reads returned the value just written, reply after 4–5 ms. [C 2026-11-15] |
| 20 pairs DT1 + RQ1 without any wait (40 messages in 46 ms) | All 20 replies arrived, **but late**: the first came after about 4 ms, the other 19 only once the burst was over (49–62 ms), all carrying the final value. The amp keeps taking messages while busy and answers queued RQ1 afterwards with the state at answer time. Nothing was lost. [C 2026-11-15] |
| 30 small RQ1 back to back | 30 of 30 replies, the last after 39 ms. [C 2026-11-15] |
| 5 full-patch RQ1 back to back | 400 of 400 DT1 (5 × 80 blocks), done after 1.33 s (5 × 0.27 s). [C 2026-11-15] |

**Decisions:**
- No echo, so rule 2 of PLAN 4.5 is not needed against echoes. The amp also does not acknowledge a parameter write;
  a write is only verified by reading it back.
- The 20 ms gap of BOSS Tone Studio is not needed for small DT1 and RQ1. The queue sends at once and coalesces
  slider values per address; a slider naturally produces one value every 16–30 ms.
- A reply describes the state at the moment the amp answers, not when the request was sent.
- ~~Not tested: large DT1~~ measured 2026-11-17, see below. The same bursts over the phone's bulk endpoint
  (which may be faster than the PC driver) are still to repeat once (test plan 1c).

**Large DT1** (`katana-probe.ps1 -BlockTest -NoAsk`, 2026-11-17, PC, editor mode off, current patch B4 only;
`captures/block-test-20261117-121657.json`, `katana-probe-20261117-121657.json`):

| Test | Result |
|---|---|
| One DT1 with 225 data bytes (block `1C 00` written back unchanged) | accepted, nothing sent by the amp, all 80 blocks unchanged. [C 2026-11-17] |
| All 78 writable blocks (2643 data bytes) written back unchanged as a burst **without any gap** | sent in 155 ms, nothing sent by the amp; a range read right after it returned all 80 blocks unchanged. [C 2026-11-17] |
| The same with the BOSS Tone Studio gap (20 ms + length / 3.125 ms after each DT1 over 16 bytes) | 1736 ms, same result. [C 2026-11-17] |
| A real change inside a whole-block DT1: delay feedback 22 → 23 (17-byte block, variation 0) and byte 183 of block `1C 00` 43 → 44 (225 bytes) | read back as written, **only that byte** of the patch changed; writing the original block restored the patch exactly. [C 2026-11-17] |

**Decision:** the BOSS Tone Studio gap is not needed for large DT1 either. The queue sends whole blocks without a
gap; a complete patch goes out in about 0.2 s on the PC.

### 2.15 Saving from the app: PATCH_WRITE (2026-11-17)

`katana-probe.ps1 -EditorMode 1 -SaveTest -SaveTo B4 [-SaveChange]`, PC, editor mode on, after a complete backup.
The tool saves only onto the current channel (A1–B4), only when told its name, and only when the current patch
equals the stored slot. Captures `save-test-20261117-121936.json`, `save-test-20261117-122125.json` and the
`katana-probe-…` captures of the same minute.

| Test | Result |
|---|---|
| PATCH_WRITE `00 08` (4 times) | acknowledged by DT1 `7F 00 01 04` = `00 08` after 1.6–2.1 ms, then **a second identical DT1** about 1.5 ms later; after about 86 ms the status burst `7F 01 01 01`…`05`, `01`…`04` as when saving on the amp (Q2). No patch number. [C 2026-11-17] |
| Slot afterwards | equal to the current patch in 80 of 80 blocks; current patch and patch number unchanged. [C 2026-11-17] |
| Real change: NS threshold 40 → 41 in the current patch, PATCH_WRITE; then 41 → 40, PATCH_WRITE | each time the slot held exactly the current patch; at the end all ten slots (800 blocks) were as before. [C 2026-11-17] |
| PREVIEW_MUTE and EXPORT | not sent; saving worked without them. [C 2026-11-17] |

Not measured: PATCH_WRITE with editor mode off (the app always has it on; the acknowledgement may then be missing,
Q8), and on the phone.

**Decisions for the app:** after PATCH_WRITE wait for the first DT1 at `7F 00 01 04` with the saved index
(timeout 2 s) and ignore the second, then read the slot back and compare all 80 blocks with the patch at the time
of saving. PATCH_WRITE only with the current channel's index; the queue refuses index 0 (Panel) and 9 (PREVIEW)
even when PATCH_WRITE is allowed.

### 2.14 The .tsl file of BOSS Tone Studio (Gen 3)

From local analysis of BOSS Tone Studio (2026-11-16). **[C 2026-11-16]**: BOSS Tone Studio imported our export
("A1–B4 as .tsl" from v0.2.0, eight patches) into its librarian (test plan 1a, section 4).

- JSON: `{ "name", "formatRev": "0000", "device": "KATANA Gen3", "data": [[ entry, … ]] }`, one entry per patch,
  `{ "memo": { "memo": "", "isToneCentralPatch": false }, "paramSet": { "PATCH%COM": ["4B", …], … } }`.
- `paramSet` holds every block of the patch under its name, as an array of two-digit hex strings (one per byte).
  The 80 names map one to one onto the block table of 2.12 (same offsets, same order): `PATCH%COM` = `00 00`
  (name), `PATCH%AMP` = `06 00`, `PATCH%NS` = `58 00`, … , `PATCH%PATCH_KNOB_SOLO_DELAY_READONLY` = `01 1E 00`.
  Our table of names is in `src/storage/tsl.ts`.
- On import BOSS Tone Studio fills blocks missing from a file with defaults and accepts other devices only through
  its converter.

## 3. USB transport (Phase 0a, measured 2026-11-15 on the Nothing Phone (3a) Pro, Android API 37)

**Result: the phone talks to the amp through the test APK.** Chrome (WebUSB) can open the device and read its
descriptors but cannot claim the MIDI interface; the Android USB host API with `force` can.

| Item | Value | Source |
|---|---|---|
| Device | VID `0582` PID `02F0`, class `FF/00/FF`, USB 2.0, one configuration, 4 interfaces, self-powered (maxPower 0 mA) | WebUSB + APK |
| Interface 0 | class `FF/FF/00`, no endpoints | both |
| Interface 1 | class `FF/02/02`, alt 1: isochronous OUT `0x0D` (audio to the amp) | both |
| Interface 2 | class `FF/02/01`, alt 1: isochronous IN `0x8E` (audio from the amp) | both |
| **MIDI interface** | **interface 3**, class `FF/03/00`, carries the Roland descriptor `06 24 F1 02 01 01` | both |
| Alternate setting used | **alt 0** (bulk). Alt 1 offers the same OUT `0x03` plus IN `0x85` as interrupt endpoints; not needed, not tested | APK |
| OUT endpoint | `0x03`, bulk, max packet 512 | APK |
| IN endpoint | `0x84`, bulk, max packet 512 | APK |
| Cable number | **0** in both directions | APK |
| Packet format | **standard 4-byte USB-MIDI event packets confirmed** (CIN 4 / 5 / 6 / 7 for SysEx). The unused bytes of a short final packet are **not** zeroed by the amp (they repeat earlier data); harmless, because the CIN gives the length | APK |
| Several packets per transfer | yes, e.g. 40 bytes = 10 packets for the patch name; 124 transfers for a full patch | APK |
| Web MIDI in Chrome on the phone | not tried separately (the device is vendor class, see WebUSB) | |
| WebUSB in Chrome | `device.open()` ok, descriptors readable, `claimInterface(3)` fails with `NetworkError: Unable to claim interface` (three attempts). The kernel driver holds the interface | WebUSB |
| Test APK | permission dialog once, `claimInterface(force)` true, `setInterface(alt 0)` true | APK |
| Identity reply | `F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7`, 18 ms after the request | APK |
| Reads | editor level `01`, patch number `00 01`, patch name "COMP CLEAN", gain/volume, NS threshold; 8–22 ms each | APK |
| NS threshold written | DT1 `20 00 58 01` sent while dragging, about every 32 ms, no send errors. **Audible, confirmed by the owner** | APK |
| Full patch read on the phone | **80 DT1, 2649 data bytes, 0.284 s**, ascending, no duplicates (PC: 0.27 s). One-shot reading stays (PLAN 4.5 rule 4) | APK |
| Auto-start of the real app (2026-11-16) | plugging in opens Katana Studio through `USB_DEVICE_ATTACHED` (`singleTask`), the plugin sees the amp with permission about 0.5 s after the start. With the test APK installed too, Android first asks which app to use ("just once" / "always"); after "always" it opens Katana Studio directly. On a cold start the attach intent reaches the plugin twice (once in `load()`, once from Capacitor); the plugin drops the duplicate | app |
| First read and write by the real app (2026-11-16) | after plugging in, the app greeted the amp, showed "Connected, KATANA-100", read the NS threshold of the current patch correctly (40) and wrote it with the slider (one DT1 = 20 bytes in five USB-MIDI packets per value, no send error); the change was audible, confirmed by the owner | app |
| OTG stable for 15 minutes, OTG setting | open | |
| Battery drain per hour | open | |
| Hum or noise through the cable | open | |
| Phone notification sounds through the amp | open (the amp exposes audio interfaces 1 and 2, so Android may route sound to it) | |

Consequences for the app (PLAN 4.2): the Kotlin plugin is needed (no WebUSB, no Web MIDI route). Claim interface
3 with force, alternate setting 0, bulk endpoints `0x03` / `0x84`, cable 0. The auto-pick rule of the test plugin
(vendor class, IN and OUT bulk or interrupt, no isochronous endpoint) chose correctly.

Raw descriptors (206 bytes, device descriptor followed by the configuration):

```
0000: 12 01 00 02 FF 00 FF 40 82 05 F0 02 00 01 01 02
0010: 00 01 09 02 BC 00 04 01 00 C0 00 09 04 00 00 00
0020: FF FF 00 00 09 04 01 00 00 FF 02 02 00 06 24 F1
0030: 01 00 00 09 04 01 01 01 FF 02 02 00 07 24 01 01
0040: 00 03 00 0B 24 02 01 04 04 20 01 80 BB 00 06 24
0050: F1 04 16 00 07 05 0D 05 84 00 01 07 25 01 00 00
0060: 00 00 09 04 02 00 00 FF 02 01 00 09 04 02 01 01
0070: FF 02 01 00 07 24 01 07 00 03 00 0B 24 02 01 04
0080: 04 20 01 80 BB 00 06 24 F1 04 16 00 07 05 8E 25
0090: 84 00 01 07 25 01 00 00 00 00 09 04 03 00 02 FF
00A0: 03 00 00 06 24 F1 02 01 01 07 05 03 02 00 02 01
00B0: 07 05 84 02 00 02 00 09 04 03 01 02 FF 03 00 00
00C0: 07 05 03 03 00 02 04 07 05 85 03 00 02 04
```

## 4. How to run an experiment

1. Start the static server for `testpages/` and open `http://localhost:8080/capture/` in Chrome. Close BOSS Tone Studio.
2. Connect. The tool only sends an identity request; it never switches editor mode by itself.
3. Press "Start" at the experiment in the checklist panel, set markers for everything you do on the amp, press "End".
4. Type what you saw into the notes field, then "Download JSON" and move the file into `captures/` (git-ignored;
   captures may contain personal patch data).
5. Copy the result and the decision into the "Result / decision" field below, with the date and the capture file name.

Experiments marked "write" need the full backup with BOSS Tone Studio first (PLAN, "Phase 0 on the PC").

## 5. Open questions

### Q1: Patch change on the amp: is it reported?

- **Expectation [D]:** DT1 at `00 00 00 00` with the new patch number (`u2x4`).
- **Procedure (read-only):** Connect, send nothing. Before each press set the preset marker "Pressed a channel
  button on the amp", then select A1 … A4, B1 … B4 and PANEL one after another, a few seconds apart.
  Repeat the series with editor mode on (write section) once Q8 has started.
- **Record:** Is there an unsolicited DT1 for every press? Address, data, delay after the marker. What else arrives
  with it (name, other blocks)? Any difference between editor mode off and on? Does pressing the channel that is
  already active send anything?
- **Result / decision:** *2026-11-15, `katana-probe.ps1 -Listen` (capture `katana-probe-20261115-182715.json`),
  editor mode byte `01`:* **Yes, the amp reports every channel change by itself.** Seven presses on the amp (A4, A1,
  B1, B4, PANEL, B3, B2) each produced the same burst within about 100 ms: DT1 `7F 01 01 01`…`05` (five status
  bytes), `7F 01 01 01`…`04` again, then DT1 `00 00 00 00` = `00 0n` with the new patch number about 85 ms after
  the first message. PANEL reports patch number `00 00` and additionally DT1 `30 00 02 00` with 5 bytes (the
  positions of the five effect knobs, see Q3). Unlike a PATCH_SELECT from the PC there is no echo at `7F 00 01 00`
  and the patch number comes once, at the end. The patch content itself is **not** sent; the app must read it.
  **Decision:** treat DT1 `00 00 00 00` as the patch-change signal (PLAN 4.5 rule 3 stands). Still open: the same
  with editor mode off.

### Q2: Saving on the amp: is PATCH_WRITE reported?

- **Expectation [D]:** DT1 at `7F 00 01 04`.
- **Procedure (no write from the PC, but the amp overwrites one of its channels):** BOSS Tone Studio backup first.
  Pick a channel you can spare. "Take snapshot A", change one knob, save to the channel on the amp, marker "Saved on
  the amp". Then "Verify mapping for the current channel". Repeat with editor mode on.
- **Record:** Unsolicited messages after saving: address, data (which index encoding?), order. Are current patch
  and stored slot identical afterwards? Difference between editor mode off and on.
- **Result / decision:** *2026-11-15, `katana-probe.ps1 -Listen` (capture `katana-probe-20261115-183203.json`),
  editor mode on:* **Yes.** Holding the B4 button to save produced DT1 `7F 00 01 04` = `00 08` (the patch index as
  two nibbles), followed about 90 ms later by the usual status burst `7F 01 01 01`…`05` and `01`…`04`; no patch
  number message. The channel was saved unchanged onto itself, so the content comparison after saving a real
  change is still to do. With editor mode off nothing is reported (Q8).

  ***2026-11-15, save with a real change (captures `katana-probe-20261115-234350.json`, `…234423.json`):*** on B4,
  GAIN turned from 46 to 89 (reported live at `20 00 06 00`), then saved by holding B4. Same reports as above
  (`7F 00 01 04` = `00 08`, then the status burst). Afterwards current patch and slot `21 10 00 00` are identical
  in 80 of 80 blocks, and the slot holds the new gain (`21 10 06 00` = `59`). **Saving on the amp copies the
  current patch into the slot of the current channel.** [C 2026-11-15]

  ***2026-11-17, PATCH_WRITE sent from the PC*** (2.15): the same reports, plus the acknowledgement at
  `7F 00 01 04` arriving twice within 4 ms. [C 2026-11-17]

### Q3: Knobs and buttons on the amp: reported or not, which addresses?

- **Procedure (read-only):** "Take snapshot A", marker with the name of the control, move exactly one control,
  "Take snapshot B and diff". The table shows every changed address and whether an unsolicited DT1 carried the new
  value. Go through every knob and button of the panel one at a time, starting with GAIN and VOLUME. Use the
  SYSTEM range for controls that are not part of a patch. Repeat a few with editor mode on.
- **Record:** Per control: changed address(es), value range seen, reported (yes/no), and whether the report comes
  while turning or only at the end. Controls that change nothing readable.
- **Result / decision:** (decides rule 5 in PLAN 4.5: is re-reading needed, and when)
  *2026-11-15, `katana-probe.ps1 -Listen` (capture `katana-probe-20261115-182816.json`), editor mode byte `01`:*
  **Yes, the amp reports its knobs live**, one DT1 per value about every 50 ms while turning, 431 messages in the
  run. Every byte that differed between the snapshots before and after had been reported; nothing changed silently.

  | Control (order turned) | Reported addresses |
  |---|---|
  | GAIN, VOLUME, BASS, MIDDLE, TREBLE | `20 00 06 00` … `20 00 06 04`, one byte each, 0–100 |
  | PRESENCE (assumed, sixth amp knob) | `20 00 06 05` |
  | Five effect knobs | each one reports a group, see below |

  Each effect knob reports, with knob index k = 0…4: its position at `30 00 02 0k` (TEMP area) and at
  `20 01 1C 0k` (last 5-byte block of the patch), the status byte `7F 01 01 0(k+1)`, the on/off switch at
  `20 00 08 0k` (turning a knob to zero switched it to `00`), and one or more effect parameters:
  k=0 `20 00 0A 01` and `20 00 0A 06`; k=1 `20 00 1D 37` and `20 00 1D 3B`; k=2 `20 00 23 19`;
  k=3 `20 00 28 05`…`07` (3 bytes); k=4 `20 00 34 0A`. By the panel layout k = 0…4 should be Booster, Mod, FX,
  Delay, Reverb, which matches the five-entry colour block of PLAN 4.4, but which knob was turned when was not
  logged, so the **naming is unverified**. The status bytes `7F 01 01 01`…`05` take `03` when the effect is off
  and 0–2 otherwise (presumably the colour of the active variation).

  ***2026-11-15, one knob per run (captures `katana-probe-20261115-233135.json`, `…233312`, `…233340`, `…233409`,
  `…233438`), editor mode on:*** **naming confirmed**, k = 0…4 is BOOSTER, MOD, FX, DELAY, REVERB.

  | k | Knob | On/off switch | Parameters moved by the knob | Status byte |
  |---|---|---|---|---|
  | 0 | BOOSTER | `20 00 08 00` | `20 00 0A 01` (up), `20 00 0A 06` (down, 65 → 54) | `7F 01 01 01` |
  | 1 | MOD | `20 00 08 01` | `20 00 1D 37` and `20 00 1D 3B` (parallel, 10 apart) | `7F 01 01 02` |
  | 2 | FX | `20 00 08 02` | `20 00 23 19` | `7F 01 01 03` |
  | 3 | DELAY | `20 00 08 03` | `20 00 28 05` (down), `20 00 28 07` (up) | `7F 01 01 04` |
  | 4 | REVERB | **`20 00 08 05`** | `20 00 34 0A` | `7F 01 01 05` |

  Each knob also reports its position at `30 00 02 0k` and `20 01 1C 0k`. Turning a knob to zero switches the
  effect off (switch `00`, status byte `03`); turning it up from zero switches it on again. **Correction:** the
  reverb switch is `08 05`, not `08 04`; the switch block `20 00 08 00` has 6 bytes, and byte 4 is presumably the
  Delay 2 switch (Delay 2 hangs on the reverb variation, PLAN 4.4) [D].

  ***Effect buttons (captures `…233705` to `…233841` and `…234036` to `…234124`):*** a short press on the button
  of an effect that is **on** cycles its colour 0 → 1 → 2 → 0. The amp reports the colour block
  `20 00 04 0k` (5 bytes, one per effect in the order above) and the status byte `7F 01 01 0(k+1)` with the same
  value. On an effect that is **off** (dark LED) the button does nothing and nothing is reported. Holding the button
  reports nothing. **So the status bytes are confirmed: 0–2 = colour of the active variation, 3 = off.** [C 2026-11-15]

  **Decision:** with editor mode on, re-reading on return to the foreground is a safety net, not a necessity.
  Whether the amp reports the same with editor mode **off** is the open half of this question; if it does not,
  that is the reason to switch editor mode on.

| Control on the amp | Address | Reported, editor mode off | Reported, editor mode on | Notes |
|---|---|---|---|---|
| | | | | |

### Q4: What triggers the unsolicited messages?

- **Seen [C 2026-11-15]:** name, NS block and gain/volume of the current patch arrived in the middle of a request,
  without editor mode.
- **Procedure (read-only):** (a) Two minutes idle, nothing sent, nothing touched. (b) "Read full current patch"
  five times; note duplicates in the result line and UNSOLICITED lines in the log. (c) "Read all ten stored
  slots", then "Read current patch name". (d) Switch the channel on the amp and read the full patch at once.
  (e) Repeat (b) with editor mode on.
- **Record:** Which request, which addresses, how long after the request or after the last action on the amp.
  Always the same three blocks? Only after a patch change or after touching the amp?
- **Result / decision:** *Partial, 2026-11-15, `tools/katana-probe.ps1` (capture `katana-probe-20261115-181535.json`),
  amp untouched, editor mode byte read as `01`:* no unsolicited message at all. 45 s idle: nothing (not even active
  sensing). Seven full patch reads, two all-slots reads, SYSTEM and small reads: every reply was in ascending
  address order, no duplicates, no extra blocks. The unsolicited name/NS/gain blocks and the swapped block order
  from 2.10/2.11 did **not** reproduce, so they are probably tied to something touched on the amp or to a state
  right after connecting. Still open: (d) after a channel switch on the amp, and the comparison with editor mode off.

### Q5: Effect of EXPORT and PREVIEW_MUTE (later)

- **Status:** deferred to Phase 4. Addresses and values from local analysis of BOSS Tone Studio are in 2.9 [D].
  Saving from the PC works without them [C 2026-11-17] (2.15), so Phase 1c does not send them.
- **Procedure:** to be written once the addresses are known and Q1, Q2 and Q8 are answered. Outline: snapshot of
  all ten slots before and after each command, listen for muting, capture what the amp reports.
- **Record:** what changes in the stored slots and in the PREVIEW slot (index 9), audible effect, messages from
  the amp, whether saving works without them.
- **Result / decision:**

### Q6: Index n ↔ PATCH(n+1) for all channels

- **Confirmed so far:** index 8 only (table in 2.7).
- **Procedure (read-only):** "Read all ten stored slots" and compare the names in the table with your channels.
  Then for PANEL and every channel A1 … B4: select it on the amp, press "Verify mapping for the current channel"
  (reads the patch number, the current patch and the slot at that index, compares block by block). A channel with
  unsaved changes shows differences; switch away and back first.
- **Record:** per index: patch number reported, slot address, identical (yes/no), names. Then update the status
  column in 2.7.
- **Result / decision:** *Partial, 2026-11-15, `tools/katana-probe.ps1`:* with B4 selected the patch number reads
  `00 08`, and the current patch is identical to the slot at index 8 in all 80 blocks (every other slot differs in
  at least 6 blocks). The slot names read in one all-slots request are listed below; they are plausible for the
  channels but only B4 is proven by comparison. The other channels need a channel switch (on the amp, or by
  PATCH_SELECT once the BTS backup exists).

| Selected on the amp | Patch number read | Slot compared | Identical | Name in that slot |
|---|---|---|---|---|
| PANEL | `00 00` | `20 10 00 00` | yes, 80 of 80 | `KATANA` |
| A1 | `00 01` | `20 20 00 00` | yes, 80 of 80 | `COMP CLEAN` |
| A2 | `00 02` | `20 30 00 00` | yes, 80 of 80 | `TSR Pushed` |
| A3 | `00 03` | `20 40 00 00` | yes, 80 of 80 | `STADIUM LEAD` |
| A4 | `00 04` | `20 50 00 00` | yes, 80 of 80 | `TSR 80s Drive` |
| B1 | `00 05` | `20 60 00 00` | yes, 80 of 80 | `CLEAN` |
| B2 | `00 06` | `20 70 00 00` | yes, 80 of 80 | `Crunch` |
| B3 | `00 07` | `21 00 00 00` | yes, 80 of 80 | `Overdrive` |
| B4 | `00 08` | `21 10 00 00` | yes, 80 of 80 | `Distortion` |
| (PREVIEW) | | `21 20 00 00` | | `PREVIEW` |

**Confirmed 2026-11-15 for A1–B4** (capture `katana-probe-20261115-182243.json`): each channel was selected from
the PC by PATCH_SELECT (`katana-probe.ps1 -SelectTest`), then patch number and current patch were read and compared
with the slot. Index n lives in PATCH(n+1) for n = 1…8. **PANEL (index 0) confirmed 2026-11-15** (capture
`katana-probe-20261115-234713.json`): selected on the amp, patch number `00 00`, current patch identical with
`20 10 00 00` in 80 of 80 blocks. The mapping index n → PATCH(n+1) now holds for 0…8.

**PATCH_SELECT works as assumed** (same run, editor mode byte was `01`): DT1 `7F 00 01 00` with data `00 0n`
switches the channel. The amp answers within about 147 ms with 12 messages, always the same pattern:

1. echo of the command: DT1 `7F 00 01 00` = `00 0n`
2. DT1 `00 00 00 00` = `00 0n` (patch number)
3. DT1 `7F 01 01 01` … `7F 01 01 05`, one byte each, values seen 0–3 (five status bytes that differ per patch,
   e.g. `03 02 03 03 00` for A1, `00 03 03 03 00` for B4; **meaning unverified**, possibly the state of the five
   effect buttons)
4. `7F 01 01 01` … `7F 01 01 04` again
5. DT1 `00 00 00 00` = `00 0n` again

Selecting the channel that is already active gives the same messages without the last one (11, about 94 ms).
The patch could be read right after the 700 ms listening window and matched the slot every time, so a short wait
after a patch change is enough. Still open for Q1: whether pressing a channel button **on the amp** produces the
same messages, and what happens with editor mode off.

### Q7: Where does the firmware version live?

- **Known:** not in the identity reply.
- **Procedure (read-only):** Note the firmware version from a trusted source if you know it. Press "Dump candidate
  areas": it shows the identity reply, SYSTEM and 16 bytes from `7F 00 00 00`. Look for the version digits (plain
  numbers or ASCII). If nothing fits, try other areas with "Custom RQ1".
- **Record:** known version, address and bytes that match, or "not found in these areas".
- **Result / decision:** (if found: compare on connect with the version of the parameter list, PLAN section 7)
  *Partial, 2026-11-15, `tools/katana-probe.ps1`:* not found yet. Candidates dumped: `7F 00 00 00`–`03` read
  `01 01 01 00` (editor level, editor mode, running mode, revision by the BTS naming; `04`–`07` do not answer);
  SYSTEM (21 blocks, dump in the capture) holds no obvious version string; TEMP `30 00 00 00` answers with three
  blocks of zeros (1, 5 and 1 bytes). The "revision" byte `7F 00 00 03` = `00` is the only version-like value.
  Next step: compare with the version BTS or the amp shows.
  **Note:** a range RQ1 over the command area (`7F 00 00 00`, size 16) gets **no reply**; the bytes answer only
  when requested one at a time. The capture tool's "Dump candidate areas" uses the range form for this area and
  will therefore show nothing there.

### Q8: What happens when editor mode stays on?

- **Procedure (write: sends DT1 `7F 00 00 01`):** BOSS Tone Studio backup first. "Editor mode ON". Operate the amp:
  knobs, channel buttons, saving; anything different (display, sound, controls blocked)? Run the "editor mode on"
  parts of Q1–Q4 and Q9. Download the capture, then close the tab **without** "Editor mode OFF" (the tool never
  signs off by itself). Operate the amp again. Reload, connect, "Dump candidate areas" (reads `7F 00 00 00` ff.,
  which includes the editor mode byte if it is readable). Switch the amp off and on, connect, dump again. Finally
  "Editor mode OFF".
- **Record:** differences in amp behaviour with editor mode on; is the state readable; does it survive closing the
  tab, unplugging USB, power-cycling; does anything go wrong when it is left on.
- **Result / decision:** (decides whether the app must sign off, and whether it should switch editor mode on at all)
  *Partial, 2026-11-15, `tools/katana-probe.ps1`:* the state **is readable**: RQ1 `7F 00 00 01` size 1 returned
  `01` although the probe never wrote anything. Editor mode was therefore still on from an earlier session
  (prototype or BOSS Tone Studio; per the owner the amp had been on for a long time, so no power cycle in between). In that state all reads
  worked normally and the amp sent nothing by itself. Still open: behaviour of the amp's controls with it on, and
  whether a power cycle resets it.

  ***2026-11-15, the decisive comparison (captures `katana-probe-20261115-183302.json` and `…183343.json`):***
  editor mode was switched off from the PC (DT1 `7F 00 00 01` = `00`; the amp sends no acknowledgement, the byte
  reads back `00`). In that state the owner pressed A1 and turned GAIN: the amp changed (patch number 8 → 1, 48
  bytes of the current patch differ) but sent **not a single message** in 25 s. A full run before that (A1, GAIN,
  B4, save on B4) was equally silent. With editor mode on, the same actions are all reported (Q1, Q2, Q3).
  Switching it back on (`01`) is also unacknowledged and reads back `01`.

  ***2026-11-15, power cycle:*** editor mode had been left on (`01`) at the end of the session above. After the
  owner switched the amp off and on again, it read `00` (first line of capture `katana-probe-20261115-232749.json`).
  **A power cycle resets editor mode to off.** [C 2026-11-15]

  **Decision: the app must switch editor mode on when it connects.** Without it the app would not notice channel
  changes, knobs or saving on the amp. Reading and PATCH_SELECT work either way. Leaving it on is harmless as far
  as seen (the amp ran normally with it on for a long time), so signing off stays best-effort as in PLAN 4.3.
  After a reconnect the app should read the byte and set it again if needed.

### Q9: Does the amp send tuner data?

- **Procedure (read-only):** Marker "Tuner on", switch the tuner on at the amp, play single strings with marker
  "Played a note", marker "Tuner off". If nothing arrives, take a snapshot diff of the current patch and of SYSTEM
  around switching the tuner on. Repeat with editor mode on.
- **Record:** any incoming message while the tuner is active (address, data, rate), or "nothing".
- **Result / decision:** (a tuner in the app is only planned if the amp delivers data, PLAN Phase 3)
  *2026-11-15:* not tested. The owner knows of no tuner on the amp. Dropped unless that turns out to be wrong.

### Smaller open points

| Item | How to settle it |
|---|---|
| Is the patch number at `00 00 00 00` really two nibble bytes, and how big is that block? | "Read patch number" on several channels; compare with the DT1 seen in Q1. |
| Encoding of the PATCH_SELECT value (`u2x4` or `u2x7`) | Not distinguishable for indexes 1–8; note what the amp reports back after "Select patch". |
| ~~Does the amp echo our own DT1 writes?~~ | **No**, with editor mode off and on (2.13). |
| ~~Is the BTS send pacing needed over USB?~~ | **No** on the PC, for small messages and for whole blocks (2.13); the phone still to check once. |
| Meaning of identity bytes 6–9 and 11–13 | Compare with another Katana model if one is ever at hand. |

## 6. Legal note

This file contains only our own observations and our own names for parameters and addresses. Nothing is copied
from Roland files: no tables, no code, no texts, not even in parts. The extracted BOSS Tone Studio files stay
outside the repository (see `.gitignore`). Names such as PATCH_SELECT are working labels for addresses we use
ourselves. Unofficial hobby project, not affiliated with BOSS/Roland; BOSS and Katana are trademarks of Roland
Corporation.
