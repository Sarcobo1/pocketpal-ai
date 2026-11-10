import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const styles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 12,
      marginTop: 4,
      gap: 8,
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    timing: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontFamily: 'GeistMono-Regular',
      fontVariant: ['tabular-nums'],
    },
    interruptedStatus: {
      color: theme.colors.error,
      fontSize: 12,
      fontFamily: 'GeistMono-Regular',
    },
  });
