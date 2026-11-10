import React from 'react';
import {View} from 'react-native';
import {Text} from 'react-native-paper';
import {useNavigation} from '@react-navigation/native';

import {LimiGhost} from '../../../components/LimiGhost';
import {useTheme} from '../../../hooks';
import {ROUTES} from '../../../utils/navigationConstants';
import {createStyles} from './styles';

const SPLASH_MIN_DWELL_MS = 600;

/**
 * Brand splash — post-hydration, pre-Onboarding-1.
 * Renders LimiGhost (default) + "Limi" (56/500).
 */
export const SplashScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const styles = createStyles(theme);

  React.useEffect(() => {
    const t = setTimeout(() => {
      navigation.replace(ROUTES.ONBOARDING.STEP_1);
    }, SPLASH_MIN_DWELL_MS);
    return () => clearTimeout(t);
  }, [navigation]);

  return (
    <View testID="onboarding-splash" style={styles.root}>
      <LimiGhost size={100} state="default" label="Limi" />
      <Text style={styles.brandTitle}>Limi</Text>
    </View>
  );
};
