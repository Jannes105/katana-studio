// Explanations in English (Phase 3a). Our own words, nothing taken from BOSS manuals (PLAN 2). Keys and
// fallbacks: help.ts. Limits per field: HELP_LIMITS (tested). Parameter names stay as on the amp.

export interface HelpText {
  /** One sentence; the window's lead line. */
  readonly short: string;
  /** What it does. */
  readonly what: string;
  /** When you need it. */
  readonly when: string;
  /** A typical starting value. */
  readonly start?: string;
  /** A sound tip. */
  readonly tip?: string;
}

const PARAMS = {
  // ---- Shared by many blocks ----
  on: {
    short: 'Switches this block on or off.',
    what: 'Off means the block is bypassed: its settings stay as they are and come back when you switch it on.',
    when: 'To compare with and without, or to keep a block ready for later.',
  },
  colour: {
    short: 'Which of the three variations is active.',
    what: 'Green, red and yellow are three complete settings of this effect, each with its own type and knobs.',
    when: 'Keep e.g. a short, a long and a special delay in one patch and switch with the button on the amp.',
  },
  type: {
    short: 'The kind of effect this variation uses.',
    what: 'Each type has its own sound and its own knobs; the knobs of other types keep their values.',
    when: 'Long press a type in the list to hear what it is for.',
  },
  effectLevel: {
    short: 'Volume of the effect sound.',
    what: 'Level of the effect part only; the dry guitar stays as set by Direct Mix.',
    when: 'Effect too loud or in the way: lower. Hardly audible: raise.',
    start: 'Delay 30–45 · Reverb 25–40',
  },
  directMix: {
    short: 'Volume of the dry guitar next to the effect.',
    what: 'How much of the unprocessed signal passes alongside the effect. 0 = effect only.',
    when: 'Usually leave it at 100. Lower it only for pure effect sounds.',
    start: '100',
  },
  lowCut: {
    short: 'Removes the lows below this frequency.',
    what: 'Everything under the set frequency is filtered out; Flat means nothing is cut.',
    when: 'Effect or sound gets boomy or muddy: raise it until the low end clears up.',
    start: 'Flat, or 80–200 Hz',
  },
  highCut: {
    short: 'Removes the highs above this frequency.',
    what: 'Everything over the set frequency is filtered out; lower values sound darker and softer.',
    when: 'Too harsh, fizzy or in the way of the guitar: lower it.',
    start: '4–8 kHz',
  },
  level: {
    short: 'Output volume of this block.',
    what: 'Raises or lowers the volume after this block without changing its sound.',
    when: 'To match the volume with the block switched on and off.',
    start: 'Middle position (0 dB or 100)',
  },
  position: {
    short: 'Where this block sits in the signal chain.',
    what: 'Before the amp it shapes what the amp gets; after the amp it shapes the finished sound.',
    when: 'EQ before the amp changes how it distorts; after it, it only changes the tone.',
  },

  // ---- Amp ----
  'amp.type': {
    short: 'The basic character of the amp.',
    what: 'Six amp types from acoustic and clean to high gain. Long press a type to read about it.',
    when: 'Choose it first; then gain, EQ and effects.',
  },
  'amp.gain': {
    short: 'How much the amp distorts.',
    what: 'Drives the preamp: low = clean, high = crunch to lead. More gain also compresses and adds noise.',
    when: 'Set it first, then match the loudness with Volume.',
    start: 'Clean 20–35 · Crunch 45–60 · Lead 60–75',
    tip: 'Muddy with a lot of gain? Take gain down a bit and put a booster (Mid Boost, T-Scream) in front: it tightens the lows.',
  },
  'amp.volume': {
    short: 'Loudness of this channel; hardly changes the tone.',
    what: 'Level after the preamp. Use it to balance the channels against each other.',
    when: 'After gain and EQ, so rhythm and solo channels sit at the right level.',
    start: '50, then by ear',
  },
  'amp.bass': {
    short: 'The lows: warmth and punch.',
    what: 'Raises or lowers the bass range of the tone stack.',
    when: 'Too thin: more. Boomy or muddy with the band: less.',
    start: '40–55',
    tip: 'With a band, less bass often sounds better than at home: the bass player needs that room.',
  },
  'amp.middle': {
    short: 'The mids: how much the guitar cuts through.',
    what: 'The range where the guitar lives in a band mix.',
    when: 'Lost in the mix: more middle. Scooped metal sound: less.',
    start: '50–65',
  },
  'amp.treble': {
    short: 'The highs: bite and clarity.',
    what: 'Raises or lowers the upper mids and highs.',
    when: 'Dull: more. Sharp or shrill: less.',
    start: '50–60',
  },
  'amp.presence': {
    short: 'Lifts the very top end: sparkle and air.',
    what: 'Works above Treble, in the power amp: shine, air and definition.',
    when: 'When treble is right but freshness is missing. Careful with high gain: makes noise and fizz audible.',
    start: '40–55',
  },
  'amp.variation': {
    short: 'A second voicing of the selected amp type.',
    what: 'Each amp type has a variation with a different character, e.g. more gain or a different mid range.',
    when: 'If the type is close but not quite right, try the variation before turning many knobs.',
  },
  'amp.resonance': {
    short: 'How the low end of the speaker cabinet responds.',
    what: 'Shapes the low-frequency resonance between amp and speaker: more sounds bigger and boomier.',
    when: 'Thin at low volume: raise it. Boomy in a small room or with the band: lower it.',
    start: 'Middle, then by ear',
  },
  'amp.powerampVariation': {
    short: 'A different power amp character.',
    what: 'Changes how the power amp reacts and compresses, for a different feel at the same settings.',
    when: 'Try it when the sound is close but feels too stiff or too soft.',
  },
  'amp.cabinetResonance': {
    short: 'The kind of cabinet the amp imitates in the low end.',
    what: 'Vintage, Modern and Deep give different low-end responses, from tight to big.',
    when: 'Vintage for open, older sounds; Deep for heavy riffs; Modern in between.',
  },

  // ---- Noise suppressor ----
  'ns.on': {
    short: 'Silences noise and hum in pauses.',
    what: 'Closes when the signal falls under the threshold, so amp hiss and hum disappear between notes.',
    when: 'With high gain or noisy pickups. With clean sounds often not needed.',
  },
  'ns.threshold': {
    short: 'Below which level the suppressor closes.',
    what: 'Higher = more noise is cut, but soft notes and sustain get cut off too.',
    when: 'Raise until the pauses are quiet, then back off a little.',
    start: '20–40',
    tip: 'Notes stop abruptly? Threshold too high. Lower it or the gain.',
  },
  'ns.release': {
    short: 'How fast the suppressor closes after a note.',
    what: 'Short = tight, abrupt stops; long = notes fade naturally, a little noise remains.',
    when: 'Fast riffs with stops: short. Ringing chords: longer.',
    start: '30',
  },

  // ---- Contour ----
  'contour.select': {
    short: 'Ready-made mid curves for the amp.',
    what: 'Three memories that reshape the mid range in one go; Off leaves the amp as it is.',
    when: 'Quickly from scooped (metal) to mid-heavy (rock) without turning the EQ.',
    start: 'Off, then try 1–3',
  },
  'contour.type': {
    short: 'The curve shape of this contour memory.',
    what: 'Four shapes, from scooped mids to a mid boost.',
    when: 'Try them all with Freq Shift in the middle, then fine-tune.',
  },
  'contour.freqShift': {
    short: 'Moves the contour curve up or down.',
    what: 'Shifts the frequency the contour works on: lower = more body, higher = more bite.',
    when: 'Fine-tuning after choosing the type.',
    start: '0',
  },

  // ---- Booster ----
  'booster.drive': {
    short: 'How much the booster distorts.',
    what: 'Low = mainly louder and fuller; high = its own overdrive or distortion.',
    when: 'As a clean boost: low. As the main distortion with a clean amp: high.',
    start: 'Boost 0–20 · Overdrive 40–60',
  },
  'booster.bottom': {
    short: 'Low end of the booster.',
    what: 'Adds or removes bass from the boosted sound (0 = neutral).',
    when: 'Booster in front of a high-gain amp: cut the lows for a tighter sound.',
    start: '0, or −10 for tight riffs',
  },
  'booster.tone': {
    short: 'Brightness of the booster.',
    what: 'Darker below 0, brighter above.',
    when: 'Boosted sound too harsh: lower. Too dull: raise.',
    start: '0',
  },
  'booster.solo': {
    short: 'Switches on the extra solo volume.',
    what: 'With Solo on, the booster also raises the volume by Solo Level.',
    when: 'For a solo that should be louder, not just more distorted.',
  },
  'booster.soloLevel': {
    short: 'How much louder Solo makes the booster.',
    what: 'Extra volume while Solo is on.',
    when: 'Set it with the band so the solo stands out without jumping out.',
    start: '50–70',
  },
  'booster.effectLevel': {
    short: 'Output volume of the booster: how hard it hits the amp.',
    what: 'High = the amp is pushed harder and distorts more; low = less push.',
    when: 'Classic boost: Drive low, Effect Level high.',
    start: '50–70',
  },
  'booster.directMix': {
    short: 'Clean guitar mixed in next to the booster.',
    what: 'Keeps attack and clarity when the booster distorts a lot. 0 = booster only.',
    when: 'Fuzz or heavy distortion loses definition: add a little.',
    start: '0',
  },

  // ---- Delay (Delay 2 uses the same texts) ----
  'delay.time': {
    short: 'Time between the repeats.',
    what: 'Short (up to 120 ms) = doubling/slapback, medium (300–500 ms) = classic echo, long = ambient.',
    when: 'In a song: in time with the tempo. Rockabilly: short.',
    start: 'Slapback 100 ms · Solo 380 ms',
  },
  'delay.feedback': {
    short: 'How many repeats there are.',
    what: 'Share of the echo fed back into the delay. High = many, very high = it builds up endlessly.',
    when: 'Slapback: near 0. Solos: 25–40. Ambient: higher.',
    start: '30',
  },
  'delay.effectLevel': {
    short: 'Volume of the repeats.',
    what: 'Level of the echo; the dry guitar stays as set by Direct Mix.',
    when: 'Echo gets in the way of the playing: lower it.',
    start: '30–45',
    tip: 'A quiet echo behind the guitar sounds bigger in a band than a loud one: try 30 and a High Cut around 4 kHz.',
  },
  'delay.tapTime': {
    short: 'Time of the right side relative to the left.',
    what: 'PAN delay: the repeats bounce between left and right; this sets the ratio in percent.',
    when: 'For a wide stereo echo with two amps or headphones.',
    start: '50 %',
  },
  'delay.modRate': {
    short: 'Speed of the wobble in the repeats.',
    what: 'Makes the echoes waver slightly in pitch, like a tape machine.',
    when: 'For livelier, more "analogue" echoes.',
    start: '20',
  },
  'delay.modDepth': {
    short: 'Strength of the wobble in the repeats.',
    what: 'How far the pitch of the echoes wavers.',
    when: 'A little = warmth, a lot = seasick effect.',
    start: '15',
  },
  'delay.range': {
    short: 'Upper frequency limit of the echoes.',
    what: '8 kHz sounds softer and older, 17 kHz brighter and clearer.',
    when: '8 kHz when the repeats should sit behind the guitar.',
  },
  'delay.filter': {
    short: 'Tone filter for the repeats.',
    what: 'Rounds off the repeats, like the filter of the classic rack unit this type follows.',
    when: 'On when the echoes sound too sharp.',
  },
  'delay.feedbackPhase': {
    short: 'Flips the phase of the fed-back repeats.',
    what: 'Inverse changes the colour of the repeats; a subtle effect.',
    when: 'Try it; keep what sounds better.',
  },
  'delay.delayPhase': {
    short: 'Flips the phase of the echo against the dry signal.',
    what: 'Inverse can sound hollower or wider, depending on the time.',
    when: 'Try it with short times.',
  },
  'delay.modSwitch': {
    short: 'Switches the modulation of the repeats on.',
    what: 'Adds a gentle chorus-like movement to the echoes (Mod Rate, Mod Depth).',
    when: 'For lush, wide solo echoes.',
  },

  // ---- Reverb ----
  'reverb.layerMode': {
    short: 'Whether this block plays reverb, Delay 2 or both.',
    what: 'Delay 2 shares this block: Reverb, Delay 2 only, or both together.',
    when: 'Both for echo plus room; Delay 2 when you need a second delay instead of reverb.',
  },
  'reverb.time': {
    short: 'How long the reverb rings out.',
    what: 'Short = small room, long = hall or cathedral.',
    when: 'Rhythm: short. Ballads and ambient: long.',
    start: '1.5–2.5 s',
  },
  'reverb.preDelay': {
    short: 'Pause before the reverb starts.',
    what: 'Keeps the attack of the note clear before the room comes in.',
    when: 'Reverb washes out the playing: 20–60 ms.',
    start: '20 ms',
  },
  'reverb.density': {
    short: 'How dense the reflections are.',
    what: 'Low = you can hear single reflections; high = smooth, even reverb.',
    when: 'Usually high; lower for a grainier, older sound.',
    start: '8',
  },
  'reverb.effectLevel': {
    short: 'Volume of the reverb.',
    what: 'Level of the room sound; the dry guitar stays as set by Direct Mix.',
    when: 'Sound far away: lower. Dry and small: raise.',
    start: '25–40',
    tip: 'Too much reverb drowns a band sound. Set it a little lower than sounds nice alone.',
  },
  'reverb.springColor': {
    short: 'Character of the spring reverb.',
    what: 'From soft to the bright, splashy "boing" of a spring tank.',
    when: 'Surf and rockabilly: higher.',
    start: '50',
  },

  // ---- EQ 1/2 ----
  'eq.type': {
    short: 'Parametric or graphic EQ.',
    what: 'Parametric: four bands with free frequency. Graphic: ten fixed bands as sliders.',
    when: 'Parametric for precise corrections, graphic for quick broad changes.',
  },
  'peq.lowGain': {
    short: 'Raises or lowers the lows.',
    what: 'Shelf below about 100 Hz: body and weight.',
    when: 'Thin: a little more. Boomy: less.',
    start: '0 dB',
  },
  'peq.lowMidFreq': {
    short: 'Frequency of the lower mid band.',
    what: 'Where Low-mid Gain works. 200–500 Hz holds warmth and also mud.',
    when: 'Turn the gain up, sweep to find the problem, then cut it.',
    start: '400 Hz',
  },
  'peq.lowMidQ': {
    short: 'Width of the lower mid band.',
    what: 'Low Q = wide and gentle; high Q = narrow and precise.',
    when: 'Narrow to remove a single boomy frequency; wide for tone shaping.',
    start: '1',
  },
  'peq.lowMidGain': {
    short: 'Raises or lowers the lower mids.',
    what: 'Boost or cut at Low-mid Freq.',
    when: 'Muddy: cut a few dB. Thin: boost a little.',
    start: '0 dB',
  },
  'peq.highMidFreq': {
    short: 'Frequency of the upper mid band.',
    what: 'Where High-mid Gain works. 1–3 kHz decides how much the guitar cuts through.',
    when: 'Sweep with the gain raised to find the sweet or harsh spot.',
    start: '2 kHz',
  },
  'peq.highMidQ': {
    short: 'Width of the upper mid band.',
    what: 'Low Q = wide and gentle; high Q = narrow and precise.',
    when: 'Narrow to tame a piercing frequency; wide for tone shaping.',
    start: '1',
  },
  'peq.highMidGain': {
    short: 'Raises or lowers the upper mids.',
    what: 'Boost or cut at High-mid Freq.',
    when: 'Lost in the mix: boost a little. Harsh: cut.',
    start: '0 dB',
  },
  'peq.highGain': {
    short: 'Raises or lowers the highs.',
    what: 'Shelf above about 5 kHz: air and sparkle.',
    when: 'Dull: a little more. Fizzy: less.',
    start: '0 dB',
  },
  'geq.band': {
    short: 'Raises or lowers this frequency band.',
    what: 'Ten fixed bands from deep lows to air; each slider boosts or cuts its range.',
    when: 'Cutting usually sounds more natural than boosting.',
    start: '0 dB',
  },
} as const satisfies Record<string, HelpText>;

