import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';

export const createStyles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    headingTitle: {
      fontSize: 28,
      fontFamily: 'Geist-Medium',
      fontWeight: '500',
      color: theme.colors.text,
      marginBottom: 4,
    },
    headingSubtitle: {
      fontSize: 14,
      fontFamily: 'Geist-Regular',
      color: theme.colors.onSurfaceVariant,
      marginBottom: 16,
    },
    modelCard: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.surfaceVariant,
      borderRadius: 16,
      padding: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      minHeight: 160,
    },
    modelCardHeader: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 12,
    },
    greenDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.primary,
    },
    modelCardName: {
      fontSize: 13,
      fontFamily: 'GeistMono-Regular',
      color: theme.colors.onSurfaceVariant,
    },
    ghostWrapper: {
      marginVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickNavCard: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.surfaceVariant,
      borderRadius: 16,
      overflow: 'hidden',
      marginBottom: 20,
    },
    quickNavItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    quickNavLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    quickNavTitle: {
      fontSize: 16,
      fontFamily: 'Geist-Medium',
      fontWeight: '600',
      color: theme.colors.text,
    },
    quickNavRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    quickNavSubtitle: {
      fontSize: 14,
      fontFamily: 'Geist-Regular',
      color: theme.colors.onSurfaceVariant,
    },
    hairlineDivider: {
      height: 1,
      backgroundColor: theme.colors.surfaceVariant,
      opacity: 0.6,
      marginHorizontal: 16,
    },
    recentSectionTitle: {
      fontSize: 14,
      fontFamily: 'Geist-Regular',
      color: theme.colors.onSurfaceVariant,
      marginBottom: 12,
    },
    recentItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
    },
    recentItemTitle: {
      fontSize: 15,
      fontFamily: 'Geist-Regular',
      color: theme.colors.text,
      flex: 1,
      marginRight: 12,
    },
    recentItemTime: {
      fontSize: 13,
      fontFamily: 'GeistMono-Regular',
      color: theme.colors.onSurfaceVariant,
    },
  });
