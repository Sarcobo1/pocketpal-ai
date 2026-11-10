/**
 * Color tokens — Limi (Emerald, dark-first).
 *
 * The palette is a single accent system on a deep green-black ground. Depth
 * comes from surface steps and hairlines only: no glow, no gradient, no
 * coloured shadow, no blur. `primary` (mint) is the ONE accent — it is
 * reserved for the primary button, the active selection, and a single
 * important icon or number. Everything else is a surface step or a text tier.
 *
 * Dark is the default and the only fully-tuned binding. The light binding
 * mirrors the same structure with the same keys so nothing breaks if a light
 * mode is switched on, but it is deliberately plain — Limi ships dark.
 *
 * Every key here is consumed through `theme.colors.*`; components never
 * hardcode a hex. See src/theme/tokens/types.ts for the contract.
 *
 * `withOpacity` is used only where a value is genuinely a translucent
 * overlay (hairlines, scrims, state layers) — never to fake a surface step,
 * which is what the numbered surface tokens are for.
 */
import {withOpacity, stateLayerOpacity} from '../../utils/colorUtils';

import {TokenColors} from './types';

// ---------------------------------------------------------------------------
// Limi dark — the shipped palette.
// ---------------------------------------------------------------------------

/** The deepest ground: the board, insets, wells. */
const DARK_DEEPEST = '#030A08';
/** App background. */
const DARK_BACKGROUND = '#04110E';
/** Cards, sheets, message panels. */
const DARK_SURFACE = '#0B1E19';
/** Raised: inputs, buttons, the user's message, the active row. */
const DARK_RAISED = '#17342B';
/** Second surface: a step between background and raised. */
const DARK_SURFACE_2 = '#0F2A22';
/** Hairline / outline. */
const DARK_LINE = 'rgba(236, 253, 245, 0.08)';
/** Active / dashed border. */
const DARK_LINE_ACTIVE = '#24483C';

/** Primary text. */
const DARK_TEXT = '#ECFDF5';
/** Secondary text. */
const DARK_TEXT_2 = '#A3C9BC';
/** Faint text — meta only, never body copy. */
const DARK_TEXT_3 = '#7FA99A';
/** Icons and chevrons. */
const DARK_ICON = '#4A7A69';

/** The one accent. */
const DARK_ACCENT = '#34D399';
/** Text on the accent. */
const DARK_ON_ACCENT = '#04110E';
/** Positive / success. */
const DARK_POSITIVE = '#4CC38A';
/** Error. */
const DARK_ERROR = '#E5484D';
/** Function names inside code. */
const DARK_CODE_FN = '#7DD3FC';

