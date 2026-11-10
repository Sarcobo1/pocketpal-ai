/**
 * Tests for the Limi token scales.
 *
 * Pins the three radii that are actually in use (10 / 16 / 20), the two
 * circular controls that are not steps (88 / 72), the 4px spacing scale, and
 * the uniform row height.
 */
import {
  MIN_TOUCH_TARGET,
  ROW_HEIGHT,
  radius,
  radiusFull,
  spacing,
  stroke,
} from '../index';

describe('design-token scales — Limi', () => {
  describe('radius', () => {
    it('buttons, chips and inputs are 10', () => {
      expect(radius.m).toBe(10);
    });

    it('cards are 16', () => {
      expect(radius.ml).toBe(16);
    });

    it('panels and message panels are 20', () => {
      expect(radius.l).toBe(20);
    });

    it('exposes exactly the canonical scale keys', () => {
      expect(Object.keys(radius).sort()).toEqual(
        ['none', 'xxs', 'xs', 's', 'm', 'ml', 'l', 'xl', 'xxl'].sort(),
      );
    });

    it('has no alias or kebab-case keys', () => {
      for (const key of Object.keys(radius)) {
        expect(key).not.toContain('-');
        expect(key).not.toContain('/');
      }
    });

    it('reserves fully-round for the record and pause controls only', () => {
      expect(radiusFull.record).toBe(88);
      expect(radiusFull.pause).toBe(72);
      // Nothing in the step scale is a pill.
      for (const value of Object.values(radius)) {
        expect(value).toBeLessThan(88);
      }
    });
  });

  describe('spacing', () => {
    it('is a 4px scale', () => {
      expect(spacing).toEqual({
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
      });
    });

    it('every layout step above 2 is a multiple of 4', () => {
      for (const [key, value] of Object.entries(spacing)) {
        if (key === 'none' || key === 'xxs') {
          continue;
        }
        expect(value % 4).toBe(0);
      }
    });

    it('row height is uniform and inside the 44–52 band', () => {
      expect(ROW_HEIGHT).toBeGreaterThanOrEqual(44);
      expect(ROW_HEIGHT).toBeLessThanOrEqual(52);
    });

    it('the minimum touch target is 44', () => {
      expect(MIN_TOUCH_TARGET).toBe(44);
    });
  });

  describe('stroke', () => {
    it('exposes the canonical scale (0.5/1/1.5/3)', () => {
      expect(stroke).toEqual({xs: 0.5, sm: 1, md: 1.5, lg: 3});
    });

    it('icons use the 1.5 hairline', () => {
      expect(stroke.md).toBe(1.5);
    });
  });
});
