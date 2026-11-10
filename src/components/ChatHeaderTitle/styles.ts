import {StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleWrapper: {
    flexShrink: 1,
  },
  title: {
    fontFamily: 'Geist-Medium',
    fontWeight: '500',
  },
  modelName: {
    fontSize: 11,
    fontFamily: 'GeistMono-Regular',
  },
});
