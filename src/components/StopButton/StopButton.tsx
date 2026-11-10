import * as React from 'react';
import {
  GestureResponderEvent,
  StyleSheet,
  TouchableOpacity,
  TouchableOpacityProps,
} from 'react-native';

import {useTheme} from '../../hooks';
import {StopIcon} from '../../assets/icons';

// import {L10nContext} from '../../utils';

export interface StopButtonPropsAdditionalProps {
  touchableOpacityProps?: TouchableOpacityProps;
}

export interface StopButtonProps extends StopButtonPropsAdditionalProps {
  /** Callback for stop button tap event */
  onPress?: () => void;
  color?: string;
}

export const StopButton = ({
  onPress,
  touchableOpacityProps,
  color,
}: StopButtonProps) => {
  // const l10n = React.useContext(L10nContext);
  const theme = useTheme();
  const handlePress = (event: GestureResponderEvent) => {
    if (onPress) {
      onPress();
    }
    touchableOpacityProps?.onPress?.(event);
  };

  return (
    <TouchableOpacity
      //accessibilityLabel={l10n.stopButtonAccessibilityLabel}
      accessibilityRole="button"
      testID="stop-button"
      {...touchableOpacityProps}
      onPress={handlePress}
      style={[styles.stopButton, {backgroundColor: theme.colors.primary}]}>
      <StopIcon
        stroke={color ?? theme.colors.onPrimary}
        width={20}
        height={20}
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  stopButton: {
    marginLeft: 16,
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
