// Value tables shared by several blocks (our own tables; protocol-notes 2.8). Raw value = index.

export const OFF_ON = ['Off', 'On'] as const;
export const NORMAL_INVERSE = ['Normal', 'Inverse'] as const;
/** High cut of delay, reverb, the EQs and solo, raw 0–14. */
export const HIGH_CUT = [
  '630 Hz',
  '800 Hz',
  '1.00 kHz',
  '1.25 kHz',
  '1.60 kHz',
  '2.00 kHz',
  '2.50 kHz',
  '3.15 kHz',
  '4.00 kHz',
  '5.00 kHz',
  '6.30 kHz',
  '8.00 kHz',
  '10.0 kHz',
  '12.5 kHz',
  'Flat',
] as const;
/** Low cut of reverb, the EQs and solo, raw 0–17. */
export const LOW_CUT = [
  'Flat',
  '20.0 Hz',
  '25.0 Hz',
  '31.5 Hz',
  '40.0 Hz',
  '50.0 Hz',
  '63.0 Hz',
  '80.0 Hz',
  '100 Hz',
  '125 Hz',
  '160 Hz',
  '200 Hz',
  '250 Hz',
  '315 Hz',
  '400 Hz',
  '500 Hz',
  '630 Hz',
  '800 Hz',
] as const;
/** Frequency of a parametric EQ band (mid / low-mid / high-mid), raw 0–27. */
export const EQ_FREQ = [
  '20.0 Hz',
  '25.0 Hz',
  '31.5 Hz',
  '40.0 Hz',
  '50.0 Hz',
  '63.0 Hz',
  '80.0 Hz',
  '100 Hz',
  '125 Hz',
  '160 Hz',
  '200 Hz',
  '250 Hz',
  '315 Hz',
  '400 Hz',
  '500 Hz',
  '630 Hz',
  '800 Hz',
  '1.00 kHz',
  '1.25 kHz',
  '1.60 kHz',
  '2.00 kHz',
  '2.50 kHz',
  '3.15 kHz',
  '4.00 kHz',
  '5.00 kHz',
  '6.30 kHz',
  '8.00 kHz',
  '10.0 kHz',
] as const;
/** Q of a parametric EQ band, raw 0–5. */
export const EQ_Q = ['0.5', '1', '2', '4', '8', '16'] as const;
