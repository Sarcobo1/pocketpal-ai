/**
 * Radius tokens — Limi.
 *
 * The scale is small on purpose. Limi has three radii in real use:
 *   - 10 for buttons, chips and inputs
 *   - 16 for cards
 *   - 20 for panels, message panels and the top corners of a bottom sheet
 *
 * Fully-round is reserved for exactly two controls: the record button (88)
 * and the pause button (72). Nothing else is a pill.
 *
 * Key names keep the canonical Figma `Radius/*` mapping so a spec saying
 * `Radius/L` still resolves here, with the Limi values bound to the steps
 * that are actually used.
 */
import {TokenRadius} from './types';

export const radius: TokenRadius = {
  none: 0,
  xxs: 2,
  // 4 — hairline chips, tiny badges
  xs: 4,
  // 8 — a step below the control radius
  s: 8,
  // 10 — buttons, chips, inputs
  m: 10,
  // 16 — cards
  ml: 16,
  // 20 — panels, message panels, sheet top corners
  l: 20,
  // 32 — large sheet / overlay surfaces
  xl: 32,
  // 40 — the largest non-circular surface
  xxl: 40,
};

/**
 * The two circular controls. Kept out of the scale because they are not
 * steps — they are the only fully-round shapes in the app, and naming them
 * stops a `borderRadius: 999` from creeping in elsewhere.
 */
export const radiusFull = {
  /** The record button in Speak. */
  record: 88,
  /** The pause button in Speak. */
  pause: 72,
} as const;
