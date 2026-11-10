import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollView: {
      flex: 1,
    },
    card: {
      marginHorizontal: 16,
      marginVertical: 8,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.outline,
    },
    title: {
      marginBottom: 16,
      fontFamily: 'Geist-Medium',
      color: theme.colors.onSurface,
    },
    description: {
      marginBottom: 16,
      fontFamily: 'Geist-Regular',
      color: theme.colors.onSurfaceVariant,
    },
    buttonContainer: {
      marginTop: 8,
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    button: {
      marginLeft: 8,
      borderRadius: 10,
    },
    divider: {
      marginVertical: 16,
    },
    warningText: {
      color: theme.colors.error,
      marginBottom: 16,
    },
  });
