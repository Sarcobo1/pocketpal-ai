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

import {useTheme} from '../../hooks';
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
import {chatSessionStore, ttsStore} from '../../store';

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
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(12);
  const [sttText, setSttText] = useState(
    "Bugun ob-havo qanday bo'ladi? Shamol kuchli bo'ladimi?",
  );
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // TTS state
  const [ttsText, setTtsText] = useState(
    'Salom. Men sizning offline yordamchingizman.',
  );
  const [selectedVoice, setSelectedVoice] = useState<'voice1' | 'voice2' | 'cloned'>('voice1');
  const [speed, setSpeed] = useState(1.0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Voice cloning state
  const [isCloneRecording, setIsCloneRecording] = useState(false);
  const [cloneSeconds, setCloneSeconds] = useState(14);
  const [consentChecked, setConsentChecked] = useState(true);
  const [hasClonedVoice, setHasClonedVoice] = useState(true);

  // Recording timer effect
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  const toggleRecording = () => {
    ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
    if (!isRecording) {
      setRecordSeconds(0);
      setIsRecording(true);
    } else {
      setIsRecording(false);
    }
  };

  const handleCopyStt = () => {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    Clipboard.setString(sttText);
    Alert.alert('Nusxalandi', 'Matn buferga nusxalandi.');
  };

  const handleSendToChat = async () => {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    chatSessionStore.saveDraft(chatSessionStore.activeSessionId ?? 'new_chat_draft', sttText);
    navigation.navigate(ROUTES.CHAT);
  };

  const handleSendToTts = () => {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    setTtsText(sttText);
    setActiveTab('tts');
  };

  const handlePlayTts = () => {
    ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
    if (isPlaying) {
      setIsPlaying(false);
      ttsStore.stop?.();
    } else {
      setIsPlaying(true);
      // TTSStore exposes play(messageId, text) — use a synthetic message id
      const msgId = `voice-studio-${Date.now()}`;
      (ttsStore as any).play(msgId, ttsText)
        .finally(() => setIsPlaying(false));
    }
  };

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remaining = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`;
  };

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

      <ScrollView showsVerticalScrollIndicator={false}>
        {activeTab === 'stt' ? (
          /* ==================== STT TAB ==================== */
          <>
            {/* Chips Row */}
            <View style={styles.chipsRow}>
              <View style={styles.chip}>
                <Text style={styles.chipText}>Whisper Tiny · 75 MB</Text>
              </View>
              <View style={styles.chip}>
                <Text style={styles.chipText}>O'zbek</Text>
              </View>
            </View>

            {/* Recording Card */}
            <View style={styles.recordingCard}>
              {/* Waveform Bars */}
              <View style={styles.waveformContainer}>
                {[14, 28, 42, 34, 22, 38, 20, 26].map((h, i) => (
                  <View
                    key={i}
                    style={[
                      styles.waveformBar,
                      {
                        height: isRecording ? Math.max(8, (h * (i % 2 === 0 ? 1.2 : 0.8))) : h,
                        opacity: isRecording ? 1 : 0.7,
                      },
                    ]}
                  />
                ))}
              </View>

              {/* 88px Mic Button */}
              <TouchableOpacity
                style={styles.micButtonLarge}
                onPress={toggleRecording}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Ovoz yozish">
                <MicrophoneIcon width={36} height={36} color={theme.colors.onPrimary} />
              </TouchableOpacity>

              <Text style={styles.micStatusText}>
                {isRecording
                  ? `Gapiring... · ${formatTimer(recordSeconds)}`
                  : `Bosib turing va gapiring · ${formatTimer(recordSeconds)}`}
              </Text>
            </View>

            {/* Result Card */}
            <View style={styles.card}>
              <Text style={styles.resultCardHeader}>Matn</Text>
              <TextInput
                style={styles.resultText}
                value={sttText}
                onChangeText={setSttText}
                multiline
                placeholder="Bu yerda ovoz matni ko'rinadi"
                placeholderTextColor={theme.colors.onSurfaceVariant}
              />
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleCopyStt}
                  activeOpacity={0.8}>
                  <Text style={styles.actionButtonText}>Nusxa</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleSendToChat}
                  activeOpacity={0.8}>
                  <Text style={styles.actionButtonText}>Chatga yuborish</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleSendToTts}
                  activeOpacity={0.8}>
                  <Text style={styles.actionButtonText}>TTS ga</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Import Audio Card */}
            <TouchableOpacity
              style={styles.importCard}
              activeOpacity={0.8}
              onPress={() => Alert.alert('Fayl tanlash', 'Audio faylni (.mp3 .wav .m4a) tanlang.')}>
              <Text style={styles.importCardText}>
                Audio fayldan matnga (.mp3 .wav .m4a)
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          /* ==================== TTS TAB ==================== */
          <>
            {/* Chip */}
            <View style={styles.chipsRow}>
              <View style={styles.chip}>
                <Text style={styles.chipText}>Piper + klon modeli</Text>
              </View>
            </View>

            {/* Input Card */}
            <View style={styles.card}>
              <Text style={styles.resultCardHeader}>Matn</Text>
              <TextInput
                style={styles.ttsInput}
                value={ttsText}
                onChangeText={setTtsText}
                multiline
                maxLength={1000}
                placeholder="O'qilishi kerak bo'lgan matnni kiriting..."
                placeholderTextColor={theme.colors.onSurfaceVariant}
              />
              <Text style={styles.charCounter}>{ttsText.length} / 1000</Text>
            </View>

            {/* Voice Cards */}
            <Text style={styles.sectionHeader}>Ovozlar</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.voicesScroll}>
              <TouchableOpacity
                style={[
                  styles.voiceCard,
                  selectedVoice === 'voice1' && styles.voiceCardSelected,
                ]}
                onPress={() => setSelectedVoice('voice1')}
                activeOpacity={0.8}>
                <Text style={styles.voiceCardName}>Ovoz 1</Text>
                <Text style={styles.voiceCardMeta}>Erkak</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.voiceCard,
                  selectedVoice === 'voice2' && styles.voiceCardSelected,
                ]}
                onPress={() => setSelectedVoice('voice2')}
                activeOpacity={0.8}>
                <Text style={styles.voiceCardName}>Ovoz 2</Text>
                <Text style={styles.voiceCardMeta}>Ayol</Text>
              </TouchableOpacity>

              {hasClonedVoice && (
                <TouchableOpacity
                  style={[
                    styles.voiceCard,
                    selectedVoice === 'cloned' && styles.voiceCardSelected,
                  ]}
                  onPress={() => setSelectedVoice('cloned')}
                  activeOpacity={0.8}>
                  <Text style={styles.voiceCardName} numberOfLines={1}>
                    Mening...
                  </Text>
                  <View style={styles.voiceCardBadge}>
                    <Text style={styles.voiceCardBadgeText}>Klon</Text>
                  </View>
                </TouchableOpacity>
              )}
            </ScrollView>

            {/* Speed Slider / Control */}
            <View style={styles.sliderContainer}>
              <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>Tezlik</Text>
                <Text style={styles.sliderValue}>{speed.toFixed(1)}x</Text>
              </View>
              <View style={styles.actionsRow}>
                {[0.8, 1.0, 1.2, 1.5].map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.actionButton,
                      speed === s && {backgroundColor: theme.colors.primary},
                    ]}
                    onPress={() => setSpeed(s)}>
                    <Text
                      style={[
                        styles.actionButtonText,
                        speed === s && {color: theme.colors.onPrimary, fontWeight: '700'},
                      ]}>
                      {s.toFixed(1)}x
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Big Play Button */}
            <TouchableOpacity
              style={styles.playButton}
              onPress={handlePlayTts}
              activeOpacity={0.85}>
              <Text style={styles.playButtonText}>
                {isPlaying ? '◼ To\'xtatish' : '▷ Eshittirish'}
              </Text>
            </TouchableOpacity>

            {/* Voice Cloning Card */}
            <View style={styles.card}>
              <View style={styles.cloneCardHeaderRow}>
                <Text style={styles.cloneCardTitle}>Ovozni klonlash</Text>
                <View style={styles.offlineBadge}>
                  <Text style={styles.offlineBadgeText}>Offline</Text>
                </View>
              </View>

              <Text style={styles.cloneSubtitle}>
                20–30 soniya aniq ovozingizni yozing. Namuna telefondan chiqmaydi.
              </Text>

              <View style={styles.promptBox}>
                <Text style={styles.promptBoxText}>
                  O'qing: «Quyosh sekin ko'tarilib, shahar uyg'ona boshladi. Ko'chalarda birinchi odamlar paydo bo'ldi.»
                </Text>
              </View>

              {/* Waveform + Timer */}
              <View style={styles.waveformContainer}>
                {[10, 22, 34, 28, 18, 30, 16, 24].map((h, i) => (
                  <View
                    key={i}
                    style={[
                      styles.waveformBar,
                      {
                        height: isCloneRecording ? Math.max(6, h * 1.2) : h,
                        opacity: isCloneRecording ? 1 : 0.6,
                      },
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.cloneTimerText}>
                0:{cloneSeconds.toString().padStart(2, '0')} / 0:30
              </Text>

              {/* Buttons: Yozish & Fayl yuklash */}
              <View style={styles.cloneButtonsRow}>
                <TouchableOpacity
                  style={styles.cloneRecordBtn}
                  onPress={() => setIsCloneRecording(!isCloneRecording)}
                  activeOpacity={0.85}>
                  <MicrophoneIcon width={18} height={18} color={theme.colors.onPrimary} />
                  <Text style={styles.cloneRecordBtnText}>
                    {isCloneRecording ? "To'xtatish" : "Yozish"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cloneUploadBtn}
                  onPress={() => Alert.alert('Fayl', 'Audio faylni yuklang')}
                  activeOpacity={0.8}>
                  <UploadIcon width={18} height={18} stroke={theme.colors.text} />
                  <Text style={styles.cloneUploadBtnText}>Fayl yuklash</Text>
                </TouchableOpacity>
              </View>

              {/* Consent Checkbox */}
              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setConsentChecked(!consentChecked)}
                activeOpacity={0.8}>
                <View
                  style={[
                    styles.checkboxBox,
                    consentChecked && styles.checkboxChecked,
                  ]}>
                  {consentChecked && (
                    <CheckBoldIcon width={12} height={12} fill={theme.colors.onPrimary} />
                  )}
                </View>
                <Text style={styles.checkboxLabel}>
                  Bu mening ovozim yoki egasi ruxsat bergan
                </Text>
              </TouchableOpacity>

              {/* Clone Submit Button */}
              <TouchableOpacity
                style={[
                  styles.cloneSubmitBtn,
                  consentChecked && styles.cloneSubmitBtnActive,
                ]}
                disabled={!consentChecked}
                onPress={() => {
                  ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
                  setHasClonedVoice(true);
                  setSelectedVoice('cloned');
                  Alert.alert('Muvaffaqiyatli', 'Ovozingiz muvaffaqiyatli klonlandi!');
                }}>
                <Text style={styles.cloneSubmitBtnText}>Ovozni klonlash</Text>
              </TouchableOpacity>

              {/* Saved Cloned Voice Row */}
              {hasClonedVoice && (
                <View style={styles.clonedItemRow}>
                  <View>
                    <Text style={styles.clonedItemTitle}>Mening ovozim</Text>
                    <Text style={styles.clonedItemMeta}>0:24 · 3 daqiqa oldin</Text>
                  </View>
                  <View style={{flexDirection: 'row', gap: 8}}>
                    <TouchableOpacity
                      style={styles.iconBtnSmall}
                      onPress={handlePlayTts}>
                      <PlayIcon width={16} height={16} fill={theme.colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconBtnSmall}
                      onPress={() => {
                        setHasClonedVoice(false);
                        if (selectedVoice === 'cloned') {
                          setSelectedVoice('voice1');
                        }
                      }}>
                      <TrashIcon width={16} height={16} stroke={theme.colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
});
