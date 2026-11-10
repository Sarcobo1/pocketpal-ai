import React from 'react';
import {View} from 'react-native';

/**
 * Jest stand-in for `bot-avatars-native`.
 *
 * The real port renders through Skia (a native module) and bakes forms on a
 * timer, neither of which exists under Jest. Tests that mount a screen
 * containing a ghost only need the layout box and the accessibility label,
 * so this renders a plain View carrying the same props.
 *
 * It is a *test double*, not a re-implementation: nothing here draws.
 */
export const BotAvatar = ({size = 64, accessibilityLabel, testID, ...rest}) =>
  React.createElement(View, {
    accessibilityLabel,
    testID,
    style: {width: size, height: size},
    ...rest,
  });

export const BotAvatarSheet = ({children, style}) =>
  React.createElement(View, {style}, children);

export const useBotAvatarSheet = () => null;
export const resolveBotAvatarConfig = () => ({});
export const devicePixelRatio = () => 1;

export default BotAvatar;
