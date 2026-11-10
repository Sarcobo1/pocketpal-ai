/**
 * Tests for the Limi typography surface.
 *
 * What this pins:
 *   - The scale numbers the spec names (28/32 heading, 16/24 body, 14/20
 *     secondary, 12/16 meta, 20/28 Speak).
 *   - No letter-spacing anywhere.
 *   - Geist for prose, Geist Mono for numbers, JetBrains Mono for code.
 *   - The Uzbek Latin fallback: Geist has no U+02BB, so `uz` must resolve to
 *     Inter. This is a real glyph-coverage gap, verified against the bundled
 *     cmap — not a preference.
 *   - Absolute px line-heights only.
 */
import type {AvailableLanguage} from '../../../locales';

import {
  FONT_FAMILIES,
  NON_LATIN_LOCALES,
  resolveTokens,
  typography,
  typographyForLocale,
} from '../index';

describe('typography tokens', () => {
  describe('the Limi scale', () => {
    it('heading is 28/32 at weight 500', () => {
      expect(typography.headlineH1).toMatchObject({
        fontFamily: FONT_FAMILIES.GEIST_MEDIUM,
        fontSize: 28,
        lineHeight: 32,
        fontWeight: '500',
      });
    });

    it('body is 16/24 at weight 400', () => {
      expect(typography.bodyM).toMatchObject({
        fontFamily: FONT_FAMILIES.GEIST_REGULAR,
        fontSize: 16,
        lineHeight: 24,
        fontWeight: '400',
      });
    });

    it('secondary is 14/20', () => {
      expect(typography.bodyS).toMatchObject({fontSize: 14, lineHeight: 20});
    });

    it('meta is 12/16', () => {
      expect(typography.captionM).toMatchObject({fontSize: 12, lineHeight: 16});
    });

    it('Speak transcript is 20/28', () => {
      expect(typography.speakM).toMatchObject({
        fontFamily: FONT_FAMILIES.GEIST_REGULAR,
        fontSize: 20,
        lineHeight: 28,
      });
    });

    it('has no letter-spacing on any token', () => {
      for (const key of Object.keys(typography) as Array<
        keyof typeof typography
      >) {
        expect(typography[key].letterSpacing).toBeUndefined();
      }
    });

    it('every token has a numeric absolute lineHeight', () => {
      for (const key of Object.keys(typography) as Array<
        keyof typeof typography
      >) {
        const style = typography[key];
        expect(typeof style.lineHeight).toBe('number');
        expect(Number.isFinite(style.lineHeight)).toBe(true);
      }
    });
  });

  describe('families', () => {
    it('prose uses Geist', () => {
      expect(typography.bodyM.fontFamily).toBe(FONT_FAMILIES.GEIST_REGULAR);
      expect(typography.titleL.fontFamily).toBe(FONT_FAMILIES.GEIST_MEDIUM);
    });

    it('numbers use Geist Mono with tabular figures', () => {
      expect(typography.monoM.fontFamily).toBe(
        FONT_FAMILIES.GEIST_MONO_REGULAR,
      );
      expect(typography.monoM.fontVariant).toEqual(['tabular-nums']);
      expect(typography.monoS.fontVariant).toEqual(['tabular-nums']);
    });

    it('code uses JetBrains Mono', () => {
      expect(typography.codeM.fontFamily).toBe(
        FONT_FAMILIES.JETBRAINS_MONO_REGULAR,
      );
    });

    it('Inter and Fraunces are not the primary family of any token', () => {
      for (const key of Object.keys(typography) as Array<
        keyof typeof typography
      >) {
        const family = typography[key].fontFamily;
        expect(family).not.toBe(FONT_FAMILIES.INTER_REGULAR);
        expect(family).not.toBe(FONT_FAMILIES.INTER_MEDIUM);
        expect(family).not.toMatch(/Fraunces/);
      }
    });
  });

  describe('locale fallback', () => {
    it('Latin locales keep Geist', () => {
      const latinLocales: AvailableLanguage[] = ['en', 'id', 'ms', 'pt'];
      for (const locale of latinLocales) {
        expect(typographyForLocale('bodyM', locale).fontFamily).toBe(
          FONT_FAMILIES.GEIST_REGULAR,
        );
      }
    });

    it('Uzbek Latin falls back to Inter (Geist has no U+02BB)', () => {
      // The whole reason `uz` is on the list: oʻ and gʻ are U+02BB, which the
      // bundled Geist cmap does not cover. Inter does.
      expect(NON_LATIN_LOCALES).toContain('uz');
      expect(typographyForLocale('bodyM', 'uz').fontFamily).toBe(
        FONT_FAMILIES.INTER_REGULAR,
      );
      expect(typographyForLocale('titleL', 'uz').fontFamily).toBe(
        FONT_FAMILIES.INTER_MEDIUM,
      );
    });

    it.each(NON_LATIN_LOCALES)(
      '%s falls back to the Inter cut of the same weight',
      locale => {
        const body = typographyForLocale('bodyM', locale);
        expect(body.fontFamily).toBe(FONT_FAMILIES.INTER_REGULAR);
        expect(body.fontSize).toBe(typography.bodyM.fontSize);
        expect(body.lineHeight).toBe(typography.bodyM.lineHeight);

        const title = typographyForLocale('titleL', locale);
        expect(title.fontFamily).toBe(FONT_FAMILIES.INTER_MEDIUM);
        expect(title.fontSize).toBe(typography.titleL.fontSize);
      },
    );

    it('Cyrillic locales keep Geist (Geist covers Cyrillic)', () => {
      expect(NON_LATIN_LOCALES).not.toContain('ru');
      expect(NON_LATIN_LOCALES).not.toContain('uk');
      expect(typographyForLocale('bodyM', 'ru').fontFamily).toBe(
        FONT_FAMILIES.GEIST_REGULAR,
      );
    });
  });

  describe('mode resolution', () => {
    it('resolveTokens("dark") returns the Limi ground', () => {
      expect(resolveTokens('dark').colors.background).toBe('#04110E');
    });

    it('resolveTokens("light") returns the light ground', () => {
      expect(resolveTokens('light').colors.background).toBe('#F7FBF9');
    });

    it('typography binding is shared across modes', () => {
      expect(resolveTokens('light').typography).toBe(
        resolveTokens('dark').typography,
      );
    });
  });
});
