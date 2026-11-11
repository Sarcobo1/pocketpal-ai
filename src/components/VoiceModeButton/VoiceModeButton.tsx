import React, {useContext} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {modelStore, voiceModeStore} from '../../store';
import {L10nContext} from '../../utils';
import {SparkleFilledIcon, VoiceWaveformIcon} from '../../assets/icons';

const HIT_SLOP = 2;
const BADGE = 18;

interface VoiceModeButtonProps {
  onPress: () => void;
}

/**
 * The composer's voice-mode button, shown in Send's place while the input
 * is empty. Styled to canonical OpenLimi `[||| Speak]` spec.
 */
export const VoiceModeButton: React.FC<VoiceModeButtonProps> = observer(
  ({onPress}) => {
    const theme = useTheme();
    const l10n = useContext(L10nContext);

    if (!voiceModeStore.supported) {
      return null;
    }
    const locked = !voiceModeStore.isUnlocked;
    const loading = modelStore.isContextLoading;
    const look = locked
      ? {
          button: {
            backgroundColor: theme.colors.surfaceVariant,
            borderColor: theme.colors.outline,
            borderWidth: theme.stroke.sm,
          },
          icon: theme.colors.onSurface,
        }
      : {
          button: {backgroundColor: theme.colors.primary},
          icon: theme.colors.onPrimary,
        };

    return (
      <Pressable
        onPress={onPress}
        disabled={loading}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={
          locked ? l10n.voiceMode.startLockedLabel : l10n.voiceMode.startLabel
        }
        accessibilityHint={locked ? l10n.voiceMode.startLockedHint : undefined}
        accessibilityState={{disabled: loading}}
        testID="voice-mode-button"
        style={[styles.button, look.button, loading && styles.disabled]}>
        <VoiceWaveformIcon width={18} height={18} color={look.icon} />
        <Text style={[styles.buttonText, {color: look.icon}]}>Speak</Text>
        {locked && (
          <View
            testID="voice-mode-lock"
            style={[
              styles.badge,
              {
                backgroundColor: theme.colors.accent.peach,
                borderColor: theme.colors.surface,
              },
            ]}>
            <SparkleFilledIcon
              width={10}
              height={10}
              fill={theme.colors.onSurface}
            />
          </View>
        )}
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  button: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginLeft: 12,
  },
  buttonText: {
    fontSize: 15,
    fontFamily: 'Geist-Medium',
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.4,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
