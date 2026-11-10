import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    menu: {
      shadowColor: 'rgba(0, 0, 0, 0.2)',
      shadowRadius: 16,
      shadowOffset: {width: 0, height: 4},
      elevation: 4,
      borderRadius: 16,
      maxWidth: '90%',
    },
    menuWithSubmenu: {
      elevation: 0,
      shadowOpacity: 0,
    },
    content: {
      paddingVertical: 4,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.outline,
      marginRight: 10,
    },
    contentWithSubmenu: {
      backgroundColor: theme.colors.surface,
    },
    groupSeparator: {
      height: 6,
      flexShrink: 0,
      backgroundColor: 'transparent',
    },
    separator: {
      backgroundColor: theme.colors.menuSeparator,
    },
  });
