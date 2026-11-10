import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const styles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surfaceVariant,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.outline,
      padding: 12,
      marginVertical: 6,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    chipList: {
      marginTop: 8,
      gap: 6,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 40,
      borderRadius: 10,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 8,
      gap: 8,
    },
    orbCircle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: '#04110E',
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipText: {
      fontSize: 13,
      color: theme.colors.onSurface,
      flex: 1,
      fontFamily: 'Geist-Regular',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    label: {
      flexShrink: 1,
      marginHorizontal: 6,
      fontSize: 13,
      color: theme.colors.textSecondary,
      fontFamily: 'Geist-Medium',
    },
    count: {
      flexShrink: 0,
      marginRight: 6,
      fontSize: 13,
      color: theme.colors.textSecondary,
      fontFamily: 'GeistMono-Regular',
    },
  });

export const sheetStyles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    subtitle: {
      marginBottom: 12,
      fontSize: 13,
      color: theme.colors.onSurfaceVariant,
    },
    result: {
      marginBottom: 16,
    },
    title: {
      color: theme.colors.onSurface,
    },
    url: {
      marginTop: 2,
      fontSize: 11,
      color: theme.colors.onSurfaceVariant,
    },
    snippet: {
      marginTop: 4,
      fontSize: 12,
      color: theme.colors.onSurface,
    },
    empty: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    bottomSpacer: {
      height: 32,
    },
  });
