import React from 'react';
import {View, Text, TouchableOpacity} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {observer} from 'mobx-react';

import {Sheet} from '../Sheet';
import {useTheme} from '../../hooks';
import {modelStore} from '../../store';
import {createStyles} from './styles';
import {
  CameraIcon,
  AtomIcon,
  EditIcon,
  CodeIcon,
  CpuChipIcon,
  CheckBoldIcon,
} from '../../assets/icons';

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

export type OpenLimiMode = 'omni' | 'thinking' | 'auto' | 'code' | 'fast';

interface ModeOption {
  id: OpenLimiMode;
  name: string;
  description: string;
  icon: (color: string) => React.ReactNode;
  isBeta?: boolean;
}

const MODES: ModeOption[] = [
  {
    id: 'omni',
    name: 'Omni',
    description: 'Ovoz, kamera va multimodal',
    icon: color => <CameraIcon width={22} height={22} stroke={color} />,
  },
  {
    id: 'thinking',
    name: 'Fikrlash',
    description: 'Chuqur mulohaza va tahlil',
    icon: color => (
      <AtomIcon width={22} height={22} stroke={color} strokeWidth={2} />
    ),
  },
  {
    id: 'auto',
    name: 'Avto',
    description: 'Vazifaga qarab aqlli tanlash',
    icon: color => <EditIcon width={22} height={22} stroke={color} />,
  },
  {
    id: 'code',
    name: 'Kod',
    description: 'Bosqichma-bosqich kodlash va qidiruv',
    icon: color => <CodeIcon width={22} height={22} stroke={color} />,
    isBeta: true,
  },
  {
    id: 'fast',
    name: 'Tez',
    description: "Tezkor va to'g'ridan-to'g'ri javoblar",
    icon: color => <CpuChipIcon width={22} height={22} stroke={color} />,
  },
];

interface ModeSelectorSheetProps {
  isVisible: boolean;
  onClose: () => void;
  selectedMode: OpenLimiMode;
  onSelectMode: (mode: OpenLimiMode) => void;
}

export const ModeSelectorSheet: React.FC<ModeSelectorSheetProps> = observer(
  ({isVisible, onClose, selectedMode, onSelectMode}) => {
    const theme = useTheme();
    const styles = createStyles(theme);

    // Model capability check for Omni
    const mediaSupport = modelStore.activeMediaSupport;
    const isOmniSupported = Boolean(
      mediaSupport.audioInput ||
        mediaSupport.audioOutput ||
        mediaSupport.vision,
    );

    const handleSelect = (mode: OpenLimiMode, disabled?: boolean) => {
      if (disabled) {
        return;
      }
      ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
      onSelectMode(mode);
      onClose();
    };

    return (
      <Sheet isVisible={isVisible} onClose={onClose} snapPoints={['55%']}>
        <View style={styles.container}>
          {MODES.map(mode => {
            const isActive = selectedMode === mode.id;
            const isDisabled = mode.id === 'omni' && !isOmniSupported;
            const desc = isDisabled
              ? "Model multimodalni qo'llab-quvvatlamaydi"
              : mode.description;

            return (
              <TouchableOpacity
                key={mode.id}
                style={[
                  styles.optionRow,
                  isActive && styles.optionRowActive,
                  isDisabled && {opacity: 0.35},
                ]}
                onPress={() => handleSelect(mode.id, isDisabled)}
                disabled={isDisabled}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`${mode.name}${isDisabled ? ' (Nofaol)' : ''}`}>
                <View style={styles.iconWrapper}>
                  {mode.icon(
                    isDisabled
                      ? theme.colors.outline
                      : isActive
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                  )}
                </View>

                <View style={styles.textContainer}>
                  <View style={styles.titleRow}>
                    <Text
                      style={[
                        styles.title,
                        isDisabled && {color: theme.colors.outline},
                      ]}>
                      {mode.name}
                    </Text>
                    {mode.isBeta && !isDisabled && (
                      <View style={styles.betaBadge}>
                        <Text style={styles.betaBadgeText}>Beta</Text>
                      </View>
                    )}
                    {isDisabled && (
                      <View
                        style={[
                          styles.betaBadge,
                          {backgroundColor: theme.colors.surfaceVariant},
                        ]}>
                        <Text
                          style={[
                            styles.betaBadgeText,
                            {color: theme.colors.outline},
                          ]}>
                          Nofaol
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.description,
                      isDisabled && {color: theme.colors.outline},
                    ]}>
                    {desc}
                  </Text>
                </View>

                {isActive && !isDisabled && (
                  <View style={styles.checkWrapper}>
                    <CheckBoldIcon
                      width={18}
                      height={18}
                      fill={theme.colors.primary}
                    />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </Sheet>
    );
  },
);
