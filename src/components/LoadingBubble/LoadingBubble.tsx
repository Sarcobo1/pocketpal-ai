import {View, Animated} from 'react-native';
import React, {useEffect, useRef} from 'react';
import {Text} from 'react-native-paper';

import {useTheme} from '../../hooks';
import {LimiOrb} from '../LimiOrb';
import {styles} from './styles';

export const LoadingBubble: React.FC = () => {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <View style={[styles.container, {backgroundColor: 'transparent'}]}>
      <LimiOrb state="composing" size={32} />
      <Animated.View style={{opacity}}>
        <Text style={[styles.text, {color: theme.colors.onSurfaceVariant}]}>
          O‘ylayapman…
        </Text>
      </Animated.View>
    </View>
  );
};
