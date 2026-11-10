import {StyleSheet} from 'react-native';

import {MessageType, Theme} from '../../utils/types';

export const styles = ({
  currentUserIsAuthor,
  message,
  _roundBorder,
  theme,
}: {
  currentUserIsAuthor: boolean;
  message: MessageType.Any;
  _roundBorder?: boolean;
  theme: Theme;
}) => {
  return StyleSheet.create({
    contentContainer: {
      backgroundColor:
        !currentUserIsAuthor || message.type === 'image'
          ? 'transparent'
          : theme.colors.authorBubbleBackground,
      borderRadius: 16,
      maxWidth: currentUserIsAuthor ? 292 : undefined,
      alignSelf: currentUserIsAuthor ? 'flex-end' : 'flex-start',
      overflow: 'hidden',
    },
    dateHeader0: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 32,
      marginTop: 16,
    },
    dateHeaderContainer: {
      textAlign: 'right',
      paddingBottom: 12,
      marginTop: -8,
      marginLeft: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dateHeader: {
      //textAlign: 'right',
      color: theme.colors.textSecondary,
      fontSize: 10,
    },
    iconContainer: {
      color: theme.colors.textSecondary,
      fontSize: 16,
    },
  });
};
