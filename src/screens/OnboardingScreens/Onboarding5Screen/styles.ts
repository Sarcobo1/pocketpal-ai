import {StyleSheet} from 'react-native';

import type {Theme} from '../../../utils/types';
import {FONT_FAMILIES} from '../../../theme/tokens/typography';

export const createStyles = (theme: Theme) => {
  const isGeist =
    theme.typography.headlineH1.fontFamily === FONT_FAMILIES.GEIST_MEDIUM;
  return StyleSheet.create({
    header: {
      width: 369,
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    title: {
      // Limi heading — Geist Medium 24/28, centered.
      fontFamily: isGeist
        ? FONT_FAMILIES.GEIST_MEDIUM
        : FONT_FAMILIES.INTER_MEDIUM,
      fontSize: 24,
      lineHeight: 28,
      color: theme.colors.onBackground,
      textAlign: 'center',
      width: 279,
    },
    body: {
      ...theme.typography.bodyS,
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
    },
  });
};
