import {StyleSheet, Platform} from 'react-native';
import {Theme} from '../../utils/types';

export const createStyles = (theme?: Theme) => {
  const surface = theme?.colors.surface ?? '#0B1E19';
  const border = theme?.colors.outline ?? 'rgba(236, 253, 245, 0.08)';

  return StyleSheet.create({
    shadowContainer: {
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: {width: 0, height: 1},
          shadowOpacity: 0.12,
          shadowRadius: 4,
        },
        android: {},
      }),
    },
    container: {
      borderRadius: 20,
      overflow: 'hidden',
      backgroundColor: surface,
      borderWidth: 1,
      borderColor: border,
      ...Platform.select({
        ios: {},
        android: {
          elevation: 2,
        },
      }),
    },
    partialContainer: {
      maxHeight: 120,
    },
    expandedContainer: {
      // Full height for expanded view
    },
    contentContainer: {
      padding: 16,
      paddingBottom: 40,
    },
    contentContainerStyle: {
      flexGrow: 1,
    },
    maskedContentContainer: {
      height: 120,
    },
    maskElementContainer: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    maskGradient: {
      height: 40,
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    },
    maskSolid: {
      flex: 1,
      backgroundColor: 'black',
      marginTop: 40,
    },
    indicatorContainer: {
      position: 'absolute',
      bottom: 4,
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      height: 20,
    },
    chevronContainer: {
      width: 30,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chevronIndicator: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor:
        theme?.colors.onSurfaceVariant ?? 'rgba(163, 201, 188, 0.5)',
    },
  });
};

export default createStyles;
