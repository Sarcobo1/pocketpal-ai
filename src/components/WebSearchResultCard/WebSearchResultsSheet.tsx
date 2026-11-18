import React, {useContext, useState} from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Snackbar} from 'react-native-paper';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import {Sheet} from '../Sheet';
import {L10nContext} from '../../utils';
import {WebSearchResultItem} from '../../services/talents/types';
import {
  SearchIcon,
  GlobeIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CheckBoldIcon,
  LinkExternalIcon,
} from '../../assets/icons';

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

interface WebSearchResultsSheetProps {
  isVisible: boolean;
  query: string;
  results: WebSearchResultItem[];
  onDismiss: () => void;
}

const isOpenableUrl = (url: string): boolean => /^https?:\/\//i.test(url);

export const WebSearchResultsSheet: React.FC<WebSearchResultsSheetProps> = ({
  isVisible,
  query,
  results,
  onDismiss,
}) => {
  const l10n = useContext(L10nContext);
  const [showOpenError, setShowOpenError] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<boolean>(true);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number | null>(
    results.length > 0 ? 0 : null,
  );

  const openUrl = async (url: string) => {
    if (!isOpenableUrl(url)) {
      return;
    }
    try {
      ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
      await Linking.openURL(url);
    } catch {
      setShowOpenError(true);
    }
  };

  const selectedSource =
    selectedSourceIndex !== null ? results[selectedSourceIndex] : null;

  return (
    <Sheet
      isVisible={isVisible}
      onClose={onDismiss}
      title="Fikrlar"
      snapPoints={['70%']}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        testID="web-search-results-sheet">
        {/* Step 1: O'yladi */}
        <View style={styles.timelineRow}>
          <View style={styles.checkIconCircle}>
            <CheckBoldIcon width={14} height={14} fill="#00E699" />
          </View>
          <Text style={styles.stepTitle}>O'yladi</Text>
        </View>

        {/* Timeline connector line */}
        <View style={styles.timelineConnector} />

        {/* Step 2: Qidiruv holati */}
        <View style={styles.timelineRow}>
          <View style={styles.searchIconCircle}>
            <SearchIcon width={14} height={14} stroke="#00E699" />
          </View>
          <Text style={styles.searchingText} numberOfLines={1}>
            «{query || 'Maʼlumotlar'}» qidirildi
          </Text>
        </View>

        {/* Grouped results card */}
        <View style={styles.cardContainer}>
          <TouchableOpacity
            style={styles.cardHeader}
            onPress={() => setExpandedGroup(!expandedGroup)}
            activeOpacity={0.8}
            accessibilityRole="button">
            <View style={styles.cardHeaderLeft}>
              <SearchIcon
                width={16}
                height={16}
                stroke="#00E699"
                style={styles.cardSearchIcon}
              />
              <Text style={styles.cardHeaderTitle} numberOfLines={1}>
                {results.length} ta manba · «{query}»
              </Text>
            </View>
            {expandedGroup ? (
              <ChevronDownIcon width={16} height={16} stroke="#8E9B94" />
            ) : (
              <ChevronRightIcon width={16} height={16} stroke="#8E9B94" />
            )}
          </TouchableOpacity>

          {expandedGroup && (
            <View style={styles.cardBody}>
              {/* Chips row */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsContainer}>
                {results.map((item, idx) => {
                  const isSelected = selectedSourceIndex === idx;
                  const label = `manba-${idx + 1}`;

                  return (
                    <TouchableOpacity
                      key={`${item.url}-${idx}`}
                      style={[
                        styles.sourceChip,
                        isSelected && styles.sourceChipActive,
                      ]}
                      onPress={() => {
                        ReactNativeHapticFeedback.trigger(
                          'selection',
                          hapticOptions,
                        );
                        setSelectedSourceIndex(idx);
                      }}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={label}>
                      <View style={styles.chipGlobeWrapper}>
                        <GlobeIcon width={12} height={12} stroke="#FFFFFF" />
                      </View>
                      <Text
                        style={[
                          styles.sourceChipText,
                          isSelected && styles.sourceChipTextActive,
                        ]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Selected source details */}
              {selectedSource && (
                <View style={styles.sourceDetailBox}>
                  <Text style={styles.sourceTitle} numberOfLines={2}>
                    {selectedSource.title || selectedSource.url}
                  </Text>
                  <Text style={styles.sourceUrl} numberOfLines={1}>
                    {selectedSource.url}
                  </Text>
                  {selectedSource.snippet ? (
                    <Text style={styles.sourceSnippet} numberOfLines={4}>
                      {selectedSource.snippet}
                    </Text>
                  ) : null}

                  {isOpenableUrl(selectedSource.url) && (
                    <TouchableOpacity
                      style={styles.openLinkButton}
                      onPress={() => openUrl(selectedSource.url)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="Saytga o'tish">
                      <LinkExternalIcon
                        width={14}
                        height={14}
                        stroke="#00E699"
                        style={styles.openLinkIcon}
                      />
                      <Text style={styles.openLinkText}>Saytni ochish</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}
        </View>

        {results.length === 0 && (
          <Text style={styles.emptyText}>
            {l10n.chat?.webSearch?.noResults || 'Natijalar topilmadi'}
          </Text>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Snackbar
        visible={showOpenError}
        onDismiss={() => setShowOpenError(false)}
        duration={3000}
        action={{
          label: l10n.common?.dismiss || 'Yopish',
          onPress: () => setShowOpenError(false),
        }}>
        {l10n.chat?.webSearch?.openLinkError || 'Havolani ochib bo‘lmadi'}
      </Snackbar>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  checkIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#072418',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  stepTitle: {
    color: '#00E699',
    fontSize: 15,
    fontWeight: '600',
  },
  timelineConnector: {
    width: 2,
    height: 14,
    backgroundColor: '#00E699',
    marginLeft: 11,
    marginVertical: 2,
  },
  searchIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#072418',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  searchingText: {
    color: '#E0E8E3',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  cardContainer: {
    backgroundColor: '#072017',
    borderRadius: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#0F382A',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  cardSearchIcon: {
    marginRight: 8,
  },
  cardHeaderTitle: {
    color: '#E0E8E3',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  cardBody: {
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  chipsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#030E0A',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#143C2E',
  },
  sourceChipActive: {
    backgroundColor: '#0E3B2C',
    borderColor: '#00E699',
  },
  chipGlobeWrapper: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1E4A3B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  sourceChipText: {
    color: '#A8B8B0',
    fontSize: 13,
    fontWeight: '500',
  },
  sourceChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  sourceDetailBox: {
    backgroundColor: '#04130D',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#103024',
  },
  sourceTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  sourceUrl: {
    color: '#00E699',
    fontSize: 12,
    marginBottom: 8,
  },
  sourceSnippet: {
    color: '#B0C2B8',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  openLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#072418',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#00E699',
  },
  openLinkIcon: {
    marginRight: 6,
  },
  openLinkText: {
    color: '#00E699',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    color: '#8E9B94',
    textAlign: 'center',
    marginTop: 24,
    fontSize: 14,
  },
  bottomSpacer: {
    height: 32,
  },
});
