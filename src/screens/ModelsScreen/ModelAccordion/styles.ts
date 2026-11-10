import {StyleSheet} from 'react-native';
import {Theme} from '../../../utils';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    accordion: {
      height: 52,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outline,
    },
    accordionTitle: {
      fontSize: 14,
      color: theme.colors.onSurfaceVariant,
      fontFamily: 'Geist-Regular',
    },
    accordionDescription: {
      fontSize: 12,
      paddingBottom: 10,
      color: theme.colors.onSurfaceVariant,
    },
  });
