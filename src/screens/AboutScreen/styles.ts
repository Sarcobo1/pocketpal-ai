import {StyleSheet} from 'react-native';
import {EdgeInsets} from 'react-native-safe-area-context';
import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme, insets: EdgeInsets) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      flexGrow: 1,
      padding: theme.spacing.default,
      paddingBottom: theme.spacing.default + insets.bottom,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.outline,
    },
    header: {
      padding: theme.spacing.default * 1.5,
      backgroundColor: theme.colors.surfaceVariant,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outline,
      alignItems: 'center',
    },
    ghostContainer: {
      marginBottom: 16,
      alignItems: 'center',
    },
    headerContent: {
      gap: theme.spacing.default / 2,
      alignItems: 'center',
    },
    title: {
      ...theme.fonts.headlineLarge,
      fontFamily: 'Geist-Medium',
      color: theme.colors.onSurface,
      fontSize: 28,
      lineHeight: 32,
      fontWeight: '500',
    },
    description: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    authorItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.outline,
    },
    authorName: {
      fontFamily: 'Geist-Medium',
      fontSize: 14,
      color: theme.colors.onSurface,
    },
    authorRole: {
      fontFamily: 'Geist-Regular',
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    versionContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.default / 2,
    },
    versionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceContainerHigh,
      paddingHorizontal: theme.spacing.default,
      paddingVertical: theme.spacing.default / 2,
      borderRadius: 10,
      gap: theme.spacing.default / 2,
      borderWidth: 1,
      borderColor: theme.colors.outline,
    },
    versionText: {
      ...theme.fonts.bodyMedium,
      color: theme.colors.onSurface,
    },
    llamaBuildText: {
      ...theme.fonts.bodySmall,
      color: theme.colors.onSurfaceVariant,
      marginTop: theme.spacing.default / 2,
      opacity: 0.7,
    },
    section: {
      padding: theme.spacing.default * 1.5,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outline,
    },
    sectionTitle: {
      ...theme.fonts.titleMedium,
      fontFamily: 'Geist-Medium',
      color: theme.colors.onSurface,
      marginBottom: theme.spacing.default,
    },
    actionButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.outline,
    },
    orText: {
      ...theme.fonts.bodyMedium,
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      marginVertical: theme.spacing.default,
      opacity: 0.7,
    },
    feedbackButtonContent: {
      flexDirection: 'row-reverse',
    },
    feedbackForm: {
      padding: theme.spacing.default,
    },
    field: {
      marginBottom: theme.spacing.default,
    },
    label: {
      ...theme.fonts.labelMedium,
      color: theme.colors.onSurface,
      marginBottom: theme.spacing.default / 2,
    },
    segmentedButtons: {
      marginTop: theme.spacing.default / 2,
    },
    submitButton: {
      marginTop: theme.spacing.default,
    },
    secondaryButtons: {
      flexDirection: 'row',
    },
    legalRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: theme.spacing.default * 1.5,
      columnGap: theme.spacing.default / 2,
      rowGap: theme.spacing.default / 4,
    },
    legalItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.default / 2,
    },
    legalHit: {
      minHeight: 44,
      justifyContent: 'center',
    },
    legalLink: {
      ...theme.fonts.bodySmall,
      color: theme.colors.onSurfaceVariant,
    },
    legalSeparator: {
      ...theme.fonts.bodySmall,
      color: theme.colors.onSurfaceVariant,
      opacity: 0.5,
    },
    legalSeparatorHidden: {
      opacity: 0,
    },
    noticesContent: {
      padding: theme.spacing.default,
      paddingBottom: insets.bottom + theme.spacing.default,
    },
    noticesCredit: {
      ...theme.fonts.bodyMedium,
      color: theme.colors.onSurface,
      marginBottom: theme.spacing.default,
    },
    noticesText: {
      ...theme.fonts.bodySmall,
      color: theme.colors.onSurfaceVariant,
    },
  });
