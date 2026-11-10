/**
 * Color-token tests — Limi (Emerald, dark-first).
 *
 * These pin the things that would silently regress a restyle:
 *   - The exact ground/surface/raised/accent hexes the design names.
 *   - One accent only: the legacy blue/purple secondary and tertiary are
 *     mapped onto neutral steps, so nothing can render in the old palette.
 *   - The legacy peach pill is retired.
 *   - Text tiers stay legible against the ground (WCAG AA for body copy).
 */
import {darkColors, lightColors} from '../colors';

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('design-token colors — Limi', () => {
  describe('the dark binding is the shipped palette', () => {
    it('ground is #04110E', () => {
      expect(darkColors.background).toBe('#04110E');
    });

    it('cards are #0B1E19', () => {
      expect(darkColors.surface).toBe('#0B1E19');
    });

    it('raised surfaces are #17342B', () => {
      expect(darkColors.limi.raised).toBe('#17342B');
      expect(darkColors.surfaceVariant).toBe('#17342B');
    });

    it('the deepest ground is #030A08', () => {
      expect(darkColors.limi.deepest).toBe('#030A08');
    });

    it('the second surface is #0F2A22', () => {
      expect(darkColors.limi.surface2).toBe('#0F2A22');
    });

    it('the active/dashed border is #24483C', () => {
      expect(darkColors.limi.lineActive).toBe('#24483C');
    });

    it('the accent is mint #34D399', () => {
      expect(darkColors.primary).toBe('#34D399');
      expect(darkColors.limi.accent).toBe('#34D399');
    });

    it('text on the accent is the ground colour', () => {
      expect(darkColors.onPrimary).toBe('#04110E');
    });

    it('text tiers are #ECFDF5 / #A3C9BC / #7FA99A', () => {
      expect(darkColors.onBackground).toBe('#ECFDF5');
      expect(darkColors.onSurfaceVariant).toBe('#A3C9BC');
      expect(darkColors.limi.textFaint).toBe('#7FA99A');
    });

    it('icons are #4A7A69', () => {
      expect(darkColors.limi.icon).toBe('#4A7A69');
    });

    it('error is #E5484D and positive is #4CC38A', () => {
      expect(darkColors.error).toBe('#E5484D');
      expect(darkColors.limi.positive).toBe('#4CC38A');
    });

    it('code function names are #7DD3FC', () => {
      expect(darkColors.limi.codeFn).toBe('#7DD3FC');
    });
  });

  describe('one accent only', () => {
    it('secondary and tertiary are neutral, not blue or purple', () => {
      // The old theme's #1E4DF6 / #7880FF / #95ABE6 / #80E6E4 must be gone.
      const retired = ['#1E4DF6', '#7880FF', '#95ABE6', '#80E6E4', '#014C4C'];
      const values = [
        darkColors.secondary,
        darkColors.tertiary,
        darkColors.secondaryContainer,
        darkColors.tertiaryContainer,
        lightColors.secondary,
        lightColors.tertiary,
      ];
      for (const value of values) {
        expect(retired).not.toContain(value.toUpperCase());
      }
    });

    it('the legacy peach pill is retired', () => {
      expect(darkColors.accent.peach).toBe(darkColors.primary);
      expect(lightColors.accent.peach).toBe(lightColors.primary);
      expect(darkColors.accent.peach).not.toBe('#7A4A1F');
      expect(lightColors.accent.peach).not.toBe('#FCE7CF');
    });

    it('model-type icons share the neutral icon tier', () => {
      expect(darkColors.iconModelTypeText).toBe(darkColors.limi.icon);
      expect(darkColors.iconModelTypeVision).toBe(darkColors.limi.icon);
      expect(darkColors.iconModelTypeAudio).toBe(darkColors.limi.icon);
    });
  });

  describe('legibility', () => {
    it.each([
      ['light', lightColors],
      ['dark', darkColors],
    ])('body text clears AA (4.5:1) on the %s ground', (_mode, colors) => {
      expect(
        contrast(colors.onBackground, colors.background),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it.each([
      ['light', lightColors],
      ['dark', darkColors],
    ])('secondary text clears AA on the %s ground', (_mode, colors) => {
      expect(
        contrast(colors.onSurfaceVariant, colors.background),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it.each([
      ['light', lightColors],
      ['dark', darkColors],
    ])('the accent clears 3:1 against the %s ground', (_mode, colors) => {
      expect(
        contrast(colors.primary, colors.background),
      ).toBeGreaterThanOrEqual(3);
    });

    it('text on the accent clears AA', () => {
      expect(
        contrast(darkColors.onPrimary, darkColors.primary),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it('statusLoaded stands out 3:1 against the ground', () => {
      expect(
        contrast(darkColors.statusLoaded, darkColors.background),
      ).toBeGreaterThanOrEqual(3);
    });
  });

  describe('light binding mirrors the structure', () => {
    it('has every limi key the dark binding has', () => {
      expect(Object.keys(lightColors.limi).sort()).toEqual(
        Object.keys(darkColors.limi).sort(),
      );
    });

    it('has every top-level key the dark binding has', () => {
      expect(Object.keys(lightColors).sort()).toEqual(
        Object.keys(darkColors).sort(),
      );
    });
  });
});
