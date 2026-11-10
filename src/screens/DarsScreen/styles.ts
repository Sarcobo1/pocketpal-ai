import {StyleSheet} from 'react-native';
import type {Theme} from '../../utils/types';

// Limi Dars (Lessons) screen styles.
// - Background: #04110E (theme.colors.background)
// - Cards: #0B1E19, radius 16 (theme.borders.messageBorderRadius)
// - Buttons: radius 10 (theme.borders.inputBorderRadius), h44
// - Blackboard: #030A08 (theme.colors.surfaceContainerLowest)
export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollContent: {
      padding: theme.spacing.m,
      paddingBottom: theme.spacing.xxl,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.spacing.m,
      gap: theme.spacing.sm,
    },
    screenTitle: {
      fontFamily: 'Geist-Medium',
      fontSize: 28,
      lineHeight: 32,
      color: theme.colors.onBackground,
    },
    chipsScroll: {
      flexDirection: 'row',
      marginBottom: theme.spacing.m,
      gap: theme.spacing.xs,
    },
    chip: {
      paddingHorizontal: theme.spacing.m,
      paddingVertical: theme.spacing.xs + 2,
      borderRadius: theme.borders.inputBorderRadius,
      backgroundColor: theme.colors.surfaceVariant,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outline,
    },
    chipActive: {
      backgroundColor: theme.colors.primary,
    },
    chipText: {
      fontFamily: 'Geist-Medium',
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.onSurfaceVariant,
    },
    chipTextActive: {
      color: theme.colors.onPrimary,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borders.messageBorderRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outline,
      padding: theme.spacing.m,
      marginBottom: theme.spacing.m,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.xs,
    },
    cardEyebrow: {
      fontFamily: 'Geist-Regular',
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.onSurfaceVariant,
    },
    cardTitle: {
      fontFamily: 'Geist-Medium',
      fontSize: 16,
      lineHeight: 24,
      color: theme.colors.onSurface,
      marginBottom: theme.spacing.xs,
    },
    cardMeta: {
      fontFamily: 'GeistMono-Regular',
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.onSurfaceVariant,
    },
    progressBarTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.surfaceVariant,
      overflow: 'hidden',
      marginBottom: theme.spacing.sm,
    },
    progressBarFill: {
      height: '100%' as unknown as number,
      backgroundColor: theme.colors.primary,
      borderRadius: 2,
    },
    button: {
      height: 44,
      borderRadius: theme.borders.inputBorderRadius,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.m,
    },
    buttonText: {
      fontFamily: 'Geist-Medium',
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.onPrimary,
    },
    buttonSecondary: {
      height: 44,
      borderRadius: theme.borders.inputBorderRadius,
      backgroundColor: theme.colors.surfaceVariant,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outline,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.m,
    },
    buttonSecondaryText: {
      fontFamily: 'Geist-Medium',
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.onSurface,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 52,
      paddingVertical: theme.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.outline,
    },
    switchRowLast: {
      borderBottomWidth: 0,
    },
    switchLabel: {
      fontFamily: 'Geist-Regular',
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.onSurface,
    },
    // Blackboard card (#030A08) for code / diagrams
    blackboardCard: {
      backgroundColor: theme.colors.surfaceContainerLowest,
      borderRadius: theme.borders.messageBorderRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outline,
      padding: theme.spacing.m,
      marginBottom: theme.spacing.m,
    },
    blackboardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.sm,
    },
    blackboardBadge: {
      fontFamily: 'GeistMono-Medium',
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.primary,
    },
    codeSnippet: {
      fontFamily: 'JetBrainsMono-Regular',
      fontSize: 14,
      lineHeight: 22,
      color: theme.colors.onBackground,
    },
    codeHighlightedLine: {
      backgroundColor: 'rgba(52, 211, 153, 0.12)',
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    explanationCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borders.messageBorderRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outline,
      padding: theme.spacing.m,
      marginBottom: theme.spacing.m,
    },
    explanationHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.sm,
    },
    explanationTitle: {
      fontFamily: 'Geist-Medium',
      fontSize: 16,
      lineHeight: 24,
      color: theme.colors.onSurface,
    },
    narrationText: {
      fontFamily: 'Geist-Regular',
      fontSize: 15,
      lineHeight: 24,
      color: theme.colors.onSurfaceVariant,
    },
    narrationWordActive: {
      color: theme.colors.primary,
      fontFamily: 'Geist-Medium',
    },
    controlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.m,
      marginVertical: theme.spacing.m,
    },
    pauseButton: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    controlIconButton: {
      width: 44,
      height: 44,
      borderRadius: theme.borders.inputBorderRadius,
      backgroundColor: theme.colors.surfaceVariant,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outline,
    },
    controlIconText: {
      fontFamily: 'Geist-Medium',
      fontSize: 13,
      color: theme.colors.onSurface,
    },
  });
