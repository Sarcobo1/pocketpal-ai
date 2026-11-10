import {
  MD3DarkTheme,
  DefaultTheme as PaperLightTheme,
  configureFonts,
} from 'react-native-paper';

import {Theme} from './types';
import {
  type Mode,
  resolveTokens,
  resolveTypographyForLocale,
} from '../theme/tokens';
import {type AvailableLanguage} from '../locales';

// Note: the previous `AppTheme` enum ({Light, Dark, X1}) is gone. x1 was
// dead code (UIStore.colorScheme has been typed `'light' | 'dark'` for
// some time). The builder takes a `Mode` from the tokens module directly.

/**
 * Legacy weight map — now Geist.
 *
 * This is the single lever that moves the whole app off Inter: every MD3
 * typescale entry and every component that reads `theme.fonts.*` is built
 * from this map, so switching the families here restyles all of them at once.
 *
 * Inter is still bundled and still reachable — it is the fallback for locales
 * whose script Geist cannot cover (see NON_LATIN_LOCALES in
 * src/theme/tokens/typography.ts; Uzbek Latin's oʻ/gʻ is the sharpest case).
 * That fallback happens per-token in `resolveTypographyForLocale`, not here.
 *
 * `bold`, `thin`, `light`, `semibold` and `extraBold` have no Geist cut in
 * this bundle (only Regular and Medium ship), so they resolve to the nearest
 * shipped weight rather than naming a font that does not exist — a missing
 * family is a silent system-font fallback on iOS, which is worse than a
 * slightly lighter weight.
 */
export const fontStyles = {
  regular: {fontFamily: 'Geist-Regular'},
  medium: {fontFamily: 'Geist-Medium'},
  bold: {fontFamily: 'Geist-Medium'},
  thin: {fontFamily: 'Geist-Regular'},
  light: {fontFamily: 'Geist-Regular'},
  semibold: {fontFamily: 'Geist-Medium'},
  extraBold: {fontFamily: 'Geist-Medium'},
};

const baseFontVariants = configureFonts({
  config: {...fontStyles.regular},
});

const customVariants = {
  // Add custom variants:
  bold: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.bold,
  },
  medium: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.medium,
  },
  thin: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.thin,
  },
  light: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.light,
  },
  semibold: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.semibold,
  },
} as const;

const configuredFonts = configureFonts({
  config: {
    ...baseFontVariants,
    ...customVariants,
    displayMedium: {
      ...baseFontVariants.displayMedium,
      ...fontStyles.bold,
    },
    titleSmall: {
      ...baseFontVariants.titleSmall,
      ...fontStyles.medium,
    },
  },
});

/**
 * Build a Theme for a given (mode, language) pair.
 *
 * `mode` selects the token binding (light vs dark). `language` selects the
 * locale-aware typography surface (Geist → Inter for scripts Geist cannot
 * cover).
 *
 * The output is a superset:
 *   - `colors`: every MD3 key Paper expects, sourced from the tokens
 *     module (the Limi Emerald palette).
 *   - `typography`, `radius`, `stroke`: the Limi surface — what per-screen
 *     restyle work consumes.
 *   - `fonts`, `spacing.default`, `borders`, `insets`, `icons`: legacy
 *     surface preserved in shape so the ~18 MD3-typescale consumers + 4
 *     spacing.default consumers keep rendering — now in Geist, on the Limi
 *     palette.
 *   - Non-color/non-font Paper internals (`isV3`, `dark`, `roundness`,
 *     `animation`): inherited via `...baseTheme` spread.
 *
 * `roundness` is pinned to the Limi control radius so Paper's own components
 * (buttons, chips, cards) stop rendering as MD3 pills.
 */
export const buildTheme = ({
  mode,
  language,
}: {
  mode: Mode;
  language: AvailableLanguage;
}): Theme => {
  const baseTheme = mode === 'dark' ? MD3DarkTheme : PaperLightTheme;
  const tokens = resolveTokens(mode);
  const localeTypography = resolveTypographyForLocale(language);

  return {
    ...baseTheme,
    // Paper derives every corner from `roundness`; MD3's default of 4 is what
    // makes its buttons read as pills once padding is applied. Limi's control
    // radius is 10.
    roundness: tokens.radius.m,
    colors: {
      // Keep any Paper-internal keys (e.g. elevation tints) the tokens
      // module doesn't explicitly enumerate.
      ...baseTheme.colors,
      // Token-resolved color surface — the Limi palette.
      ...tokens.colors,
    },
    borders: {
      inputBorderRadius: tokens.radius.m,
      messageBorderRadius: tokens.radius.ml,
      default: tokens.radius.m,
    },
    // Legacy fonts surface — same shape, Geist families.
    fonts: {
      ...baseTheme.fonts,
      ...configuredFonts,
      titleMediumLight: {
        ...fontStyles.regular,
        fontSize: 16,
        lineHeight: 22,
      },
      dateDividerTextStyle: {
        ...fontStyles.medium,
        color: tokens.colors.onSurface,
        fontSize: 12,
        lineHeight: 16,
        opacity: 0.4,
      },
      emptyChatPlaceholderTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 16,
        lineHeight: 24,
        ...fontStyles.medium,
      },
      inputTextStyle: {
        fontSize: 16,
        lineHeight: 24,
        ...fontStyles.regular,
      },
      receivedMessageBodyTextStyle: {
        color: tokens.colors.onSurfaceVariant,
        fontSize: 16,
        lineHeight: 24,
        ...fontStyles.regular,
      },
      receivedMessageCaptionTextStyle: {
        color: tokens.colors.limi.textFaint,
        fontSize: 12,
        lineHeight: 16,
        ...fontStyles.regular,
      },
      receivedMessageLinkDescriptionTextStyle: {
        color: tokens.colors.onSurfaceVariant,
        fontSize: 14,
        lineHeight: 20,
        ...fontStyles.regular,
      },
      receivedMessageLinkTitleTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 16,
        lineHeight: 22,
        ...fontStyles.medium,
      },
      sentMessageBodyTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 16,
        lineHeight: 24,
        ...fontStyles.regular,
      },
      sentMessageCaptionTextStyle: {
        color: tokens.colors.limi.textFaint,
        fontSize: 12,
        lineHeight: 16,
        ...fontStyles.regular,
      },
      sentMessageLinkDescriptionTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 14,
        lineHeight: 20,
        ...fontStyles.regular,
      },
      sentMessageLinkTitleTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 16,
        lineHeight: 22,
        ...fontStyles.medium,
      },
      userAvatarTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 12,
        lineHeight: 16,
        ...fontStyles.medium,
      },
      userNameTextStyle: {
        fontSize: 12,
        lineHeight: 16,
        ...fontStyles.medium,
      },
    },
    insets: {
      messageInsetsHorizontal: 20,
      messageInsetsVertical: 10,
    },
    // Spacing is the token scale + the legacy `default` key.
    // `default === spacing.m === 16` matches today's `theme.spacing.default`.
    spacing: {
      ...tokens.spacing,
      default: 16,
    },
    radius: tokens.radius,
    stroke: tokens.stroke,
    typography: localeTypography,
    icons: {},
  };
};

// En-locale snapshot exports — used by jest fixtures and any non-React
// caller that doesn't have access to `useTheme()`. Locale-swapped values
// are only observable via the hook.
export const lightTheme = buildTheme({mode: 'light', language: 'en'});
export const darkTheme = buildTheme({mode: 'dark', language: 'en'});
