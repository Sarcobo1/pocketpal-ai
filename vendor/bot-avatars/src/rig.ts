/**
 * Rig-only entry point for the vendored `bot-avatars` web package.
 *
 * Upstream's `src/index.ts` also exports `<BotAvatar>`, a React DOM component
 * that renders into an `HTMLCanvasElement`. This app never mounts it — the
 * React Native port (`bot-avatars-native`) draws with Skia and imports only
 * the browser-free half of the package:
 *
 *   - `engine`  — the rig: poses, states, the jump curve
 *   - `presets` — the eighteen body types, faces, palette, labels
 *   - `shapes`  — the SVG outline paths
 *   - `color`   — colour parsing and shading maths
 *   - `plastic` — the form/matcap bake maths the port feeds into its shader
 *
 * Everything here is pure maths and data. Nothing in this barrel touches
 * `document`, `window` or a canvas at import time, so it is safe to bundle
 * into a React Native app.
 *
 * This file is a local addition (see `vendor/NOTICE.md`); no upstream source
 * was modified.
 */

export {
  botAvatarPresets,
  botAvatarPalette,
  botAvatarTypes,
  botAvatarFaces,
  botAvatarStates,
} from './presets';
export {SHAPE_PATHS as botAvatarShapes, SHAPE_PARTS as botAvatarParts} from './shapes';
export {autoInk, luminance, parseColor, shade} from './color';
export {Sim as BotAvatarSim, restPose, JUMP_DEFAULTS as botAvatarJumpDefaults} from './engine';
/* the layout constants the native port's canvas sizing mirrors */
export {OVERSCAN as BOT_AVATAR_OVERSCAN, RISE as BOT_AVATAR_RISE} from './draw';
export {
  buildForm as bakeBotAvatarForm,
  buildMatcap as buildBotAvatarMatcap,
  shadeTexels as shadeBotAvatarTexels,
  capFrame as botAvatarCapFrame,
  tierFor as botAvatarTier,
  PAD as BOT_AVATAR_PAD,
  SPAN as BOT_AVATAR_SPAN,
  MATCAP_SIZE as BOT_AVATAR_MATCAP_SIZE,
} from './plastic';

export type {Form as BotAvatarForm, Frame as BotAvatarFrame, Material as BotAvatarMaterial, Rig as BotAvatarRig} from './plastic';
export type {JumpConfig as BotAvatarJumpConfig, Pose as BotAvatarPose} from './engine';
export type {
  BotAvatarProps,
  BotAvatarType,
  BotAvatarFace,
  BotAvatarState,
  BotAvatarShading,
  BotAvatarSquashEase,
  BotAvatarPreset,
  BotAvatarHat,
  BotAvatarGlasses,
} from './types';
