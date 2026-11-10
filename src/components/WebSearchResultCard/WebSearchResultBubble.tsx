import React, {useContext, useState} from 'react';
import {TouchableOpacity, View} from 'react-native';

import {Text} from 'react-native-paper';

import {ChevronRightIcon, SearchIcon} from '../../assets/icons';
import {useTheme} from '../../hooks';
import {LimiOrb} from '../LimiOrb';

import {WebSearchResultsSheet} from './WebSearchResultsSheet';
import {styles} from './styles';

import {L10nContext} from '../../utils';
import {t} from '../../locales';
import {WebSearchResultItem} from '../../services/talents/types';

interface WebSearchResultBubbleProps {
  query: string;
  results: WebSearchResultItem[];
}

export const WebSearchResultBubble: React.FC<WebSearchResultBubbleProps> = ({
  query,
  results,
}) => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const [sheetVisible, setSheetVisible] = useState(false);

  const componentStyles = styles({theme});

  if (results.length === 0) {
    return (
      <View style={componentStyles.card} testID="web-search-result-card">
        <View style={componentStyles.row}>
          <SearchIcon
            width={16}
            height={16}
            stroke={theme.colors.textSecondary}
          />
          <Text style={componentStyles.label} numberOfLines={1}>
            {t(l10n.chat.webSearch.noResultsFor, {query})}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={componentStyles.card}
        onPress={() => setSheetVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={t(
          l10n.chat.webSearch.showResultsAccessibilityLabel,
          {query},
        )}
        testID="web-search-result-trigger">
        <View style={componentStyles.headerRow}>
          <View style={componentStyles.row}>
            <Text style={componentStyles.label} numberOfLines={1}>
              {t(l10n.chat.webSearch.searched, {query})}
            </Text>
            <Text style={componentStyles.count} numberOfLines={1}>
              {' · '}
              {results.length === 1
                ? l10n.chat.webSearch.resultsCountOne
                : t(l10n.chat.webSearch.resultsCount, {count: results.length})}
            </Text>
          </View>
          <ChevronRightIcon
            width={16}
            height={16}
            stroke={theme.colors.textSecondary}
          />
        </View>

        {/* Source chips */}
        <View style={componentStyles.chipList}>
          {results.slice(0, 3).map((item, idx) => {
            let sourceName = item.url;
            try {
              sourceName = new URL(item.url).hostname.replace(/^www\./, '');
            } catch {
              sourceName = item.url;
            }
            return (
              <View key={idx} style={componentStyles.chip}>
                <View style={componentStyles.orbCircle}>
                  <LimiOrb state="searching" size={20} paused={true} />
                </View>
                <Text style={componentStyles.chipText} numberOfLines={1}>
                  {sourceName}
                </Text>
              </View>
            );
          })}
        </View>
      </TouchableOpacity>

      <WebSearchResultsSheet
        isVisible={sheetVisible}
        query={query}
        results={results}
        onDismiss={() => setSheetVisible(false)}
      />
    </>
  );
};