const TYPES = {
  // ---- Amp types ----
  'type.amp.Acoustic': {
    short: 'For acoustic guitars with pickup, and acoustic-like sounds.',
    what: 'Clean and wide-range, without the colouring of a guitar amp.',
    when: 'Electro-acoustic guitar, or very clean, even sounds.',
    start: 'Gain 30, Bass 45, Treble 50',
  },
  'type.amp.Clean': {
    short: 'Undistorted, clear basic sound.',
    what: 'A lot of headroom, stays clean even with more gain. A good base for effects.',
    when: 'Chords, arpeggios, funk, ambient with delay and reverb.',
    start: 'Gain 25, Bass 45, Middle 50, Treble 55',
  },
  'type.amp.Pushed': {
    short: 'Clean on the edge of breaking up.',
    what: 'Clean when played softly, slightly gritty when you dig in.',
    when: 'Blues, country, indie; with a booster in front for more drive.',
    start: 'Gain 40, Middle 55',
  },
  'type.amp.Crunch': {
    short: 'Lightly distorted, very responsive to your picking.',
    what: 'Classic rock sound: almost clean when soft, rough when hard.',
    when: 'Rock, blues, riffs with power chords.',
    start: 'Gain 50, Middle 60',
  },
  'type.amp.Lead': {
    short: 'Smooth high gain with long sustain.',
    what: 'Lots of distortion and compression; notes sing and sustain.',
    when: 'Solos, hard rock, modern rock.',
    start: 'Gain 60, Middle 60, Presence 45',
  },
  'type.amp.Brown': {
    short: 'Hot, thick high-gain sound with a lot of mids.',
    what: 'Aggressive, saturated distortion in the style of late-70s hard rock.',
    when: 'Hard rock and metal riffs, big solos.',
    start: 'Gain 55, Bass 45, Middle 55',
  },

  // ---- Booster and Mod/FX types (Mod and FX share one list) ----
  'type.booster.MID BOOST': {
    short: 'Pushes the mids for a thick, forward lead tone.',
    what: 'Lifts the midrange to make the guitar more present and sustained. Drives the amp harder without adding much dirt of its own.',
    when: 'Solos, riffs that must cut through a band, thin single coils.',
    start: 'Drive 30, Tone 0, Effect Level 60',
    tip: 'Switch it on for solos to jump out of the mix.',
  },
  'type.booster.CLEAN BOOST': {
    short: 'Clean volume push with almost no coloration.',
    what: 'Raises the signal level without adding distortion. Pushes the amp input harder or simply makes the guitar louder.',
    when: 'Solo level lift, driving a crunch amp, clean volume jumps.',
    start: 'Drive 20, Tone 0, Effect Level 65',
    tip: 'Put it before a crunch channel: low Drive, high Effect Level.',
  },
  'type.booster.TREBLE BOOST': {
    short: 'Bright, biting boost with a glassy edge.',
    what: 'Emphasizes highs and upper mids while thinning the bass. Gives a sharp, singing character and wakes up a dark amp.',
    when: 'Britpop and classic rock rhythm, dull pickups, jangly leads.',
    start: 'Drive 35, Tone +10, Effect Level 55',
    tip: 'Combine with a crunchy amp setting for a cutting tone.',
  },
  'type.booster.CRUNCH OD': {
    short: 'Warm, light crunch that reacts to your picking.',
    what: 'A mild overdrive with moderate gain and a lively response. Cleans up when you roll back the guitar volume.',
    when: 'Blues, classic rock, indie rhythm parts.',
    start: 'Drive 40, Tone 0, Effect Level 50',
  },
  'type.booster.NATURAL OD': {
    short: "Open, natural overdrive that keeps the guitar's voice.",
    what: 'Adds gentle grit with a balanced frequency response. The core guitar tone stays recognizable and dynamic.',
    when: 'Blues, country, rock rhythm, light lead tones.',
    start: 'Drive 35, Tone 0, Effect Level 55',
  },
  'type.booster.WARM OD': {
    short: 'Soft, round overdrive with smooth highs.',
    what: 'A mellow drive with tamed treble and a warm low end. Works well with bright pickups and bright amps.',
    when: 'Blues, jazz-rock, smooth leads, vintage feel.',
    start: 'Drive 40, Tone -10, Effect Level 50',
  },
  'type.booster.FAT DS': {
    short: 'Thick, heavy distortion with plenty of body.',
    what: 'A full-bodied distortion with strong lows and fat mids. Gives riffs weight and leads a creamy sustain.',
    when: 'Hard rock, heavy riffs, big sustained leads.',
    start: 'Drive 55, Tone 0, Effect Level 45',
  },
  'type.booster.METAL DS': {
    short: 'Tight, high-gain distortion for modern metal.',
    what: 'Aggressive distortion with a scooped character and tight low end. Built for fast palm-muted riffing.',
    when: 'Metal, hard-edged rhythm, fast chugging.',
    start: 'Drive 60, Tone 0, Effect Level 40',
    tip: 'Keep Bottom moderate for tight palm mutes.',
  },
  'type.booster.OCT FUZZ': {
    short: 'Fuzz with an added upper octave, raw and ringing.',
    what: 'A harsh fuzz that doubles the note an octave higher, giving a synthy, cutting lead. Sounds best on higher notes.',
    when: 'Psychedelic leads, rock solos, experimental sounds.',
    start: 'Drive 60, Tone 0, Effect Level 45',
    tip: 'Play above the 12th fret and roll off the tone control.',
  },
  'type.booster.BLUES DRIVE': {
    short: 'Smooth, dynamic drive with a vocal quality.',
    what: 'A mild to medium overdrive with a gentle mid focus and good touch response. Stays clear when you play softly.',
    when: 'Blues, soul, classic rock leads.',
    start: 'Drive 40, Tone 0, Effect Level 50',
  },
  'type.booster.OVERDRIVE': {
    short: 'Classic overdrive with a balanced, tube-like feel.',
    what: 'Versatile drive with moderate gain and an even tone. Good for pushing an amp or playing solo.',
    when: 'Rock, blues, all-round use.',
    start: 'Drive 40, Tone 0, Effect Level 50',
  },
  'type.booster.T-SCREAM': {
    short: 'Classic green mid-hump overdrive, creamy and vocal.',
    what: 'A well-known overdrive character: strong midrange, tight bass and soft highs. Ideal for pushing an amp.',
    when: 'Blues, rock leads, boost into a crunchy amp.',
    start: 'Drive 25, Tone 0, Effect Level 65',
    tip: 'Drive low, level high, in front of a crunch amp.',
  },
  'type.booster.TURBO OD': {
    short: 'Hot-rodded overdrive with extra gain and punch.',
    what: 'A stronger overdrive with plenty of output, tight lows and a snappy attack. Reaches into light distortion territory.',
    when: 'Hard rock, punchy riffs, lead lines.',
    start: 'Drive 50, Tone 0, Effect Level 50',
  },
  'type.booster.DISTORTION': {
    short: 'Straightforward rock distortion with solid grit.',
    what: 'A general-purpose distortion with strong gain and a clear mid-focused tone. Easy to dial in.',
    when: 'Rock, punk, hard rock rhythm and leads.',
    start: 'Drive 50, Tone 0, Effect Level 45',
  },
  'type.booster.RAT': {
    short: 'Gritty, raw distortion with a sharp, aggressive bite.',
    what: 'A classic dirty distortion style: strong mids, harsh top end and a rough edge. Goes from light grit to heavy fuzz-like saturation.',
    when: 'Punk, grunge, alternative rock, rough leads.',
    start: 'Drive 55, Tone -5, Effect Level 45',
  },
  'type.booster.GUV DS': {
    short: 'Bright, tight vintage-style distortion with a dry edge.',
    what: 'A classic 80s-style distortion with firm lows, bright mids and an aggressive attack. Good for tight rock riffs.',
    when: '80s hard rock, rock leads, punchy riffs.',
    start: 'Drive 50, Tone 0, Effect Level 45',
  },
  'type.booster.DST+': {
    short: 'Simple, early-style distortion with a raw, fizzy bite.',
    what: 'A basic distortion with a lean low end and a bright, gritty character. Works as a vintage rock or punk tone.',
    when: 'Punk, classic rock, simple heavy riffs.',
    start: 'Drive 50, Tone 0, Effect Level 45',
  },
  'type.booster.METAL ZONE': {
    short: 'Extreme scooped distortion with huge gain.',
    what: 'Very high gain with deep lows and bright highs, with a hollow mid section. Gives a heavy, modern metal wall of sound.',
    when: 'Metal, hard core, down-tuned riffs.',
    start: 'Drive 55, Tone 0, Effect Level 40',
    tip: 'Lower the Drive a bit if notes get muddy.',
  },
  "type.booster.'60S FUZZ": {
    short: 'Warm, spitty 60s fuzz with sweet sustain.',
    what: 'A vintage fuzz with a woolly, saturated tone that cleans up with lower guitar volume. Fuzzy but musical.',
    when: 'Garage rock, psychedelia, retro leads.',
    start: 'Drive 55, Tone 0, Effect Level 45',
  },
  'type.booster.MUFF FUZZ': {
    short: '70s fuzz with a big wall of sustain.',
    what: 'A thick, creamy fuzz with huge sustain and a scooped midrange. Turns single notes into long, singing lines.',
    when: 'Alt rock, shoegaze, big sustained leads.',
    start: 'Drive 60, Tone 0, Effect Level 45',
    tip: 'Roll back on the Tone and play single notes.',
  },
  'type.booster.HM-2': {
    short: 'Swedish death-metal chainsaw distortion.',
    what: 'A buzzsaw distortion with heavy, rumbling lows and razor-sharp highs. Instantly gives the classic extreme metal sound.',
    when: 'Death metal, crust, d-beat.',
    start: 'Drive 60, Tone 0, Effect Level 40',
  },
  'type.booster.METAL CORE': {
    short: 'Tight, modern high-gain tone with a heavy low end.',
    what: 'A focused metal distortion with tight bass and strong mids. Keeps fast riffs clear even at high gain.',
    when: 'Metalcore, modern metal, tight riffs.',
    start: 'Drive 55, Tone 0, Effect Level 40',
  },
  'type.booster.CENTA OD': {
    short: "Transparent low-gain overdrive that keeps your amp's tone.",
    what: 'A subtle drive that adds light grit and a touch of sparkle without changing the core character. Also great as a clean boost.',
    when: 'Light drive, boost for solos, blues and country.',
    start: 'Drive 25, Tone 0, Effect Level 60',
    tip: 'Use it as an always-on tone enhancer.',
  },
  'type.modfx.T.WAH': {
    short: 'Wah that opens and closes with your picking.',
    what: 'A touch-sensitive filter that sweeps up on loud notes and falls back on soft ones. No pedal needed.',
    when: 'Funk, rhythm guitar, quacky leads.',
    start: 'Sens 50, Peak 50, Effect Level 100',
    tip: 'Pick harder for a more open wah sweep.',
  },
  'type.modfx.AUTO WAH': {
    short: 'Wah that moves automatically on its own.',
    what: 'A filter swept by an internal oscillator, giving a rhythmic vowel-like wobble at a steady speed.',
    when: 'Funk, psychedelic, experimental effects.',
    start: 'Rate 40, Depth 60, Effect Level 100',
  },
  'type.modfx.PEDAL WAH': {
    short: 'Classic wah controlled with your foot.',
    what: 'A sweepable filter controlled by an expression pedal, for the typical vocal wah sound.',
    when: 'Leads, funk rhythm, solos with expression.',
    start: 'Pedal Pos in the middle, Effect Level 100',
    tip: 'Park the pedal half-open for a fixed filtered tone.',
  },
  'type.modfx.COMP': {
    short: 'Evens out volume and adds sustain.',
    what: 'Reduces loud peaks and lifts quiet parts. Gives a smoother, longer-lasting tone with tight dynamics.',
    when: 'Clean funk, country chicken picking, sustained leads.',
    start: 'Sustain 50, Attack 50, Level 50',
  },
  'type.modfx.LIMITER': {
    short: 'Stops peaks without changing tone much.',
    what: 'Limits loud signals at a set level, protecting the following effects and amp from sudden jumps.',
    when: 'Taming hot pickups, even levels before drive.',
    start: 'Threshold medium, Release medium',
  },
  'type.modfx.GRAPHIC EQ': {
    short: 'Fixed-band EQ for shaping the tone.',
    what: 'Splits the sound into frequency bands with separate sliders. Useful for fine tuning the overall tone of a patch.',
    when: 'Tone shaping, scooped or boosted mids, solo boost.',
    start: 'All bands 0 dB, then cut what bothers',
  },
  'type.modfx.PARAMETRIC EQ': {
    short: 'Flexible EQ with adjustable center frequency.',
    what: 'Boost or cut a chosen frequency range with variable width. Great for precise corrections of the sound.',
    when: 'Cutting problem frequencies, mid boost for solos.',
    start: 'High-mid Gain +4 dB at 1 kHz for solos',
  },
  'type.modfx.GUITAR SIM': {
    short: 'Turns single-coil tone into humbucker tone or the reverse.',
    what: 'Modifies the pickup character to simulate other pickup types. Useful when your guitar does not match the sound you want.',
    when: 'Fatter single coil leads, brighter humbuckers.',
    start: 'Pick the Type, then Body by ear',
  },
  'type.modfx.SLOW GEAR': {
    short: 'Automatic swell that fades notes in like a violin.',
    what: 'Softens the attack of each note and lets it grow slowly. Removes the pick sound for a smooth, pad-like tone.',
    when: 'Ambient, volume swell effects, soft pad lines.',
    start: 'Sens 50, Rise Time medium',
  },
  'type.modfx.WAVE SYNTH': {
    short: 'Synth-like sound from your guitar.',
    what: 'Replaces the guitar tone with a filtered sawtooth or square wave that follows your playing. Sounds like a monophonic synth.',
    when: 'Synth leads, bass-like lines, sci-fi sounds.',
    start: 'Wave Saw, Cutoff 50, Resonance 30',
    tip: 'Play single notes, one at a time, for best tracking.',
  },
  'type.modfx.OCTAVE': {
    short: 'Adds a deep note one octave below.',
    what: 'Blends a lower octave into your playing for a thicker, bass-heavy tone. Tracks best on single notes.',
    when: 'Bass lines on guitar, fat leads, heavy riffs.',
    start: 'Effect Level 60, Direct Mix 100',
  },
  'type.modfx.PITCH SHIFTER': {
    short: 'Shifts the pitch up or down.',
    what: 'Moves your notes by a chosen interval. Can be used for harmony, detune thickening or special effects.',
    when: 'Harmony leads, thick detuned sound, special effects.',
    start: 'Pitch +12, Effect Level 50',
  },
  'type.modfx.HARMONIST': {
    short: 'Adds a harmony voice in the key you play.',
    what: 'Creates a second note that follows the scale and key, giving intelligent two-part harmonies.',
    when: 'Twin leads, melodic harmony lines.',
    start: 'Harmony +3rd, Master Key of the song',
    tip: 'Set Master Key to the key of the song, or the harmonies sound wrong.',
  },
  'type.modfx.AC.PROCESSOR': {
    short: 'Gives acoustic pickups a more natural tone.',
    what: 'Corrects the typical piezo sound by adding body and air for a warmer acoustic sound.',
    when: 'Electro-acoustic guitars with piezo pickups.',
    start: 'Bass 50, Middle 50, Treble 50',
  },
  'type.modfx.PHASER': {
    short: 'Swirling, whooshing modulation.',
    what: 'Sweeps notch filters through the sound for a soft, rotating swish. Gentle movement that stays smooth.',
    when: 'Clean arpeggios, funk, psychedelic rock.',
    start: 'Rate 40, Depth 50, Resonance 30',
  },
  'type.modfx.FLANGER': {
    short: 'Jet-like whoosh with metallic sweep.',
    what: 'Mixes a short, swept delay with the original sound for a sharp, whirling comb filter. Strong and dramatic.',
    when: 'Rock leads, intros, sci-fi ambience.',
    start: 'Rate 30, Depth 50, Resonance 40',
  },
  'type.modfx.TREMOLO': {
    short: 'Rhythmic volume pulsing.',
    what: 'Raises and lowers the level at a steady rate, from soft shimmer to choppy stutter.',
    when: 'Surf, ballads, vintage clean tones.',
    start: 'Rate 40, Depth 50, Level 100',
  },
  'type.modfx.ROTARY': {
    short: 'Rotating-speaker cabinet swirl.',
    what: 'Simulates the swirl of a spinning speaker with Doppler-like pitch and volume change. Lush and organ-like.',
    when: 'Organ-like leads, slow ballads, clean chords.',
    start: 'Rate slow, Depth 60, Level 100',
    tip: 'Use a fast Rate for lead, slow for chords.',
  },
  'type.modfx.UNI-V': {
    short: 'Throbbing 60s phase-chorus wobble.',
    what: 'A pulsing modulation between phaser and chorus with a warbling, watery character. Typical vintage psychedelic tone.',
    when: 'Psychedelic rock, blues, funky rhythm.',
    start: 'Rate 40, Depth 70, Level 100',
  },
  'type.modfx.SLICER': {
    short: 'Rhythmic chopping of the sound.',
    what: 'Cuts the signal into a repeating pattern of short bursts. Plays like a gate synced to a rhythm.',
    when: 'Rhythmic textures, electronic styles, special effects.',
    start: 'Pattern 1, Rate medium, Effect Level 100',
    tip: 'Play sustained chords for the clearest rhythm.',
  },
  'type.modfx.VIBRATO': {
    short: 'Smooth pitch wobble.',
    what: 'Moves the pitch up and down at a steady speed. Lends a classic, wavering vintage tone.',
    when: 'Vintage leads, surf, psychedelic sounds.',
    start: 'Rate 40, Depth 50',
  },
  'type.modfx.RING MOD': {
    short: 'Metallic, bell-like inharmonic tone.',
    what: 'Multiplies your signal with an oscillator to produce clangorous sounds with odd overtones. Very extreme.',
    when: 'Experimental, sci-fi, robot sounds.',
    start: 'Frequency medium, Effect Level 40',
    tip: 'Keep Effect Level low for a more subtle bite.',
  },
  'type.modfx.HUMANIZER': {
    short: 'Talking, vowel-like filter.',
    what: 'Shapes the sound like human vowels, so the guitar seems to speak. Changes in sequence or follows picking.',
    when: 'Talking guitar, funky riffs, quirky leads.',
    start: 'Two different vowels, Rate 40, Depth 60',
  },
  'type.modfx.CHORUS': {
    short: 'Shimmering doubled sound with width.',
    what: 'Blends a slightly detuned copy with the dry signal for a wide, silky, thick tone.',
    when: 'Clean chords, arpeggios, 80s style.',
    start: 'Rate 30, Depth 50, Level 50',
  },
  'type.modfx.AC.GUITAR SIM': {
    short: 'Makes an electric guitar sound acoustic.',
    what: 'Reshapes tone to imitate the resonance and brightness of an acoustic. Best with clean sounds.',
    when: 'Faking acoustic strum or fingerpicking.',
    start: 'Body 50, Level 100',
    tip: 'Works best with a clean amp and single coils.',
  },
  'type.modfx.PHASER 90E': {
    short: 'Classic small orange phaser sweep.',
    what: 'A soft, swirling phaser from the 70s with a simple one-knob character. Gentle and musical.',
    when: 'Classic rock, clean funk, rhythm.',
    start: 'Speed 30',
  },
  'type.modfx.FLANGER 117E': {
    short: 'Classic analog flanger with a strong sweep.',
    what: 'Emulates a vintage flanger with a smooth, warm swoosh and jet-like motion.',
    when: 'Rock leads, classic solos, intros.',
    start: 'Speed 30, Width 50, Regen. 40',
  },
  'type.modfx.WAH 95E': {
    short: 'Classic wah pedal emulation.',
    what: 'Reproduces a famous vintage wah voice with vocal sweeps and a distinctive peak.',
    when: 'Rock leads, funk, solos with expression.',
    start: 'Pedal Pos half way, Effect Level 100',
  },
  'type.modfx.DC-30': {
    short: 'A vintage analog chorus-echo unit of the 70s.',
    what: 'Select switches between a lush analog chorus and a warm, dark echo with a vintage feel.',
    when: 'Ambient leads, jangly chords, retro textures.',
    start: 'Select Echo, Echo Intensity 30, Echo Volume 50',
  },
  'type.modfx.HEAVY OCTAVE': {
    short: 'Thick low octave for heavy riffs.',
    what: 'Adds a heavy octave below the note, creating a bass-like, massive sound. Tracks best on low single notes.',
    when: 'Doom, stoner, heavy riffs.',
    start: '1 Oct Level 60, Direct Mix 100',
  },
  'type.modfx.PEDAL BEND': {
    short: 'Pitch bend with the expression pedal.',
    what: 'Moves the pitch up or down as you press the pedal, like a bar or pitch effect on the fly.',
    when: 'Dive-bomb effects, pedal steel bends, wild leads.',
    start: 'Pitch +12, then move the pedal',
  },
  // ---- Delay types (Delay 2 too) ----
  'type.delay.DIGITAL': {
    short: 'Clean, exact repeats.',
    what: 'Every echo sounds like the original. Neutral and precise.',
    when: 'Modern rock, rhythmic delays, when the echo should stay clear.',
    start: 'Time 400 ms, Feedback 30, Level 35',
  },
  'type.delay.PAN': {
    short: 'Echoes jumping between left and right.',
    what: 'A stereo delay whose repeats alternate between the sides (Tap Time).',
    when: 'Stereo setups and headphones, for width.',
    start: 'Time 400 ms, Tap Time 50 %',
  },
  'type.delay.STEREO': {
    short: 'A delay for stereo use.',
    what: 'Separate repeats for both sides, for a wide image.',
    when: 'With two speakers or headphones.',
    start: 'Time 350 ms, Feedback 30',
  },
  'type.delay.ANALOG': {
    short: 'Warm, dark repeats that get softer.',
    what: 'Follows the sound of old bucket-brigade delay pedals: each echo darker than the last.',
    when: 'Blues, classic rock, whenever the echo should stay behind the guitar.',
    start: 'Time 350 ms, Feedback 35, Level 40',
  },
  'type.delay.TAPE ECHO': {
    short: 'Warm tape echo with a slight wobble.',
    what: 'Repeats get darker and a little unsteady, like a tape machine.',
    when: 'Blues, rockabilly, surf, vintage solos.',
    start: 'Time 350 ms, Feedback 30, Level 35',
  },
  'type.delay.REVERSE': {
    short: 'Echoes played backwards.',
    what: 'The repeats swell up like a tape running in reverse.',
    when: 'Psychedelic and ambient sounds, intros.',
    start: 'Time 500 ms, Feedback 20, Direct Mix 100',
  },
  'type.delay.MODULATE': {
    short: 'Repeats with a gentle chorus movement.',
    what: 'Mod Rate and Mod Depth make the echoes shimmer and float.',
    when: 'Wide, lush solos and clean ambient sounds.',
    start: 'Time 450 ms, Mod Rate 20, Mod Depth 20',
  },
  'type.delay.SDE-3000': {
    short: 'Follows a classic 80s studio rack delay.',
    what: 'Clear but slightly coloured repeats, with phase and modulation options.',
    when: '80s rock, wide stereo leads, clean chorus-like echoes.',
    start: 'Time 380 ms, Feedback 25, Mod on',
  },

  // ---- Reverb types ----
  'type.reverb.PLATE': {
    short: 'Bright, smooth studio reverb.',
    what: 'Imitates a metal plate: dense, shiny, no clear room.',
    when: 'Solos and vocals-like lead lines, clean pop sounds.',
    start: 'Time 2.0 s, Pre Delay 20 ms, Level 30',
  },
  'type.reverb.ROOM': {
    short: 'A small to medium room.',
    what: 'Short, natural reverb: the guitar sounds in a room, not far away.',
    when: 'Rhythm guitar, crunch, whenever reverb should hardly be noticed.',
    start: 'Time 1.0 s, Level 30',
  },
  'type.reverb.HALL': {
    short: 'A large concert hall.',
    what: 'Long, soft and wide reverb.',
    when: 'Ballads, slow solos, ambient.',
    start: 'Time 2.5 s, Pre Delay 30 ms, Level 30',
  },
  'type.reverb.SPRING': {
    short: 'Classic spring reverb of guitar amps.',
    what: 'Splashy, slightly metallic; the typical "boing" with hard picking.',
    when: 'Surf, rockabilly, vintage clean sounds.',
    start: 'Time 2.0 s, Spring Color 50, Level 35',
  },
  'type.reverb.MODULATE': {
    short: 'Reverb that moves and shimmers.',
    what: 'A long reverb with slight pitch movement inside.',
    when: 'Ambient and atmospheric clean sounds.',
    start: 'Time 3.0 s, Level 35',
  },
} as const satisfies Record<string, HelpText>;

export const HELP_EN: Readonly<Record<string, HelpText>> = { ...PARAMS, ...TYPES };
export type HelpKey = keyof typeof PARAMS | keyof typeof TYPES;
