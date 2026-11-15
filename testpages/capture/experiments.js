// The guided experiments of "Phase 0 on the PC". IDs match docs/protocol-notes.md (section 5)
// and docs/testplan/phase-0.md. Text only; no logic.

export const PRESET_MARKERS = Object.freeze([
  'Pressed a channel button on the amp',
  'Pressed PANEL on the amp',
  'Turned a knob on the amp',
  'Pressed an effect button on the amp',
  'Saved on the amp',
  'Tuner on',
  'Tuner off',
  'Played a note',
  'Nothing touched since last marker',
]);

export const EXPERIMENTS = Object.freeze([
  {
    id: 'Q7',
    title: 'Where is the firmware version?',
    writes: false,
    steps: [
      'Note the firmware version from a source you trust (as shown by BOSS Tone Studio or the amp itself), if you know it.',
      'Press "Dump candidate areas" in the firmware section. The command area 7F 00 00 00 stays empty there (no reply to range reads); read its bytes one at a time with "Custom RQ1", size 1.',
      'Look for the version digits in the dumps. Write down address and bytes, or "not found".',
    ],
  },
  {
    id: 'Q6',
    title: 'Index n lives in PATCH(n+1) for every channel',
    writes: false,
    steps: [
      'Press "Read all ten stored slots" and check the names in the table against your channels.',
      'For Panel and each channel A1 to B4: select it on the amp, then press "Verify mapping for the current channel".',
      'Expected: the reported patch number is the index, and the current patch equals the slot at that index (differences only if the channel has unsaved changes).',
    ],
  },
  {
    id: 'Q4',
    title: 'What triggers the unsolicited messages?',
    writes: false,
    steps: [
      'Leave the amp alone for two minutes without sending anything. Are there unsolicited DT1?',
      'Read the full current patch five times in a row. Note duplicates in the result line and UNSOLICITED lines in the log.',
      'Read all ten stored slots, then a single small value (patch name). Same check.',
      'Switch the channel on the amp, then repeat the full patch read at once.',
      'Later, with the write section unlocked: repeat with editor mode on.',
    ],
  },
  {
    id: 'Q1',
    title: 'Patch change on the amp: is it reported?',
    writes: false,
    steps: [
      'Send nothing. Set the preset marker "Pressed a channel button on the amp", then press A1, A2 ... B4 and PANEL one after another, a marker before each press.',
      'Watch for UNSOLICITED DT1, expected at 00 00 00 00 with the patch number.',
      'Note address, data, delay after the press and anything else the amp sends with it.',
      'Later, with the write section unlocked: repeat with editor mode on.',
    ],
  },
  {
    id: 'Q3',
    title: 'Knobs and buttons on the amp: reported or not, which addresses?',
    writes: false,
    steps: [
      'Press "Take snapshot A".',
      'Set a marker naming the control, then move exactly one control on the amp (start with GAIN).',
      'Press "Take snapshot B and diff". The table shows the changed addresses and whether the amp reported them.',
      'Repeat for each knob and button on the panel, one at a time.',
      'Later, with the write section unlocked: repeat a few with editor mode on.',
    ],
  },
  {
    id: 'Q9',
    title: 'Does the amp send tuner data?',
    writes: false,
    steps: [
      'Switch the tuner on at the amp (marker "Tuner on"), play single strings (marker "Played a note"), switch it off (marker "Tuner off").',
      'Watch for any incoming message. Take a snapshot diff of SYSTEM or the current patch around it if nothing arrives.',
      'Later, with the write section unlocked: repeat with editor mode on.',
    ],
  },
  {
    id: 'Q2',
    title: 'Saving on the amp: is PATCH_WRITE reported?',
    writes: false,
    steps: [
      'This overwrites a channel on the amp by your own hand: make the BOSS Tone Studio backup first and pick a channel you can spare.',
      'Take snapshot A, change one knob, save to the channel on the amp (marker "Saved on the amp").',
      'Watch for UNSOLICITED DT1, expected at 7F 00 01 04. Note address, data and what follows.',
      'Press "Verify mapping for the current channel": current patch and stored slot should now be equal.',
      'Later, with the write section unlocked: repeat with editor mode on.',
    ],
  },
  {
    id: 'Q8',
    title: 'What happens when editor mode stays on?',
    writes: true,
    steps: [
      'Needs the write section (BOSS Tone Studio backup done).',
      'Press "Editor mode ON". Operate the amp: knobs, channel buttons, saving. Does anything behave differently (display, sound, controls blocked)?',
      'Re-run the "later" steps of Q1, Q2, Q3, Q4 and Q9 now.',
      'Download the capture, then close the tab without pressing "Editor mode OFF". Operate the amp again.',
      'Reload the page, connect, read the editor mode byte with "Custom RQ1" 7F 00 00 01, size 1 ("Dump candidate areas" shows nothing for the command area). Is editor mode still on? Does reading behave as before?',
      'Switch the amp off and on, reconnect, dump again. Finally press "Editor mode OFF".',
    ],
  },
  {
    id: 'Q5',
    title: 'Effect of EXPORT and PREVIEW_MUTE (deferred)',
    writes: true,
    steps: [
      'Not in this version of the tool: the addresses and semantics of these commands are not verified, so there is no button for them.',
      'Do not try them through "Custom DT1" before the procedure in docs/protocol-notes.md is written.',
    ],
  },
]);
