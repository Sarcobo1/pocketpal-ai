import {StyleSheet} from 'react-native';

import {Theme} from '../../../utils/types';

export const createStyles = (theme: Theme) => {
  return StyleSheet.create({
    fab: {
      bottom: 0,
      right: 16,
      backgroundColor: theme.colors.primary,
      borderRadius: 16,
      width: 56,
      height: 56,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionButton: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.outline,
      borderRadius: 16,
      borderWidth: 1,
    },
    icon: {
      width: 24,
      height: 24,
    },
  });
};
