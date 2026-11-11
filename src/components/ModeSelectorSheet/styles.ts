import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 24,
      backgroundColor: theme.colors.surface,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 14,
      marginVertical: 4,
    },
    optionRowActive: {
      backgroundColor: theme.colors.surfaceVariant,
    },
    iconWrapper: {
      width: 40,
      height: 40,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceVariant,
    },
    textContainer: {
      flex: 1,
      marginLeft: 14,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    title: {
      fontSize: 16,
      fontFamily: 'Geist-Medium',
      fontWeight: '600',
      color: theme.colors.text,
    },
    betaBadge: {
      backgroundColor: theme.colors.surfaceVariant,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
      marginLeft: 8,
    },
    betaBadgeText: {
      fontSize: 11,
      fontFamily: 'Geist-Medium',
      color: theme.colors.primary,
    },
    description: {
      fontSize: 13,
      fontFamily: 'Geist-Regular',
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    checkWrapper: {
      marginLeft: 8,
    },
  });
