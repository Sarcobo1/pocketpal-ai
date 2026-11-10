import {StyleSheet} from 'react-native';

import type {Theme} from '../../../../utils/types';

export const createStyles = (theme: Theme, elevated: boolean) =>
  StyleSheet.create({
    wrapper: {
      paddingTop: theme.spacing.s,
      paddingHorizontal: theme.spacing.m,
      gap: theme.spacing.sm,
      backgroundColor: elevated ? theme.colors.background : 'transparent',
      borderTopLeftRadius: elevated ? theme.radius.l : 0,
      borderTopRightRadius: elevated ? theme.radius.l : 0,
      // Elevation/shadow only when floating over screen 6 content.
      ...(elevated
        ? {
            shadowColor: theme.colors.shadow,
            shadowOffset: {width: 0, height: 2},
            shadowOpacity: 0.08,
            shadowRadius: 4,
            elevation: 4,
          }
        : {}),
    },
    row: {
      flexDirection: 'row',
      gap: theme.spacing.s,
    },
    backBtn: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.m,
      borderWidth: theme.stroke.sm,
      borderColor: theme.colors.outline,
      backgroundColor: theme.colors.surfaceVariant,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtn: {
      flex: 1,
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.m,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.m,
      borderWidth: theme.stroke.sm,
      borderColor: theme.colors.outline,
      backgroundColor: theme.colors.primary,
    },
    primaryBtnDisabled: {
      backgroundColor: theme.colors.surfaceContainerLow,
      borderColor: theme.colors.outline,
    },
    primaryLabel: {
      ...theme.typography.titleS,
      color: theme.colors.onPrimary,
    },
    primaryLabelDisabled: {
      color: theme.colors.onSurfaceVariant,
    },
    // Figma `I888:33571;746:26871`: trailing icon container is 20×20;
    // the glyph itself sits inset ~17.84% on all sides. Centering a
    // 13×13 glyph inside a 20×20 box reproduces the breathing room.
    glyphBox: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
