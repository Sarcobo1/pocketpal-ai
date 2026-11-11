import React, {useState, useRef, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, DrawerActions} from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {observer} from 'mobx-react';

import {useTheme, useVoiceCapture} from '../../hooks';
import {createStyles} from './styles';
import {
  MenuIcon,
  MicrophoneIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
  UploadIcon,
  CheckBoldIcon,
} from '../../assets/icons';
import {ROUTES} from '../../utils/navigationConstants';
import {chatSessionStore, ttsStore, asrStore} from '../../store';

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

export const VoiceStudioScreen: React.FC = observer(() => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const styles = createStyles(theme, insets.top, insets.bottom);

  // Tab: 'stt' | 'tts'
  const [activeTab, setActiveTab] = useState<'stt' | 'tts'>('stt');

  // STT state
  const [sttText, setSttText] = useState('');
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);

  // TTS state
  const [ttsText, setTtsText] = useState(
    'Salom. Men sizning offline yordamchingizman.',
  );
  const [selectedVoice, setSelectedVoice] = useState<'voice1' | 'voice2' | 'cloned'>('voice1');
  const [speed, setSpeed] = useState(1.0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Voice cloning state
  const [isCloneRecording, setIsCloneRecording] = useState(false);
  const [cloneSeconds, setCloneSeconds] = useState(0);
  const cloneTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [consentChecked, setConsentChecked] = useState(true);
  const [hasClonedVoice, setHasClonedVoice] = useState(false);

  // ----- Real ASR (Whisper) integration -----
  const voiceCapture = useVoiceCapture({
    onTranscript: useCallback((text: string) => {
      setSttText(text);
      setIsRecordingState(false);
    }, []),
    onPartialTranscript: useCallback((partialText: string) => {
      setSttText(partialText);
    }, []),
  });

  // We need a local flag since asrStore.captureState is the source of truth
  const [isRecordingState, setIsRecordingState] = useState(false);
  const isRecording =
    asrStore.captureState === 'recording' ||
    asrStore.captureState === 'transcribing' ||
    isRecordingState;

  // Recording timer — driven by asrStore.recordingStartedAt
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        const startedAt = asrStore.recordingStartedAt ?? Date.now();
        setRecordSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 500);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (!isRecording) {
        setRecordSeconds(0);
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  // Clone recording timer
  useEffect(() => {
    if (isCloneRecording) {
      cloneTimerRef.current = setInterval(() => {
        setCloneSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (cloneTimerRef.current) {
        clearInterval(cloneTimerRef.current);
      }
    }
    return () => {
      if (cloneTimerRef.current) {
        clearInterval(cloneTimerRef.current);
      }
    };
  }, [isCloneRecording]);

  const toggleRecording = () => {
    ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
    if (!asrStore.asrAvailable) {
      Alert.alert(
        'STT yoqilmagan',
        'Settings > Voice Input > Voice Input yoqing.',
        [{text: 'OK'}],
      );
      return;
    }
    if (!asrStore.isSelectedTierReady) {
      Alert.alert(
        'Whisper modeli yuklanmagan',
        'Settings > Voice Input ga o\'ting va Whisper modelini yuklab oling.',
        [{text: 'OK'}],
      );
      return;
    }
    if (isRecording) {
      voiceCapture.stop();
      setIsRecordingState(false);
    } else {
      setSttText('');
      setRecordSeconds(0);
      setIsRecordingState(true);
      voiceCapture.start();
    }
  };

  const handleCopyStt = () => {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    if (!sttText.trim()) {
      return;
    }
    Clipboard.setString(sttText);
    Alert.alert('Nusxalandi', 'Matn buferga nusxalandi.');
  };

  const handleSendToChat = async () => {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    if (!sttText.trim()) {
      return;
    }
    chatSessionStore.saveDraft(chatSessionStore.activeSessionId ?? 'new_chat_draft', sttText);
    navigation.navigate(ROUTES.CHAT);
  };

  const handleSendToTts = () => {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    if (!sttText.trim()) {
      return;
    }
    setTtsText(sttText);
    setActiveTab('tts');
  };

  // ----- Real TTS (Piper/Supertonic) integration -----
  const handlePlayTts = async () => {
    ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
    if (!ttsText.trim()) {
      return;
    }
    if (isPlaying) {
      setIsPlaying(false);
      await ttsStore.stop('voice-studio-user');
    } else {
      if (!ttsStore.isTTSAvailable) {
        Alert.alert(
          'TTS mavjud emas',
          'Matndan ovozga o\'chirish uchun avval Settings > Voice > TTS modelini yuklab oling.',
          [{text: 'OK'}],
        );
        return;
      }
      setIsPlaying(true);
      const msgId = `voice-studio-${Date.now()}`;
      try {
        await ttsStore.play(msgId, ttsText);
      } catch (e) {
        console.warn('[VoiceStudio] TTS play error:', e);
      } finally {
        setIsPlaying(false);
      }
    }
  };

  // Sync isPlaying with store
  useEffect(() => {
    if (ttsStore.playbackState.mode === 'idle' && isPlaying) {
      setIsPlaying(false);
    }
  }, [ttsStore.playbackState.mode, isPlaying]);

  const handleCloneToggle = () => {
    ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
    if (isCloneRecording) {
      setIsCloneRecording(false);
      setHasClonedVoice(true);
      Alert.alert('Ovoz klonlandi!', '15 soniyalik ovoz namunasi saqlandi.');
    } else {
      setCloneSeconds(0);
      setIsCloneRecording(true);
    }
  };

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remaining = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`;
  };

  const isTTSReady = ttsStore.isTTSAvailable;
  const isSTTReady = asrStore.asrAvailable && asrStore.isSelectedTierReady;

  return (
    <View style={styles.root}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.hamburgerButton}
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          accessibilityLabel="Menyu"
          accessibilityRole="button">
          <MenuIcon stroke={theme.colors.text} width={22} height={22} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ovoz studiyasi</Text>
      </View>

      {/* Segmented Control */}
      <View style={styles.segmentedControl}>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'stt' && styles.segmentActive]}
          onPress={() => setActiveTab('stt')}
          activeOpacity={0.8}>
          <Text
            style={
              activeTab === 'stt'
                ? styles.segmentTitleActive
                : styles.segmentTitleInactive
            }>
            STT
          </Text>
          <Text
            style={
              activeTab === 'stt'
                ? styles.segmentSubtitleActive
                : styles.segmentSubtitleInactive
            }>
            Ovozdan matn
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segment, activeTab === 'tts' && styles.segmentActive]}
          onPress={() => setActiveTab('tts')}
          activeOpacity={0.8}>
          <Text
            style={
              activeTab === 'tts'
                ? styles.segmentTitleActive
                : styles.segmentTitleInactive
            }>
            TTS
          </Text>
          <Text
            style={
              activeTab === 'tts'
                ? styles.segmentSubtitleActive
                : styles.segmentSubtitleInactive
            }>
            Matndan ovoz
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">

        {/* ===== STT TAB ===== */}
        {activeTab === 'stt' && (
          <View>
            {/* Model info card */}
            <View style={styles.modelCard}>
              <View style={styles.modelCardRow}>
                <View
                  style={[
                    styles.modelStatusDot,
                    {backgroundColor: isSTTReady ? '#34D399' : '#6B7280'},
                  ]}
                />
                <Text style={styles.modelCardTitle}>
                  {isSTTReady ? 'Whisper — Tayyor' : 'Whisper — yuklanmagan'}
                </Text>
              </View>
              <Text style={styles.modelCardSub}>
                {isSTTReady
                  ? 'Offline nutqni aniqlash modeli'
                  : asrStore.asrAvailable
                    ? 'Settings > Voice Input da yuklab oling'
                    : 'Settings > Voice Input da yoqing'}
              </Text>
            </View>

            {/* Mic button */}
            <View style={styles.micContainer}>
              <TouchableOpacity
                style={[
                  styles.micButton,
                  isRecording && styles.micButtonActive,
                  !isSTTReady && styles.micButtonDisabled,
                ]}
                onPress={toggleRecording}
                activeOpacity={0.8}
                accessibilityLabel={isRecording ? 'Yozishni to\'xtatish' : 'Ovoz yozishni boshlash'}
                accessibilityRole="button">
                {isRecording ? (
                  <StopIcon stroke="#fff" width={36} height={36} />
                ) : (
                  <MicrophoneIcon stroke="#fff" width={36} height={36} />
                )}
              </TouchableOpacity>
              <Text style={styles.timerText}>
                {isRecording
                  ? (asrStore.captureState === 'transcribing'
                    ? 'Tahlil qilinmoqda...'
                    : formatTimer(recordSeconds))
                  : (isSTTReady ? 'Bosib gapiring' : 'Model yuklanmagan')}
              </Text>
            </View>

            {/* Waveform placeholder */}
            {isRecording && (
              <View style={styles.waveformRow}>
                {Array.from({length: 24}).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: 8 + Math.floor(Math.random() * 24),
                        opacity: 0.5 + Math.random() * 0.5,
                      },
                    ]}
                  />
                ))}
              </View>
            )}

            {/* Transcript output */}
            <View style={styles.transcriptBox}>
              <Text style={styles.transcriptText}>
                {sttText || (isRecording ? '...' : 'Bu yerda matn paydo bo\'ladi')}
              </Text>
            </View>

            {/* Action buttons */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, !sttText && styles.actionBtnDisabled]}
                onPress={handleCopyStt}
                disabled={!sttText}>
                <UploadIcon stroke={sttText ? theme.colors.text : '#6B7280'} width={18} height={18} />
                <Text style={[styles.actionBtnText, !sttText && {color: '#6B7280'}]}>
                  Nusxa
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, !sttText && styles.actionBtnDisabled]}
                onPress={handleSendToTts}
                disabled={!sttText}>
                <PlayIcon stroke={sttText ? theme.colors.text : '#6B7280'} width={18} height={18} />
                <Text style={[styles.actionBtnText, !sttText && {color: '#6B7280'}]}>
                  TTS ga
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, !sttText && styles.actionBtnDisabled]}
                onPress={handleSendToChat}
                disabled={!sttText}>
                <CheckBoldIcon fill={sttText ? theme.colors.text : '#6B7280'} width={18} height={18} />
                <Text style={[styles.actionBtnText, !sttText && {color: '#6B7280'}]}>
                  Chatga
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ===== TTS TAB ===== */}
        {activeTab === 'tts' && (
          <View>
            {/* Model info card */}
            <View style={styles.modelCard}>
              <View style={styles.modelCardRow}>
                <View
                  style={[
                    styles.modelStatusDot,
                    {backgroundColor: isTTSReady ? '#34D399' : '#6B7280'},
                  ]}
                />
                <Text style={styles.modelCardTitle}>
                  {isTTSReady ? 'Piper TTS — Tayyor' : 'Piper TTS — yuklanmagan'}
                </Text>
              </View>
              <Text style={styles.modelCardSub}>
                {isTTSReady
                  ? 'Offline matndan ovoz modeli'
                  : 'Settings > Voice da yuklab oling'}
              </Text>
            </View>

            {/* Voice selector chips */}
            <View style={styles.voiceChipsRow}>
              {(['voice1', 'voice2', 'cloned'] as const).map(v => (
                <TouchableOpacity
                  key={v}
                  style={[
                    styles.voiceChip,
                    selectedVoice === v && styles.voiceChipActive,
                    v === 'cloned' && !hasClonedVoice && styles.voiceChipDisabled,
                  ]}
                  disabled={v === 'cloned' && !hasClonedVoice}
                  onPress={() => setSelectedVoice(v)}>
                  <Text
                    style={[
                      styles.voiceChipText,
                      selectedVoice === v && styles.voiceChipTextActive,
                    ]}>
                    {v === 'voice1' ? 'Ovoz 1' : v === 'voice2' ? 'Ovoz 2' : 'Klonlangan'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Text input */}
            <TextInput
              style={styles.ttsInput}
              value={ttsText}
              onChangeText={setTtsText}
              multiline
              maxLength={1000}
              placeholder="Matn kiriting (maks. 1000 belgi)..."
              placeholderTextColor="#6B9E8A"
            />
            <Text style={styles.charCount}>{ttsText.length}/1000</Text>

            {/* Speed slider placeholder */}
            <View style={styles.speedRow}>
              <Text style={styles.speedLabel}>Tezlik</Text>
              <View style={styles.speedButtons}>
                {[0.5, 0.75, 1.0, 1.25, 1.5].map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.speedBtn, speed === s && styles.speedBtnActive]}
                    onPress={() => setSpeed(s)}>
                    <Text style={[styles.speedBtnText, speed === s && styles.speedBtnTextActive]}>
                      {s}x
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Play button */}
            <TouchableOpacity
              style={[styles.playButton, (!isTTSReady || !ttsText.trim()) && styles.playButtonDisabled]}
              onPress={handlePlayTts}
              disabled={!ttsText.trim()}
              activeOpacity={0.8}>
              {isPlaying ? (
                <StopIcon stroke="#fff" width={22} height={22} />
              ) : (
                <PlayIcon stroke="#fff" width={22} height={22} />
              )}
              <Text style={styles.playButtonText}>
                {isPlaying ? 'To\'xtatish' : (isTTSReady ? '▷ Eshittirish' : 'TTS yuklanmagan')}
              </Text>
            </TouchableOpacity>

            {/* Voice Cloning */}
            <View style={styles.cloningSection}>
              <Text style={styles.cloningSectionTitle}>Ovoz klonlash</Text>
              <Text style={styles.cloningSectionSub}>
                15 soniya yozib, o'z ovozingizni modellang
              </Text>

              {/* Consent */}
              <TouchableOpacity
                style={styles.consentRow}
                onPress={() => setConsentChecked(c => !c)}
                activeOpacity={0.8}>
                <View
                  style={[
                    styles.checkbox,
                    consentChecked && styles.checkboxChecked,
                  ]}>
                  {consentChecked && (
                    <CheckBoldIcon fill="#fff" width={12} height={12} />
                  )}
                </View>
                <Text style={styles.consentText}>
                  Men o'z ovozimni klonlashga roziman
                </Text>
              </TouchableOpacity>

              {/* Clone mic button */}
              <TouchableOpacity
                style={[
                  styles.cloneMicButton,
                  isCloneRecording && styles.cloneMicButtonActive,
                  !consentChecked && styles.micButtonDisabled,
                ]}
                onPress={handleCloneToggle}
                disabled={!consentChecked}
                activeOpacity={0.8}>
                {isCloneRecording ? (
                  <StopIcon stroke="#fff" width={24} height={24} />
                ) : (
                  <MicrophoneIcon stroke="#fff" width={24} height={24} />
                )}
                <Text style={styles.cloneMicText}>
                  {isCloneRecording
                    ? `Yozilmoqda... ${formatTimer(cloneSeconds)}`
                    : (hasClonedVoice ? 'Qayta yozish' : 'Yozishni boshlash')}
                </Text>
              </TouchableOpacity>

              {/* Cloning waveform */}
              {isCloneRecording && (
                <View style={styles.waveformRow}>
                  {Array.from({length: 20}).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.waveBar,
                        {height: 6 + Math.floor(Math.random() * 20)},
                      ]}
                    />
                  ))}
                </View>
              )}

              {/* Saved voice item */}
              {hasClonedVoice && (
                <View style={styles.savedVoiceCard}>
                  <View style={styles.savedVoiceInfo}>
                    <Text style={styles.savedVoiceName}>Mening ovozim</Text>
                    <Text style={styles.savedVoiceMeta}>~15 soniya · az-Latn</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setHasClonedVoice(false);
                      setSelectedVoice('voice1');
                    }}>
                    <TrashIcon stroke="#EF4444" width={18} height={18} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
});
