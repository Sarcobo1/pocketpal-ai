import {StyleSheet} from 'react-native';

import type {Theme} from '../../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandTitle: {
      fontFamily: 'Geist-Medium',
      fontSize: 56,
      lineHeight: 64,
      color: theme.colors.onBackground,
      marginTop: 20,
      textAlign: 'center',
    },
  });
