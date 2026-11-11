import React, {useContext} from 'react';
import {View, Text, TouchableOpacity, ScrollView} from 'react-native';
import {observer} from 'mobx-react';
import {useNavigation, NavigationProp} from '@react-navigation/native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {chatSessionStore, modelStore, voiceModeStore} from '../../store';
import {L10nContext} from '../../utils';
import {LimiGhost} from '../LimiGhost';
import {ROUTES} from '../../utils/navigationConstants';
import {
  VoiceWaveformIcon,
  ChatIcon,
  CodeIcon,
  ModelIcon,
  ChevronRightIcon,
} from '../../assets/icons';

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

interface ChatEmptyPlaceholderProps {
  onSelectModel?: () => void;
  bottomComponentHeight?: number;
}

export const ChatEmptyPlaceholder = observer(
  ({onSelectModel, bottomComponentHeight = 0}: ChatEmptyPlaceholderProps) => {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp<any>>();
    const l10n = useContext(L10nContext);
    const styles = createStyles({theme});

    const activeModel = modelStore.activeModel;
    const recentSessions = chatSessionStore.sessions.slice(0, 3);

    const handleSelectRecentSession = async (sessionId: string) => {
      ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
      await chatSessionStore.setActiveSession(sessionId);
    };

    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={{paddingBottom: bottomComponentHeight + 40}}
        showsVerticalScrollIndicator={false}
        testID="chat-empty-placeholder">
        {/* Title */}
        <Text style={styles.headingTitle}>Yangi suhbat</Text>
        <Text style={styles.headingSubtitle}>Model shu telefonda ishlaydi</Text>

        {/* Active Model Card */}
        <TouchableOpacity
          style={styles.modelCard}
          onPress={() => {
            if (onSelectModel) {
              onSelectModel();
            } else {
              navigation.navigate(ROUTES.MODELS);
            }
          }}
          activeOpacity={0.85}>
          <View style={styles.modelCardHeader}>
            <View style={styles.greenDot} />
            <Text style={styles.modelCardName}>
              {activeModel ? activeModel.name : 'Model tanlanmagan'}
            </Text>
          </View>
          <View style={styles.ghostWrapper}>
            <LimiGhost
              state="sleeping"
              size={100}
              label="Limi mascot"
            />
          </View>
        </TouchableOpacity>

        {/* Quick Navigation Card */}
        <View style={styles.quickNavCard}>
          {/* Speak */}
          <TouchableOpacity
            style={styles.quickNavItem}
            onPress={() => {
              ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
              voiceModeStore.setPhase('listening');
            }}
            activeOpacity={0.75}>
            <View style={styles.quickNavLeft}>
              <VoiceWaveformIcon width={20} height={20} color={theme.colors.primary} />
              <Text style={styles.quickNavTitle}>Speak</Text>
            </View>
            <View style={styles.quickNavRight}>
              <Text style={styles.quickNavSubtitle}>Ovoz va kamera</Text>
              <ChevronRightIcon width={16} height={16} stroke={theme.colors.onSurfaceVariant} />
            </View>
          </TouchableOpacity>

          <View style={styles.hairlineDivider} />

          {/* Chat */}
          <TouchableOpacity
            style={styles.quickNavItem}
            onPress={() => {
              ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
            }}
            activeOpacity={0.75}>
            <View style={styles.quickNavLeft}>
              <ChatIcon width={20} height={20} stroke={theme.colors.primary} />
              <Text style={styles.quickNavTitle}>Chat</Text>
            </View>
            <View style={styles.quickNavRight}>
              <Text style={styles.quickNavSubtitle}>Matn</Text>
              <ChevronRightIcon width={16} height={16} stroke={theme.colors.onSurfaceVariant} />
            </View>
          </TouchableOpacity>

          <View style={styles.hairlineDivider} />

          {/* Dars */}
          <TouchableOpacity
            style={styles.quickNavItem}
            onPress={() => {
              ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
              navigation.navigate(ROUTES.DARS);
            }}
            activeOpacity={0.75}>
            <View style={styles.quickNavLeft}>
              <CodeIcon width={20} height={20} stroke={theme.colors.primary} />
              <Text style={styles.quickNavTitle}>Dars</Text>
            </View>
            <View style={styles.quickNavRight}>
              <Text style={styles.quickNavSubtitle}>Kod, matematika</Text>
              <ChevronRightIcon width={16} height={16} stroke={theme.colors.onSurfaceVariant} />
            </View>
          </TouchableOpacity>

          <View style={styles.hairlineDivider} />

          {/* Modellar */}
          <TouchableOpacity
            style={styles.quickNavItem}
            onPress={() => {
              ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
              navigation.navigate(ROUTES.MODELS);
            }}
            activeOpacity={0.75}>
            <View style={styles.quickNavLeft}>
              <ModelIcon width={20} height={20} stroke={theme.colors.primary} />
              <Text style={styles.quickNavTitle}>Modellar</Text>
            </View>
            <View style={styles.quickNavRight}>
              <Text style={styles.quickNavSubtitle}>Yuklash</Text>
              <ChevronRightIcon width={16} height={16} stroke={theme.colors.onSurfaceVariant} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Recent Chats Section */}
        {recentSessions.length > 0 && (
          <View>
            <Text style={styles.recentSectionTitle}>Oxirgi suhbatlar</Text>
            {recentSessions.map(session => (
              <TouchableOpacity
                key={session.id}
                style={styles.recentItem}
                onPress={() => handleSelectRecentSession(session.id)}
                activeOpacity={0.75}>
                <Text style={styles.recentItemTitle} numberOfLines={1}>
                  {session.title || 'Yangi suhbat'}
                </Text>
                <Text style={styles.recentItemTime}>
                  {session.date || 'kecha'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    );
  },
);
