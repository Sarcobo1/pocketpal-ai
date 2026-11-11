import {StyleSheet} from 'react-native';

import {MD3Theme} from 'react-native-paper';

export const createStyles = (theme: MD3Theme) =>
  StyleSheet.create({
    sidebarContainer: {
      flex: 1,
      backgroundColor: theme.colors.surface,
    },
    drawerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
      gap: 10,
    },
    brandTitle: {
      fontFamily: 'Geist-Medium',
      fontSize: 20,
      color: theme.colors.onSurface,
      fontWeight: '500',
    },
    offlineCard: {
      marginHorizontal: 16,
      marginBottom: 12,
      padding: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceVariant,
      borderWidth: 1,
      borderColor: theme.colors.outline,
    },
    offlineCardRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    offlineCardTitle: {
      fontSize: 13,
      fontFamily: 'Geist-Medium',
      color: theme.colors.onSurface,
    },
    offlineCardRam: {
      fontSize: 12,
      fontFamily: 'GeistMono-Regular',
      color: theme.colors.onSurfaceVariant,
    },
    divider: {
      marginHorizontal: 16,
      backgroundColor: theme.colors.onSurfaceVariant,
      height: 1,
      opacity: 0.1,
    },
    contentWrapper: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
    },
    // New OpenLimi Profile Header & Offline Card
    profileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 16,
    },
    profileLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    profileAvatar: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: theme.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    profileAvatarText: {
      fontSize: 18,
      fontFamily: 'Geist-Medium',
      fontWeight: '600',
      color: theme.colors.onPrimary,
    },
    profileName: {
      fontSize: 16,
      fontFamily: 'Geist-Medium',
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    profileChevron: {
      marginLeft: 4,
    },
    profileArrowBtn: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: theme.colors.surfaceVariant,
      justifyContent: 'center',
      alignItems: 'center',
    },
    openLimiOfflineCard: {
      marginHorizontal: 16,
      marginBottom: 16,
      padding: 16,
      borderRadius: 16,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.surfaceVariant,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    openLimiOfflineTitle: {
      fontSize: 16,
      fontFamily: 'Geist-Medium',
      fontWeight: '600',
      color: theme.colors.primary,
      marginBottom: 4,
    },
    openLimiOfflineSubtitle: {
      fontSize: 13,
      fontFamily: 'GeistMono-Regular',
      color: theme.colors.onSurfaceVariant,
    },
    openLimiFaolBadge: {
      borderWidth: 1,
      borderColor: theme.colors.primary,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    openLimiFaolBadgeText: {
      fontSize: 13,
      fontFamily: 'Geist-Medium',
      fontWeight: '600',
      color: theme.colors.primary,
    },
    // OpenLimi Bottom Bar
    bottomBarContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: theme.colors.outline,
      backgroundColor: theme.colors.background,
    },
    bottomThemeBtn: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: theme.colors.surfaceVariant,
      justifyContent: 'center',
      alignItems: 'center',
    },
    bottomSearchBox: {
      flex: 1,
      height: 44,
      borderRadius: 10,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.surfaceVariant,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      gap: 8,
    },
    bottomSearchInput: {
      flex: 1,
      fontSize: 14,
      fontFamily: 'Geist-Regular',
      color: theme.colors.onSurface,
      padding: 0,
    },
    bottomPlusBtn: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: theme.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sessionDrawerItem: {
      height: 52,
    },
    menuDrawerItem: {
      height: 52,
    },
    versionText: {
      color: theme.colors.onSurfaceVariant,
      opacity: 0.7,
      fontSize: 12,
      fontWeight: '500',
    },
    drawerSection: {
      marginTop: 10,
    },
    dateLabel: {
      paddingLeft: 16,
      paddingVertical: 10,
    },
    scrollViewContent: {
      flexGrow: 1,
      minHeight: '100%',
    },
    mainContent: {
      flex: 1,
    },
    menu: {
      width: 170,
    },
    sessionItem: {
      position: 'relative',
    },
    sessionTouchable: {
      flex: 1,
    },
    // Selection mode styles
    selectionModeHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outline,
      backgroundColor: theme.colors.surface,
    },
    selectedCountText: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.onSurface,
      flex: 1,
      textAlign: 'center',
    },
    sessionItemContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      position: 'relative',
    },
    sessionCheckbox: {
      marginLeft: 8,
      marginRight: 4,
    },
    menuDivider: {
      marginVertical: 4,
    },
    // Header action buttons (export, delete icons)
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    headerActionButton: {
      padding: 4,
    },
    headerActionButtonDisabled: {
      opacity: 0.4,
    },
    // Select all row
    selectAllRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: theme.colors.surface,
    },
    selectAllCheckbox: {
      marginRight: 12,
    },
    selectAllText: {
      fontSize: 16,
      color: theme.colors.onSurface,
    },
    selectAllDivider: {
      backgroundColor: theme.colors.outline,
      opacity: 0.3,
    },
  });
