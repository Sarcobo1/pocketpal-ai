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
    },
    title: {
      marginBottom: 16,
      color: theme.colors.onSurface,
    },
    description: {
      marginBottom: 16,
      color: theme.colors.onSurfaceVariant,
    },
    buttonContainer: {
      marginTop: 8,
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    rowLabel: {
      flex: 1,
      paddingRight: 12,
      color: theme.colors.onSurface,
    },
    field: {
      marginBottom: 16,
    },
    button: {
      marginLeft: 8,
    },
    divider: {
      marginVertical: 16,
    },
    warningText: {
      color: theme.colors.error,
      marginBottom: 16,
    },
  });
