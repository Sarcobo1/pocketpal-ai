import React, {useContext, useMemo, useRef, useState} from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Pressable,
} from 'react-native';

import DeviceInfo from 'react-native-device-info';
import Clipboard from '@react-native-clipboard/clipboard';
import {Text, Button, SegmentedButtons} from 'react-native-paper';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {BuildInfo} from 'llama.rn';

import {submitFeedback} from '../../api/feedback';
import phononNotices from '../../assets/licenses/phononThirdPartyNotices.json';
import {REPO_URL} from '../../config/urls';

import {CopyIcon, GithubIcon, ChevronRightIcon} from '../../assets/icons';

import {Sheet, TextInput} from '../../components';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {L10nContext} from '../../utils';
import {uiStore} from '../../store';
import {reflowNotice} from './reflowNotice';

const GithubButtonIcon = ({color}: {color: string}) => (
  <GithubIcon stroke={color} />
);

const ChevronRightButtonIcon = ({color}: {color: string}) => (
  <ChevronRightIcon stroke={color} />
);

// Taps on the version row that open Developer Tools, and how long a burst may
// pause before it starts over.
const DEV_TOOLS_TAPS = 7;
const TAP_WINDOW_MS = 3000;

export const AboutScreen: React.FC = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme, insets);
  const l10n = useContext(L10nContext);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const [versionTaps, setVersionTaps] = useState(0);
  const tapWindow = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeSections = useMemo(() => phononNotices.map(reflowNotice), []);
  const [legalItemTops, setLegalItemTops] = useState<Record<number, number>>(
    {},
  );

  const legalLinks: {
    id: 'privacy' | 'terms' | 'notices';
    label: string;
    role: 'link' | 'button';
    onPress: () => void;
    testID?: string;
  }[] = [
    {
      id: 'privacy',
      label: l10n.about.privacyPolicy,
      role: 'link',
      onPress: () => Linking.openURL('https://pocketpal.dev/privacy-policy'),
    },
    {
      id: 'terms',
      label: l10n.about.termsOfService,
      role: 'link',
      onPress: () => Linking.openURL('https://pocketpal.dev/terms'),
    },
    {
      id: 'notices',
      label: l10n.about.openSourceNotices,
      role: 'button',
      onPress: () => setShowNotices(true),
      testID: 'about-open-source-notices',
    },
  ];

  const [appInfo, setAppInfo] = React.useState({
    version: '',
    build: '',
  });

  const [useCase, setUseCase] = useState('');
  const [featureRequests, setFeatureRequests] = useState('');
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [usageFrequency, setUsageFrequency] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    const version = DeviceInfo.getVersion();
    const buildNumber = DeviceInfo.getBuildNumber();
    setAppInfo({
      version,
      build: buildNumber,
    });
  }, []);

  // Seven taps on the version row is the Android convention for a hidden
  // panel, and in a release build it is the only way into Developer Tools
  // (`__DEV__` is false there, so the drawer row is otherwise never drawn).
  //
  // The copied dialog is what a tap has always answered with. It is modal, so
  // once a count is under way the taps go silent and the line under the version
  // carries the progress instead; the window closes on its own so a
  // half-finished count never carries over into the next one.
  const pressVersion = () => {
    Clipboard.setString(`Version ${appInfo.version} (${appInfo.build})`);
    const next = versionTaps + 1;
    if (tapWindow.current) {
      clearTimeout(tapWindow.current);
    }
    if (next >= DEV_TOOLS_TAPS) {
      setVersionTaps(0);
      const unlocked = !uiStore.devToolsUnlocked;
      uiStore.setDevToolsUnlocked(unlocked);
      Alert.alert(
        'Developer Tools',
        unlocked
          ? 'Unlocked. Open the drawer to find the Dev Tools panel.'
          : 'Hidden from the drawer again.',
      );
      return;
    }
    setVersionTaps(next);
    if (next === 1) {
      Alert.alert(
        l10n.about.versionCopiedTitle,
        l10n.about.versionCopiedDescription,
      );
    }
    tapWindow.current = setTimeout(() => setVersionTaps(0), TAP_WINDOW_MS);
  };

  const handleSubmit = async () => {
    if (!useCase && !featureRequests && !generalFeedback) {
      Alert.alert(l10n.feedback.validation.required);
      return;
    }

    setIsSubmitting(true);
    try {
      await submitFeedback({
        useCase,
        featureRequests,
        generalFeedback,
        usageFrequency,
      });
      Alert.alert('Success', l10n.feedback.success);
      setShowFeedback(false);
      // Clear form
      setUseCase('');
      setFeatureRequests('');
      setGeneralFeedback('');
      setUsageFrequency('');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : l10n.feedback.error.general;
      Alert.alert('Error', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const tapsLeft = DEV_TOOLS_TAPS - versionTaps;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Text variant="titleLarge" style={styles.title}>
                PocketPal AI
              </Text>
              <Text variant="bodyMedium" style={styles.description}>
                {l10n.about.description}
              </Text>
              <View style={styles.versionContainer}>
                <TouchableOpacity
                  style={styles.versionButton}
                  onPress={pressVersion}>
                  <Text style={styles.versionText}>
                    v{appInfo.version} ({appInfo.build})
                  </Text>
                  <CopyIcon
                    width={16}
                    height={16}
                    stroke={theme.colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              {versionTaps > 0 && (
                <Text style={styles.llamaBuildText}>
                  {tapsLeft} {tapsLeft === 1 ? 'tap' : 'taps'} away from{' '}
                  {uiStore.devToolsUnlocked ? 'hiding ' : ''}Developer Tools
                </Text>
              )}
              <Text style={styles.llamaBuildText}>
                llama.cpp {BuildInfo.number} ({BuildInfo.commit.substring(0, 7)}
                )
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{l10n.about.supportProject}</Text>
            <Text variant="bodyMedium" style={styles.description}>
              {l10n.about.supportProjectDescription}
            </Text>
            <Button
              mode="outlined"
              onPress={() => Linking.openURL(REPO_URL)}
              style={styles.actionButton}
              icon={GithubButtonIcon}>
              {l10n.about.githubButton}
            </Button>
            <Text style={styles.orText}>{l10n.about.orBy}</Text>
            <Button
              mode="outlined"
              style={styles.actionButton}
              contentStyle={styles.feedbackButtonContent}
              icon={ChevronRightButtonIcon}
              onPress={() => setShowFeedback(true)}>
              {l10n.feedback.shareThoughtsButton}
            </Button>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{l10n.about.tour}</Text>
            <Text variant="bodyMedium" style={styles.description}>
              {l10n.about.tourDescription}
            </Text>
            <Button
              mode="outlined"
              onPress={() => uiStore.replayOnboarding()}
              style={styles.actionButton}
              icon={ChevronRightButtonIcon}>
              {l10n.about.showIntroButton}
            </Button>
          </View>

          <View style={styles.legalRow}>
            {legalLinks.map((link, i) => (
              <View
                key={link.id}
                style={styles.legalItem}
                testID={`about-legal-item-${i}`}
                onLayout={e => {
                  const {y} = e.nativeEvent.layout;
                  setLegalItemTops(tops =>
                    tops[i] === y ? tops : {...tops, [i]: y},
                  );
                }}>
                <Pressable
                  accessibilityRole={link.role}
                  onPress={link.onPress}
                  style={styles.legalHit}
                  testID={link.testID}>
                  <Text style={styles.legalLink}>{link.label}</Text>
                </Pressable>
                {i < legalLinks.length - 1 ? (
                  <Text
                    style={[
                      styles.legalSeparator,
                      legalItemTops[i] !== legalItemTops[i + 1] &&
                        styles.legalSeparatorHidden,
                    ]}
                    importantForAccessibility="no"
                    accessibilityElementsHidden>
                    ·
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <Sheet
        title={l10n.feedback.title}
        isVisible={showFeedback}
        displayFullHeight
        onClose={() => setShowFeedback(false)}>
        <Sheet.ScrollView contentContainerStyle={styles.feedbackForm}>
          <View style={styles.field}>
            <Text style={styles.label}>{l10n.feedback.useCase.label}</Text>
            <TextInput
              defaultValue={useCase}
              onChangeText={setUseCase}
              placeholder={l10n.feedback.useCase.placeholder}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.featureRequests.label}
            </Text>
            <TextInput
              defaultValue={featureRequests}
              onChangeText={setFeatureRequests}
              placeholder={l10n.feedback.featureRequests.placeholder}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.generalFeedback.label}
            </Text>
            <TextInput
              defaultValue={generalFeedback}
              onChangeText={setGeneralFeedback}
              placeholder={l10n.feedback.generalFeedback.placeholder}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.usageFrequency.label}
            </Text>
            <SegmentedButtons
              value={usageFrequency}
              onValueChange={setUsageFrequency}
              buttons={[
                {
                  value: 'daily',
                  label: l10n.feedback.usageFrequency.options.daily,
                },
                {
                  value: 'weekly',
                  label: l10n.feedback.usageFrequency.options.weekly,
                },
                {
                  value: 'monthly',
                  label: l10n.feedback.usageFrequency.options.monthly,
                },
                {
                  value: 'rarely',
                  label: l10n.feedback.usageFrequency.options.rarely,
                },
              ]}
              style={styles.segmentedButtons}
            />
          </View>
        </Sheet.ScrollView>
        <Sheet.Actions>
          <View style={styles.secondaryButtons}>
            <Button mode="text" onPress={() => setShowFeedback(false)}>
              {l10n.common.cancel}
            </Button>
          </View>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={isSubmitting}>
            {l10n.feedback.submit}
          </Button>
        </Sheet.Actions>
      </Sheet>

      <Sheet
        title={l10n.about.openSourceNotices}
        isVisible={showNotices}
        displayFullHeight
        onClose={() => setShowNotices(false)}>
        <Sheet.ScrollView
          contentContainerStyle={styles.noticesContent}
          testID="about-open-source-notices-sheet">
          <Text style={styles.noticesCredit}>
            {l10n.about.phononNoticesCredit}
          </Text>
          {noticeSections.map((section, i) => (
            <Text key={i} selectable style={styles.noticesText}>
              {section}
            </Text>
          ))}
        </Sheet.ScrollView>
      </Sheet>
    </SafeAreaView>
  );
};
