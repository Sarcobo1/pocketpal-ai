import {StyleSheet} from 'react-native';

import type {Theme} from '../../../../utils/types';
import {FONT_FAMILIES} from '../../../../theme/tokens/typography';

export const createStyles = (theme: Theme, align: 'left' | 'center') => {
  // headlineH1 binds to Geist-Medium on Latin locales; locales whose script
  // Geist cannot cover (Uzbek Latin's U+02BB, Polish's Latin Extended-A, and
  // the non-Latin scripts) fall back to Inter-Medium via
  // `typographyForLocale`. Pick the italic run's family by identity so the
  // fallback stays weight-matched.
  const isGeist =
    theme.typography.headlineH1.fontFamily === FONT_FAMILIES.GEIST_MEDIUM;
  return StyleSheet.create({
    // Stack one Text per line inside a centered column so each line
    // centers independently — RN's wrapped-Text centering anchors
    // shorter lines to the longest line's width, not the parent.
    root: {
      alignItems: align === 'center' ? 'center' : 'flex-start',
    },
    title: {
      ...theme.typography.headlineH1,
      color: theme.colors.onBackground,
      textAlign: align,
    },
    // Neither Geist nor Inter ships an italic cut in this bundle, so the
    // italic run is synthesised on the same family and weight.
    italic: isGeist
      ? {fontFamily: FONT_FAMILIES.GEIST_MEDIUM, fontStyle: 'italic'}
      : {fontFamily: FONT_FAMILIES.INTER_MEDIUM, fontStyle: 'italic'},
  });
};