export const darkColors: TokenColors = {
  // MD3 base palette — mapped onto the Limi accent system.
  primary: DARK_ACCENT,
  onPrimary: DARK_ON_ACCENT,
  primaryContainer: DARK_RAISED,
  onPrimaryContainer: DARK_TEXT,
  // The legacy blue/purple secondary and tertiary are gone: they are mapped
  // onto the same neutral surface steps so nothing can render in the old
  // palette even if a Paper component reaches for them.
  secondary: DARK_TEXT_2,
  onSecondary: DARK_BACKGROUND,
  secondaryContainer: DARK_RAISED,
  onSecondaryContainer: DARK_TEXT,
  tertiary: DARK_TEXT_2,
  onTertiary: DARK_BACKGROUND,
  tertiaryContainer: DARK_SURFACE_2,
  onTertiaryContainer: DARK_TEXT,

  error: DARK_ERROR,
  onError: '#FFFFFF',
  errorContainer: DARK_RAISED,
  onErrorContainer: DARK_ERROR,

  background: DARK_BACKGROUND,
  onBackground: DARK_TEXT,
  surface: DARK_SURFACE,
  onSurface: DARK_TEXT,
  surfaceVariant: DARK_RAISED,
  onSurfaceVariant: DARK_TEXT_2,
  outline: DARK_LINE,
  outlineVariant: DARK_LINE_ACTIVE,
  mutedLight: DARK_SURFACE_2,
  secondaryDefault: DARK_RAISED,

  // MD3 extras
  surfaceDisabled: withOpacity(DARK_TEXT, 0.12),
  onSurfaceDisabled: withOpacity(DARK_TEXT, 0.38),
  inverseSurface: DARK_TEXT,
  inverseOnSurface: DARK_BACKGROUND,
  inversePrimary: DARK_ACCENT,
  inverseSecondary: DARK_TEXT_2,
  shadow: '#000000',
  scrim: 'rgba(3, 10, 8, 0.72)',
  backdrop: 'rgba(3, 10, 8, 0.82)',

  // Surface steps — the ONLY way depth is expressed.
  surfaceContainerHighest: DARK_RAISED,
  surfaceContainerHigh: DARK_RAISED,
  surfaceContainer: DARK_SURFACE,
  surfaceContainerLow: DARK_SURFACE_2,
  surfaceContainerLowest: DARK_DEEPEST,
  surfaceDim: DARK_DEEPEST,
  surfaceBright: DARK_RAISED,

  // Text tiers
  text: DARK_TEXT,
  textSecondary: DARK_TEXT_2,
  inverseText: DARK_BACKGROUND,
  inverseTextSecondary: withOpacity(DARK_BACKGROUND, 0.6),

  // Border / placeholder
  border: DARK_LINE,
  placeholder: DARK_TEXT_3,

  // Interactive state opacities
  stateLayerOpacity: 0.12,
  hoverStateOpacity: stateLayerOpacity.hover,
  pressedStateOpacity: stateLayerOpacity.pressed,
  draggedStateOpacity: stateLayerOpacity.dragged,
  focusStateOpacity: stateLayerOpacity.focus,

  // Menu — a solid raised surface, never translucent.
  menuBackground: DARK_SURFACE,
  menuBackgroundDimmed: DARK_SURFACE,
  menuBackgroundActive: DARK_RAISED,
  menuSeparator: DARK_LINE,
  menuGroupSeparator: DARK_LINE,
  menuText: DARK_TEXT,
  menuDangerText: DARK_ERROR,

  // Messages
  authorBubbleBackground: DARK_RAISED,
  receivedMessageDocumentIcon: DARK_ICON,
  sentMessageDocumentIcon: DARK_TEXT_2,
  userAvatarImageBackground: 'transparent',
  // One neutral ramp: the old four-colour avatar palette was the loudest
  // leftover of the previous theme.
  userAvatarNameColors: [DARK_TEXT_2, DARK_TEXT_2, DARK_TEXT_2, DARK_TEXT_2],
  searchBarBackground: DARK_RAISED,

  // Thinking bubble — a surface step plus a hairline, not a tinted blue card.
  thinkingBubbleBackground: DARK_SURFACE_2,
  thinkingBubbleText: DARK_TEXT_2,
  thinkingBubbleBorder: DARK_LINE,
  thinkingBubbleShadow: 'transparent',
  thinkingBubbleChevronBackground: DARK_RAISED,
  thinkingBubbleChevronBorder: DARK_LINE,

  // Status bar
  bgStatusActive: DARK_POSITIVE,
  bgStatusIdle: DARK_ICON,
  statusLoaded: DARK_POSITIVE,

  // Buttons
  btnPrimaryBg: DARK_ACCENT,
  btnPrimaryBorder: DARK_ACCENT,
  btnPrimaryText: DARK_ON_ACCENT,
  btnReadyBg: DARK_RAISED,
  btnReadyBorder: DARK_LINE_ACTIVE,
  btnReadyText: DARK_POSITIVE,
  btnDownloadBg: DARK_RAISED,
  btnDownloadBorder: DARK_LINE_ACTIVE,
  btnDownloadText: DARK_ACCENT,

  // Icons — model-type glyphs share the neutral icon tier; the accent is not
  // spent on category colour.
  iconModelTypeText: DARK_ICON,
  iconModelTypeVision: DARK_ICON,
  iconModelTypeAudio: DARK_ICON,

  // Accent — the legacy peach pill is retired; both slots resolve to the
  // single Limi accent so no peach can render.
  accent: {
    peach: DARK_ACCENT,
    greenStrong: DARK_ACCENT,
  },

  // ---------------------------------------------------------------------
  // Limi additions. Appended after the MD3/legacy contract so the shape
  // stays compatible; consumed via `theme.colors.limi.*`.
  // ---------------------------------------------------------------------
  limi: {
    /** The deepest ground (board, inset wells). */
    deepest: DARK_DEEPEST,
    /** Second surface step. */
    surface2: DARK_SURFACE_2,
    /** Raised surface (input, button, user message, active row). */
    raised: DARK_RAISED,
    /** Active / dashed border. */
    lineActive: DARK_LINE_ACTIVE,
    /** Faint text — meta only. */
    textFaint: DARK_TEXT_3,
    /** Icon / chevron tier. */
    icon: DARK_ICON,
    /** The single accent. */
    accent: DARK_ACCENT,
    /** Text on the accent. */
    onAccent: DARK_ON_ACCENT,
    /** Positive / success. */
    positive: DARK_POSITIVE,
    /** Function names inside code. */
    codeFn: DARK_CODE_FN,
  },
};

