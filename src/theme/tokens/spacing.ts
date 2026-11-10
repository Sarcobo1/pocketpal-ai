/**
 * Spacing tokens — Limi.
 *
 * A 4px scale: 4, 8, 12, 16, 20, 24, 32. Row heights land between 44 and 52
 * and are uniform within a list; every touch target is at least 44×44.
 *
 * `none`/`xxs` exist for hairlines and optical nudges, not for layout.
 */
import {TokenSpacing} from './types';

export const spacing: TokenSpacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  s: 8,
  sm: 12,
  m: 16,
  ml: 20,
  l: 24,
  xl: 32,
  xxl: 40,
};

/**
 * The uniform row height for list rows and drawer items. One number, so a
 * settings list and a drawer list line up with each other.
 */
export const ROW_HEIGHT = 52;

/** The minimum touch target. Nothing interactive may be smaller. */
export const MIN_TOUCH_TARGET = 44;
