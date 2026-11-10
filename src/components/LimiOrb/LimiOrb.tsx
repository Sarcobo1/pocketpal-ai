import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {ThinkingOrb} from 'thinking-orbs-native';
import type {OrbState} from 'thinking-orbs-native';

/**
 * Limi's thinking indicator.
 *
 * The only way the app draws an orb. The orb is `thinking-orbs-native`
 * (MIT, Jakub Antalik) — the real Skia port, drawing the same compiled
 * engine frames the web package renders.
 *
 * Two tuned size presets exist upstream (64 = avatar scale, 20 = inline
 * text scale). `size` here is the *rendered* dp; the preset is picked by
 * which one the caller is closer to, and `displaySize` scales the geometry
 * into it so the dots stay vector-crisp instead of upscaling a raster.
 */

export type LimiOrbState =
  | 'composing'
  | 'breathing'
  | 'working'
  | 'searching'
  | 'solving'
  | 'listening';

export interface LimiOrbProps {
  state?: LimiOrbState;
  /** Rendered size in dp. */
  size?: number;
  /** Accessibility label. Defaults to the port's per-state label. */
  label?: string;
  /** Freeze on the current frame. */
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The upstream presets are 64 (avatar) and 20 (inline); pick the nearer. */
const presetFor = (size: number): 64 | 20 => (size >= 32 ? 64 : 20);

export const LimiOrb: React.FC<LimiOrbProps> = ({
  state = 'working',
  size = 20,
  label,
  paused = false,
  style,
  testID,
}) => {
  return (
    <View
      style={[styles.box, {width: size, height: size}, style]}
      testID={testID}>
      <ThinkingOrb
        state={state as OrbState}
        size={presetFor(size)}
        displaySize={size}
        theme="dark"
        paused={paused}
        accessibilityLabel={label}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default LimiOrb;
