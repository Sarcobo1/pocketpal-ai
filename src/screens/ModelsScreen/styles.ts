import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
    },
    container: {
      flex: 1,
      padding: 4,
      backgroundColor: theme.colors.background,
    },
    listContainer: {
      paddingBottom: 150,
    },
    headerSection: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 8,
    },
    screenTitle: {
      fontSize: 28,
      fontFamily: 'Geist-Medium',
      fontWeight: '500',
      color: theme.colors.text,
    },
    screenSubtitle: {
      fontSize: 14,
      fontFamily: 'Geist-Regular',
      color: theme.colors.onSurfaceVariant,
      marginTop: 4,
      marginBottom: 16,
    },
    searchBar: {
      height: 48,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.surfaceVariant,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      gap: 10,
      marginBottom: 16,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      fontFamily: 'Geist-Regular',
      color: theme.colors.text,
      padding: 0,
    },
    chipsContainer: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
    },
    chip: {
      height: 38,
      borderRadius: 10,
      paddingHorizontal: 16,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.surfaceVariant,
    },
    chipActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    chipText: {
      fontSize: 14,
      fontFamily: 'Geist-Medium',
      color: theme.colors.text,
    },
    chipTextActive: {
      fontSize: 14,
      fontFamily: 'Geist-Medium',
      fontWeight: '600',
      color: theme.colors.onPrimary,
    },
    footerRow: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 12,
      marginTop: 16,
      marginBottom: 40,
    },
    footerBtn: {
      flex: 1,
      height: 52,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      borderStyle: 'dashed',
      justifyContent: 'center',
      alignItems: 'center',
    },
    footerBtnText: {
      fontSize: 14,
      fontFamily: 'Geist-Medium',
      color: theme.colors.text,
    },
    header: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outlineVariant,
    },
    filterContainer: {
      flexDirection: 'row',
      padding: 4,
      gap: 1,
      justifyContent: 'flex-end',
    },
    filterIcon: {
      borderRadius: 8,
      marginHorizontal: 2,
    },
  });
