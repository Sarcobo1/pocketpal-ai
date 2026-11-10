import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';

export const createStyles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      gap: theme.spacing.default,
    },
    ghost: {
      marginBottom: 8,
    },
    title: {
      color: theme.colors.onSurface,
      textAlign: 'center',
      marginBottom: 8,
      ...theme.fonts.headlineSmall,
      fontFamily: 'Geist-Medium',
      fontSize: 28,
      lineHeight: 32,
      fontWeight: '500',
    },
    description: {
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      ...theme.fonts.bodyMedium,
      fontSize: 14,
      lineHeight: 20,
    },
    button: {
      minWidth: 200,
      borderRadius: 10,
      height: 44,
      justifyContent: 'center',
    },
    logo: {
      width: 112,
      height: 112,
      borderRadius: 30,
    },
  });
