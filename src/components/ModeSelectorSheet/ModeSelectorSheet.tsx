import React from 'react';
import {View, Text, TouchableOpacity} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import {Sheet} from '../Sheet';
import {useTheme} from '../../hooks';
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
    description: 'Ovoz va kamera · Gemma 3n',
    icon: color => <CameraIcon width={22} height={22} stroke={color} />,
  },
  {
    id: 'thinking',
    name: 'Fikrlash',
    description: "Chuqur o'ylaydi · Qwen3 4B",
    icon: color => <AtomIcon width={22} height={22} stroke={color} strokeWidth={2} />,
  },
  {
    id: 'auto',
    name: 'Avto',
    description: "Tez yoki Fikrlashni tanlaydi",
    icon: color => <EditIcon width={22} height={22} stroke={color} />,
  },
  {
    id: 'code',
    name: 'Kod',
    description: 'Kod yozish · Qwen2.5 Coder',
    icon: color => <CodeIcon width={22} height={22} stroke={color} />,
    isBeta: true,
  },
  {
    id: 'fast',
    name: 'Tez',
    description: 'Tezkor javoblar · Qwen3 4B',
    icon: color => <CpuChipIcon width={22} height={22} stroke={color} />,
  },
];

interface ModeSelectorSheetProps {
  isVisible: boolean;
  onClose: () => void;
  selectedMode: OpenLimiMode;
  onSelectMode: (mode: OpenLimiMode) => void;
}

export const ModeSelectorSheet: React.FC<ModeSelectorSheetProps> = ({
  isVisible,
  onClose,
  selectedMode,
  onSelectMode,
}) => {
  const theme = useTheme();
  const styles = createStyles(theme);

  const handleSelect = (mode: OpenLimiMode) => {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    onSelectMode(mode);
    onClose();
  };

  return (
    <Sheet isVisible={isVisible} onClose={onClose} snapPoints={['55%']}>
      <View style={styles.container}>
        {MODES.map(mode => {
          const isActive = selectedMode === mode.id;
          return (
            <TouchableOpacity
              key={mode.id}
              style={[styles.optionRow, isActive && styles.optionRowActive]}
              onPress={() => handleSelect(mode.id)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={mode.name}>
              <View style={styles.iconWrapper}>
                {mode.icon(isActive ? theme.colors.primary : theme.colors.onSurfaceVariant)}
              </View>

              <View style={styles.textContainer}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{mode.name}</Text>
                  {mode.isBeta && (
                    <View style={styles.betaBadge}>
                      <Text style={styles.betaBadgeText}>Beta</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.description}>{mode.description}</Text>
              </View>

              {isActive && (
                <View style={styles.checkWrapper}>
                  <CheckBoldIcon width={18} height={18} fill={theme.colors.primary} />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </Sheet>
  );
};
