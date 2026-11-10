import React from 'react';
import {View} from 'react-native';

/**
 * Jest stand-in for `thinking-orbs-native`.
 *
 * The real orb records Skia pictures per frame on the UI thread; under Jest
 * there is no Skia and no frame loop. Tests only need the sized box and the
 * accessibility label, so this renders a plain View.
 *
 * It is a *test double*, not a re-implementation: nothing here draws dots.
 */
export const ThinkingOrb = ({
  state = 'working',
  size = 64,
  displaySize,
  accessibilityLabel,
  style,
}) =>
  React.createElement(View, {
    accessibilityLabel: accessibilityLabel ?? state,
    style: [{width: displaySize ?? size, height: displaySize ?? size}, style],
  });

export default ThinkingOrb;
