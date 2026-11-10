import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {BotAvatar} from 'bot-avatars-native';

/**
 * Limi's face.
 *
 * The only way the app draws the ghost. Everything else (chat rows, the
 * empty state, the drawer header, the splash, the lesson narrator) goes
 * through this component so the body type, the palette and the reduced-motion
 * behaviour stay in one place.
 *
 * The avatar itself is `bot-avatars-native` (MIT, Jakub Antalik) — the real
 * port, not a redrawn copy. `type="ghost"` picks the ghost body from the
 * upstream preset table; `state` maps to the port's three rig states.
 */

export type LimiGhostState = 'default' | 'working' | 'sleeping';

export interface LimiGhostProps {
  /** Rig state. `default` is idle, `working` hops and spins, `sleeping` dozes. */
  state?: LimiGhostState;
  /** Rendered size in points. */
  size?: number;
  /** Accessibility label. Defaults to the port's own "<type> bot, <state>". */
  label?: string;
  /** Turn off the tap-to-hop / drag-to-look interaction. */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The ghost's body colour — the mint-tinted white the design calls for. */
const GHOST_COLOR = '#ECFDF5';

export const LimiGhost: React.FC<LimiGhostProps> = ({
  state = 'default',
  size = 36,
  label,
  interactive = false,
  style,
  testID,
}) => {
  return (
    <View
      style={[styles.box, {width: size, height: size}, style]}
      testID={testID}>
      <BotAvatar
        type="ghost"
        state={state}
        size={size}
        color={GHOST_COLOR}
        interactive={interactive}
        accessibilityLabel={label}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    // The port draws into a canvas taller than the layout box (a hop must not
    // clip), so the box itself never clips and never scrolls.
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default LimiGhost;
