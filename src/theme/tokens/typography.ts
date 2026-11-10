/**
 * Typography tokens — Limi.
 *
 * Two families:
 *   - Geist (400 / 500) for every piece of prose and UI text.
 *   - Geist Mono (400 / 500) for numbers, model names, t/s, RAM, sizes and
 *     timestamps. Numbers are tabular everywhere they can change in place.
 *   - JetBrains Mono stays for code blocks (it is already bundled and is the
 *     better coding face).
 *
 * Inter and Fraunces are retired. Inter is kept as a *fallback* only, for the
 * one thing Geist cannot do: Geist's cmap has no U+02BB (ʻ), the modifier
 * letter that Uzbek Latin uses for oʻ and gʻ. Inter covers it. See
 * `UZBEK_LATIN_LOCALES` below — this is a real, verified gap, not a guess.
 *
 * Invariants enforced here:
 *   - Absolute px line-heights only (no multipliers, no '%' strings).
 *   - Static weight mapping: '400' → '*-Regular', '500' → '*-Medium'.
 *   - Every fontFamily string must match a bundled font asset. Enforced by
 *     scripts/verify-fonts.js + CI.
 *
 * Scale (from the Limi spec):
 *   heading  28 / 32  weight 500
 *   body     16 / 24  weight 400
 *   secondary 14 / 20 weight 400
 *   meta     12 / 16  weight 400
 *   speak    20 / 28  weight 400  (chat + transcript text, Speak only)
 *   No letter-spacing anywhere.
 */
import {type AvailableLanguage} from '../../locales';

import {TokenTypography, TypographyStyle} from './types';

// Family-name constants. Match the PostScript names of the bundled TTFs.
export const FONT_FAMILIES = {
  GEIST_REGULAR: 'Geist-Regular',
  GEIST_MEDIUM: 'Geist-Medium',
  GEIST_MONO_REGULAR: 'GeistMono-Regular',
  GEIST_MONO_MEDIUM: 'GeistMono-Medium',
  JETBRAINS_MONO_REGULAR: 'JetBrainsMono-Regular',
  JETBRAINS_MONO_MEDIUM: 'JetBrainsMono-Medium',
  // Fallback only — see UZBEK_LATIN_LOCALES.
  INTER_REGULAR: 'Inter-Regular',
  INTER_MEDIUM: 'Inter-Medium',
} as const;

/**
 * Locales whose script Geist cannot fully render, so they fall back to Inter.
 *
 * This list is glyph-coverage driven, not script-family driven — the same
 * rule the previous Fraunces list used, and the reason it is short.
 *
 * `uz` (Uzbek Latin) is here for exactly one reason, verified against the
 * bundled Geist cmap: Geist has no U+02BB MODIFIER LETTER TURNED COMMA, which
 * is the character Uzbek orthography uses in oʻ and gʻ. Inter has it. Without
 * this fallback, every oʻ and gʻ in the Uzbek UI renders as tofu.
 *
 * `ar`, `fa`, `he`, `ja`, `ko`, `zh`, `zh_Hant` are here because Geist ships
 * Latin + Cyrillic + Greek only; those scripts need the platform font, and
 * Inter is the closest bundled face that hands them off cleanly.
 *
 * `pl` is here because Geist's Latin set stops short of the full Latin
 * Extended-A coverage Polish needs (ą ć ę ł ń ś ź ż).
 *
 * `ru`, `uk` are NOT here: Geist covers Cyrillic.
 */
export const NON_LATIN_LOCALES: ReadonlyArray<AvailableLanguage> = [
  'ar',
  'fa',
  'he',
  'ja',
  'ko',
  'pl',
  'uz',
  'zh',
  'zh_Hant',
];

const isNonLatinLocale = (locale: AvailableLanguage): boolean =>
  NON_LATIN_LOCALES.includes(locale);