// ---------------------------------------------------------------------------
// Limi light — same structure, deliberately plain. Limi ships dark; this
// binding exists so a light mode is a switch, not a rewrite.
// ---------------------------------------------------------------------------

const LIGHT_BACKGROUND = '#F7FBF9';
const LIGHT_SURFACE = '#FFFFFF';
const LIGHT_RAISED = '#EAF4EF';
const LIGHT_SURFACE_2 = '#F1F8F4';
const LIGHT_DEEPEST = '#E3EFE8';
const LIGHT_LINE = 'rgba(4, 17, 14, 0.08)';
const LIGHT_LINE_ACTIVE = '#B7D8C9';
const LIGHT_TEXT = '#04110E';
const LIGHT_TEXT_2 = '#3F6155';
const LIGHT_TEXT_3 = '#6B8B7E';
const LIGHT_ICON = '#5C8474';
const LIGHT_ACCENT = '#0F9D6E';
const LIGHT_ON_ACCENT = '#FFFFFF';
const LIGHT_POSITIVE = '#0F8A5F';
const LIGHT_ERROR = '#C62A2F';
const LIGHT_CODE_FN = '#0369A1';

export const lightColors: TokenColors = {
  primary: LIGHT_ACCENT,
  onPrimary: LIGHT_ON_ACCENT,
  primaryContainer: LIGHT_RAISED,
  onPrimaryContainer: LIGHT_TEXT,
  secondary: LIGHT_TEXT_2,
  onSecondary: LIGHT_SURFACE,
  secondaryContainer: LIGHT_RAISED,
  onSecondaryContainer: LIGHT_TEXT,
  tertiary: LIGHT_TEXT_2,
  onTertiary: LIGHT_SURFACE,
  tertiaryContainer: LIGHT_SURFACE_2,
  onTertiaryContainer: LIGHT_TEXT,

  error: LIGHT_ERROR,
  onError: '#FFFFFF',
  errorContainer: LIGHT_RAISED,
  onErrorContainer: LIGHT_ERROR,

  background: LIGHT_BACKGROUND,
  onBackground: LIGHT_TEXT,
  surface: LIGHT_SURFACE,
  onSurface: LIGHT_TEXT,
  surfaceVariant: LIGHT_RAISED,
  onSurfaceVariant: LIGHT_TEXT_2,
  outline: LIGHT_LINE,
  outlineVariant: LIGHT_LINE_ACTIVE,
  mutedLight: LIGHT_SURFACE_2,
  secondaryDefault: LIGHT_RAISED,

  surfaceDisabled: withOpacity(LIGHT_TEXT, 0.12),
  onSurfaceDisabled: withOpacity(LIGHT_TEXT, 0.38),
  inverseSurface: LIGHT_TEXT,
  inverseOnSurface: LIGHT_BACKGROUND,
  inversePrimary: LIGHT_ACCENT,
  inverseSecondary: LIGHT_TEXT_2,
  shadow: '#000000',
  scrim: 'rgba(4, 17, 14, 0.4)',
  backdrop: 'rgba(4, 17, 14, 0.5)',

  surfaceContainerHighest: LIGHT_RAISED,
  surfaceContainerHigh: LIGHT_RAISED,
  surfaceContainer: LIGHT_SURFACE,
  surfaceContainerLow: LIGHT_SURFACE_2,
  surfaceContainerLowest: LIGHT_DEEPEST,
  surfaceDim: LIGHT_DEEPEST,
  surfaceBright: LIGHT_SURFACE,

  text: LIGHT_TEXT,
  textSecondary: LIGHT_TEXT_2,
  inverseText: LIGHT_BACKGROUND,
  inverseTextSecondary: withOpacity(LIGHT_BACKGROUND, 0.6),

  border: LIGHT_LINE,
  placeholder: LIGHT_TEXT_3,

  stateLayerOpacity: 0.12,
  hoverStateOpacity: stateLayerOpacity.hover,
  pressedStateOpacity: stateLayerOpacity.pressed,
  draggedStateOpacity: stateLayerOpacity.dragged,
  focusStateOpacity: stateLayerOpacity.focus,

  menuBackground: LIGHT_SURFACE,
  menuBackgroundDimmed: LIGHT_SURFACE,
  menuBackgroundActive: LIGHT_RAISED,
  menuSeparator: LIGHT_LINE,
  menuGroupSeparator: LIGHT_LINE,
  menuText: LIGHT_TEXT,
  menuDangerText: LIGHT_ERROR,

  authorBubbleBackground: LIGHT_RAISED,
  receivedMessageDocumentIcon: LIGHT_ICON,
  sentMessageDocumentIcon: LIGHT_TEXT_2,
  userAvatarImageBackground: 'transparent',
  userAvatarNameColors: [
    LIGHT_TEXT_2,
    LIGHT_TEXT_2,
    LIGHT_TEXT_2,
    LIGHT_TEXT_2,
  ],
  searchBarBackground: LIGHT_RAISED,

  thinkingBubbleBackground: LIGHT_SURFACE_2,
  thinkingBubbleText: LIGHT_TEXT_2,
  thinkingBubbleBorder: LIGHT_LINE,
  thinkingBubbleShadow: 'transparent',
  thinkingBubbleChevronBackground: LIGHT_RAISED,
  thinkingBubbleChevronBorder: LIGHT_LINE,

  bgStatusActive: LIGHT_POSITIVE,
  bgStatusIdle: LIGHT_ICON,
  statusLoaded: LIGHT_POSITIVE,

  btnPrimaryBg: LIGHT_ACCENT,
  btnPrimaryBorder: LIGHT_ACCENT,
  btnPrimaryText: LIGHT_ON_ACCENT,
  btnReadyBg: LIGHT_RAISED,
  btnReadyBorder: LIGHT_LINE_ACTIVE,
  btnReadyText: LIGHT_POSITIVE,
  btnDownloadBg: LIGHT_RAISED,
  btnDownloadBorder: LIGHT_LINE_ACTIVE,
  btnDownloadText: LIGHT_ACCENT,

  iconModelTypeText: LIGHT_ICON,
  iconModelTypeVision: LIGHT_ICON,
  iconModelTypeAudio: LIGHT_ICON,

  accent: {
    peach: LIGHT_ACCENT,
    greenStrong: LIGHT_ACCENT,
  },

  limi: {
    deepest: LIGHT_DEEPEST,
    surface2: LIGHT_SURFACE_2,
    raised: LIGHT_RAISED,
    lineActive: LIGHT_LINE_ACTIVE,
    textFaint: LIGHT_TEXT_3,
    icon: LIGHT_ICON,
    accent: LIGHT_ACCENT,
    onAccent: LIGHT_ON_ACCENT,
    positive: LIGHT_POSITIVE,
    codeFn: LIGHT_CODE_FN,
  },
};
