import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import {Sheet} from '../Sheet';
import {useTheme} from '../../hooks';
import {GlobeIcon, CheckBoldIcon} from '../../assets/icons';

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

interface SearchConsentSheetProps {
  isVisible: boolean;
  onClose: () => void;
  onConsent: () => void;
}

export const SearchConsentSheet: React.FC<SearchConsentSheetProps> = ({
  isVisible,
  onClose,
  onConsent,
}) => {
  const theme = useTheme();

  const handleUnderstand = () => {
    ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
    onConsent();
    onClose();
  };

  return (
    <Sheet isVisible={isVisible} onClose={onClose} snapPoints={['42%']}>
      <View style={styles.container}>
        <View
          style={[
            styles.iconCircle,
            {backgroundColor: theme.colors.primaryContainer},
          ]}>
          <GlobeIcon width={28} height={28} stroke={theme.colors.primary} />
        </View>

        <Text style={[styles.title, {color: theme.colors.onSurface}]}>
          Internet qidiruvi
        </Text>

        <Text
          style={[styles.description, {color: theme.colors.onSurfaceVariant}]}>
          Model eng so'nggi ma'lumotlar, narxlar, yangiliklar va faktlarni
          bilish uchun internetdan real vaqtda qidiruv amalga oshiradi. Qidiruv
          so'rovlari xavfsiz qidiruv xizmatiga yuboriladi.
        </Text>

        <TouchableOpacity
          style={[styles.button, {backgroundColor: theme.colors.primary}]}
          onPress={handleUnderstand}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Tushunarli">
          <CheckBoldIcon
            width={18}
            height={18}
            fill={theme.colors.onPrimary}
            style={styles.btnIcon}
          />
          <Text style={[styles.buttonText, {color: theme.colors.onPrimary}]}>
            Tushunarli, yoqilsin
          </Text>
        </TouchableOpacity>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 16,
  },
  btnIcon: {
    marginRight: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