/**
 * Base typography tokens — the Limi scale.
 *
 * `speakM` is the 20/28 transcript style. It is only used inside Speak, where
 * the text is read aloud and needs to be legible at arm's length; nowhere
 * else in the app uses 20px body copy.
 */
export const typography: TokenTypography = {
  // Body (Geist)
  bodyM: {
    fontFamily: FONT_FAMILIES.GEIST_REGULAR,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
  },
  bodyS: {
    fontFamily: FONT_FAMILIES.GEIST_REGULAR,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },

  // UI (Geist, medium)
  uiM: {
    fontFamily: FONT_FAMILIES.GEIST_MEDIUM,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  uiS: {
    fontFamily: FONT_FAMILIES.GEIST_MEDIUM,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },

  // Titles (Geist, medium)
  titleL: {
    fontFamily: FONT_FAMILIES.GEIST_MEDIUM,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '500',
  },
  titleM: {
    fontFamily: FONT_FAMILIES.GEIST_MEDIUM,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '500',
  },
  titleS: {
    fontFamily: FONT_FAMILIES.GEIST_MEDIUM,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
  },

  // Caption / meta (Geist)
  captionM: {
    fontFamily: FONT_FAMILIES.GEIST_REGULAR,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
  },
  captionS: {
    fontFamily: FONT_FAMILIES.GEIST_REGULAR,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '400',
  },

  // The screen heading — 28/32 at 500, per the Limi spec.
  headlineH1: {
    fontFamily: FONT_FAMILIES.GEIST_MEDIUM,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '500',
  },

  // Speak transcript text — 20/28, Speak only.
  speakM: {
    fontFamily: FONT_FAMILIES.GEIST_REGULAR,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '400',
  },

  // Code (JetBrains Mono — locale-agnostic, and the better coding face)
  codeM: {
    fontFamily: FONT_FAMILIES.JETBRAINS_MONO_REGULAR,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  codeS: {
    fontFamily: FONT_FAMILIES.JETBRAINS_MONO_REGULAR,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
  },

  // Mono metadata — model names, t/s, RAM, sizes, timestamps. Tabular, so a
  // number that changes in place does not shift the layout around it.
  monoM: {
    fontFamily: FONT_FAMILIES.GEIST_MONO_REGULAR,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  monoS: {
    fontFamily: FONT_FAMILIES.GEIST_MONO_REGULAR,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
};

/**
 * Resolve a typography style for a given (style, locale) pair.
 *
 * Fallback rule: any Geist or JetBrains family in a locale from
 * `NON_LATIN_LOCALES` swaps to the Inter cut of the same weight. The swap is
 * weight-preserving so a medium label stays medium.
 *
 * Invoked from the theme builder — components never call this directly, so
 * components remain locale-agnostic.
 */
export function typographyForLocale(
  style: keyof TokenTypography,
  locale: AvailableLanguage,
): TypographyStyle {
  const base = typography[style];
  if (!isNonLatinLocale(locale)) {
    return base;
  }
  switch (base.fontFamily) {
    case FONT_FAMILIES.GEIST_REGULAR:
    case FONT_FAMILIES.GEIST_MONO_REGULAR:
      return {...base, fontFamily: FONT_FAMILIES.INTER_REGULAR};
    case FONT_FAMILIES.GEIST_MEDIUM:
    case FONT_FAMILIES.GEIST_MONO_MEDIUM:
      return {...base, fontFamily: FONT_FAMILIES.INTER_MEDIUM};
    default:
      return base;
  }
}

/**
 * Build a locale-aware typography binding by running every key through
 * `typographyForLocale`. Used by the theme builder.
 */
export function resolveTypographyForLocale(
  locale: AvailableLanguage,
): TokenTypography {
  return (Object.keys(typography) as Array<keyof TokenTypography>).reduce(
    (acc, key) => {
      acc[key] = typographyForLocale(key, locale);
      return acc;
    },
    {} as TokenTypography,
  );
}
