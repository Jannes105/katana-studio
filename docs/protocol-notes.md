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
- Implementation with tests: `testpages/shared/katana.js` (`toLinear`, `fromLinear`, `addOffset`).

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

The layout of SYSTEM (which block holds what) is not written down yet. [O]

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
| `00 00` + 0 | patch name | `ascii(16)` | [C 2026-11-14] read |
| `06 00` + 0 | amp gain | `u7` | [D]; the amp sent this block unsolicited as "gain/volume" [C 2026-11-15]; write unverified |
| `06 00` + 1 | amp volume | `u7` | same as gain |
| `06 00` + 2 | amp bass | `u7` | [D] |
| `06 00` + 7 | amp type | `u7` | [D] |
| `06 00` + 0 … 4 | gain, volume, bass, middle, treble (knobs in panel order) | `u7` 0–100 | [C 2026-11-15] reported, Q3 |
| `10 00` ff. | effect blocks (FX, delay, reverb …) | | [D], details open |
| `04 00` + 0 … 4 | colour (variation 0–2) of BOOSTER, MOD, FX, DELAY, REVERB | `u7` | [C 2026-11-15] reported by the effect buttons, Q3 |
| `08 00` + 0 … 3, 5 | on/off of BOOSTER, MOD, FX, DELAY, REVERB (+4 presumably Delay 2) | `u7` 0/1 | [C 2026-11-15] reported, Q3; +4 [D] |
| `06 00` + 5 | presence (sixth amp knob) | `u7` | [C 2026-11-15] reported, Q3 |
| `58 00` + 0 | noise suppressor switch | `u7` 0/1 | [D] |
| `58 00` + 1 | noise suppressor threshold | `u7` 0–100 | **[C 2026-11-14]** written by DT1, change was audible |
| `58 00` + 2 | noise suppressor release | `u7` 0–100 (range assumed) | [D] |
| `5A 00` | send/return | | [D] |
| `5C 00` ff. | assigns | | [D] |

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
| `7F 00 01 04` | PATCH_WRITE | save the current patch; saving **on the amp** is reported here with the index as two nibbles | [C 2026-11-15] as a report (Q2); sending it from the PC is untested |
| `7F 01 01 01` … `05` | five status bytes | reported on every patch change, save and colour change: colour of BOOSTER, MOD, FX, DELAY, REVERB (0–2), `03` = off | [C 2026-11-15], Q3 |
| `7F 00 01 0E` | PATCH_CLEAR | clear a patch | [D], never sent |
| unknown | EXPORT, PREVIEW_MUTE | sent by BOSS Tone Studio after saving and after restoring | [O] Q5; addresses not in our notes |

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

This table is what "a range request is complete when all expected block addresses have arrived" (PLAN 4.2) needs,
and it is the block table for backups (PLAN 4.6). What the blocks mean is only known for name, amp and NS.

Other areas: SYSTEM has 21 blocks at `10 00 00 00` … `10 00 28 00` (every `02 00`, block `10 00 2A 00` onward
absent). The setup area answers a range read with a single block `00 00 00 00` = 2 bytes (patch number as two
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
- **Not tested:** large DT1 (whole blocks, up to 225 data bytes, as used for restoring a patch) and the same burst
  over the phone's bulk endpoint, which may be faster than the PC driver. Until tested, large writes keep a gap
  (check before Phase 1c), and the pair burst is repeated once with the test APK.

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

- **Status:** deferred. The addresses and value formats of these commands are not in our notes, and the capture
  tool has no button for them (nor for PATCH_WRITE). They need the BOSS Tone Studio backup first.
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
| ~~Is the BTS send pacing needed over USB?~~ | **No** for small messages on the PC (2.13); large DT1 and the phone still to check. |
| Meaning of identity bytes 6–9 and 11–13 | Compare with another Katana model if one is ever at hand. |

## 6. Legal note

This file contains only our own observations and our own names for parameters and addresses. Nothing is copied
from Roland files: no tables, no code, no texts, not even in parts. The extracted BOSS Tone Studio files stay
outside the repository (see `.gitignore`). Names such as PATCH_SELECT are working labels for addresses we use
ourselves. Unofficial hobby project, not affiliated with BOSS/Roland; BOSS and Katana are trademarks of Roland
Corporation.
