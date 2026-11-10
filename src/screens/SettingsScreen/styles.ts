import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      padding: 16,
    },
    scrollViewContent: {
      paddingVertical: 16,
      paddingHorizontal: 16,
    },
    card: {
      marginVertical: 8,
      borderRadius: 16,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.outline,
    },
    settingItemContainer: {
      minHeight: 52,
      justifyContent: 'center',
      marginVertical: 6,
    },
    switchContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: 52,
      marginVertical: 4,
    },
    textContainer: {
      flex: 1,
      marginRight: 16,
    },
    labelWithIconContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    settingIcon: {
      marginRight: 8,
    },
    textLabel: {
      color: theme.colors.onSurface,
      fontSize: 16,
      fontFamily: 'Geist-Medium',
    },
    textDescription: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
      fontFamily: 'Geist-Regular',
    },
    divider: {
      marginVertical: 8,
      backgroundColor: theme.colors.outline,
    },
    slider: {
      //marginVertical: 8,
      //height: 40,
    },
    textInput: {
      marginVertical: 8,
      backgroundColor: theme.colors.surfaceVariant,
      borderRadius: 10,
    },
    invalidInput: {
      borderColor: theme.colors.error,
      borderWidth: 1,
    },
    errorText: {
      color: theme.colors.error,
      marginTop: 4,
    },
    // Cap the value side of a settings row so a long value label ellipsizes
    // inside the button instead of squeezing the flex title/description
    // column into a sliver.
    menuContainer: {
      position: 'relative',
      flexShrink: 1,
      maxWidth: '55%',
    },
    menuButton: {
      minWidth: 100,
      maxWidth: '100%',
    },
    tierActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    inUseLabel: {
      color: theme.colors.primary,
    },
    // A control too wide to share its row (e.g. the draft-model picker, whose
    // values are model filenames) sits under the title/description instead.
    // Also keeps the menu anchor at the row's left edge, on-screen.
    fullRowControl: {
      marginTop: 8,
      alignSelf: 'flex-start',
      maxWidth: '100%',
    },
    consentContainer: {
      marginVertical: 8,
    },
    consentButton: {
      alignSelf: 'flex-end',
      marginTop: 12,
    },
    buttonContent: {
      flexDirection: 'row-reverse',
      justifyContent: 'space-between',
    },
    advancedSettingsButton: {
      marginVertical: 8,
    },
    advancedSettingsContent: {
      marginTop: 8,
    },
    advancedAccordion: {
      height: 55,
      //backgroundColor: theme.colors.surface,
    },
    accordionTitle: {
      fontSize: 14,
      color: theme.colors.secondary,
    },
    // Floor, not a fixed width: dropdown items size to their longest label
    // (the outer menu clamps at 90% screen and item titles ellipsize past it).
    menu: {
      minWidth: 170,
    },
    linkContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
    },
    linkIcon: {
      marginLeft: 4,
    },
    segmentedButtons: {
      marginVertical: 8,
      borderRadius: 10,
      height: 44,
    },
  });
