import React, {useState} from 'react';
import {View, ScrollView, TouchableOpacity, Pressable} from 'react-native';
import {Text, Switch} from 'react-native-paper';
import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {LimiGhost} from '../../components/LimiGhost';
import {createStyles} from './styles';

interface LessonStep {
  title: string;
  code: string;
  highlight_lines: number[];
  diagram: {type: string; formula?: string};
  output: string;
  narration: string;
}

const MOCK_LESSON_STEPS: LessonStep[] = [
  {
    title: 'Funksiya taʼrifi va chaqirish',
    code: 'def faktorial(n):\n    if n <= 1:\n        return 1\n    return n * faktorial(n - 1)',
    highlight_lines: [1, 2],
    diagram: {type: 'code'},
    output: 'faktorial(5) -> 120',
    narration:
      'Rekursiv funksiya oʻz-oʻzini chaqiruvchi algoritm hisoblanadi. Bazaviy holat n <= 1 boʻlganda rekursiya toʻxtaydi.',
  },
  {
    title: 'Rekursiya steki va hisoblash',
    code: 'faktorial(3)\n  = 3 * faktorial(2)\n  = 3 * (2 * faktorial(1))\n  = 3 * (2 * 1) = 6',
    highlight_lines: [3, 4],
    diagram: {type: 'call_stack'},
    output: '6',
    narration:
      'Har bir chaqiruv xotira stekida saqlanadi va pastdan yuqoriga qaytariladi.',
  },
];

const SUBJECTS = [
  'Barchasi',
  'Dasturlash',
  'Matematika',
  'Fizika',
  'Sunʼiy Intellekt',
];

export const DarsScreen: React.FC = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);

  const [activeSubject, setActiveSubject] = useState('Barchasi');
  const [inLesson, setInLesson] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<'1.0x' | '1.5x' | '2.0x'>('1.0x');
  const [voiceNarration, setVoiceNarration] = useState(true);
  const [stepVerification, setStepVerification] = useState(true);

  const step = MOCK_LESSON_STEPS[currentStep] ?? MOCK_LESSON_STEPS[0];

  const handleNextStep = () => {
    if (currentStep < MOCK_LESSON_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const cycleSpeed = () => {
    setSpeed(s => (s === '1.0x' ? '1.5x' : s === '1.5x' ? '2.0x' : '1.0x'));
  };

  return (
    <View style={styles.container} testID="dars-screen">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {inLesson ? (
          // Dars ichi (Lesson View)
          <>
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={() => setInLesson(false)}
                style={styles.controlIconButton}
                accessibilityLabel="Orqaga qaytish"
                testID="dars-back-button">
                <Text style={styles.controlIconText}>←</Text>
              </TouchableOpacity>
              <Text style={styles.screenTitle}>Python: Rekursiya</Text>
            </View>

            {/* Qadam progressi */}
            <View style={styles.cardHeader}>
              <Text style={styles.cardEyebrow}>
                Qadam {currentStep + 1} / {MOCK_LESSON_STEPS.length}
              </Text>
              <Text style={styles.cardMeta}>{speed}</Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${
                      ((currentStep + 1) / MOCK_LESSON_STEPS.length) * 100
                    }%`,
                  },
                ]}
              />
            </View>

            {/* Doska kartasi (#030A08) */}
            <View style={styles.blackboardCard} testID="dars-blackboard">
              <View style={styles.blackboardHeader}>
                <Text style={styles.blackboardBadge}>{step.title}</Text>
                <Text style={styles.cardEyebrow}>KOD DOSKASI</Text>
              </View>
              <View style={styles.codeHighlightedLine}>
                <Text style={styles.codeSnippet}>{step.code}</Text>
              </View>
              {step.output ? (
                <View style={{marginTop: theme.spacing.sm}}>
                  <Text style={styles.cardEyebrow}>Natija:</Text>
                  <Text
                    style={[styles.codeSnippet, {color: theme.colors.primary}]}>
                    {step.output}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Izoh kartasi: Ghost(28) + Limi tushuntiryapti */}
            <View style={styles.explanationCard} testID="dars-explanation">
              <View style={styles.explanationHeader}>
                <LimiGhost size={28} state="working" label="Limi" />
                <Text style={styles.explanationTitle}>Limi tushuntiryapti</Text>
              </View>
              <Text style={styles.narrationText}>
                {step.narration.split(' ').map((word, idx) => (
                  <Text
                    key={idx}
                    style={
                      idx < 4 && isPlaying
                        ? styles.narrationWordActive
                        : undefined
                    }>
                    {word}{' '}
                  </Text>
                ))}
              </Text>
            </View>

            {/* Boshqaruv: Oldingi, Pauza (72), Keyingi, Tezlik */}
            <View style={styles.controlsRow}>
              <TouchableOpacity
                onPress={handlePrevStep}
                disabled={currentStep === 0}
                style={[
                  styles.controlIconButton,
                  currentStep === 0 && {opacity: 0.4},
                ]}
                accessibilityLabel="Oldingi qadam"
                testID="dars-prev-step">
                <Text style={styles.controlIconText}>⏮</Text>
              </TouchableOpacity>

              <Pressable
                onPress={() => setIsPlaying(!isPlaying)}
                style={styles.pauseButton}
                accessibilityLabel={isPlaying ? 'Pauza' : 'Ijro'}
                testID="dars-play-pause">
                <Text
                  style={{
                    fontSize: 24,
                    color: theme.colors.onPrimary,
                  }}>
                  {isPlaying ? '⏸' : '▶'}
                </Text>
              </Pressable>

              <TouchableOpacity
                onPress={handleNextStep}
                disabled={currentStep === MOCK_LESSON_STEPS.length - 1}
                style={[
                  styles.controlIconButton,
                  currentStep === MOCK_LESSON_STEPS.length - 1 && {
                    opacity: 0.4,
                  },
                ]}
                accessibilityLabel="Keyingi qadam"
                testID="dars-next-step">
                <Text style={styles.controlIconText}>⏭</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={cycleSpeed}
                style={styles.controlIconButton}
                accessibilityLabel={`Tezlik: ${speed}`}
                testID="dars-speed-toggle">
                <Text style={styles.controlIconText}>{speed}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, {marginTop: theme.spacing.sm}]}
              accessibilityLabel="Savol bering"
              testID="dars-ask-question">
              <Text style={styles.buttonText}>Savol bering</Text>
            </TouchableOpacity>
          </>
        ) : (
          // Mavzular sahifasi (Topics View)
          <>
            <View style={styles.headerRow}>
              <LimiGhost size={32} state="default" label="Limi Dars" />
              <Text style={styles.screenTitle}>Darslar</Text>
            </View>

            {/* Fan chiplari */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsScroll}>
              {SUBJECTS.map(subj => {
                const active = subj === activeSubject;
                return (
                  <TouchableOpacity
                    key={subj}
                    onPress={() => setActiveSubject(subj)}
                    style={[styles.chip, active && styles.chipActive]}
                    accessibilityLabel={subj}>
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}>
                      {subj}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* "Davom etish" kartasi */}
            <View style={styles.card} testID="dars-continue-card">
              <View style={styles.cardHeader}>
                <Text style={styles.cardEyebrow}>DAVOM ETISH</Text>
                <Text style={styles.cardMeta}>60% yakunlandi</Text>
              </View>
              <Text style={styles.cardTitle}>Python: Rekursiya asoslari</Text>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, {width: '60%'}]} />
              </View>
              <TouchableOpacity
                style={styles.button}
                onPress={() => setInLesson(true)}
                accessibilityLabel="Darsni davom ettirish"
                testID="dars-continue-button">
                <Text style={styles.buttonText}>Darsni davom ettirish</Text>
              </TouchableOpacity>
            </View>

            {/* Mavzu kartalari */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardEyebrow}>MATEMATIKA</Text>
                <Text style={styles.cardMeta}>15 daqiqa · Boshlangʻich</Text>
              </View>
              <Text style={styles.cardTitle}>Kvadrat tenglamalar yechish</Text>
              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={() => setInLesson(true)}
                accessibilityLabel="Darsni boshlash">
                <Text style={styles.buttonSecondaryText}>Boshlash</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardEyebrow}>SUNʼIY INTELLEKT</Text>
                <Text style={styles.cardMeta}>25 daqiqa · Oʻrta</Text>
              </View>
              <Text style={styles.cardTitle}>
                Neyron toʻrlar: Perseptron va Gradiyent tushishi
              </Text>
              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={() => setInLesson(true)}
                accessibilityLabel="Darsni boshlash">
                <Text style={styles.buttonSecondaryText}>Boshlash</Text>
              </TouchableOpacity>
            </View>

            {/* Ikki switch */}
            <View style={styles.card}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Ovozli tushuntirish</Text>
                <Switch
                  value={voiceNarration}
                  onValueChange={setVoiceNarration}
                  color={theme.colors.primary}
                />
              </View>
              <View style={[styles.switchRow, styles.switchRowLast]}>
                <Text style={styles.switchLabel}>Qadam-baqadam tekshirish</Text>
                <Switch
                  value={stepVerification}
                  onValueChange={setStepVerification}
                  color={theme.colors.primary}
                />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
});

DarsScreen.displayName = 'DarsScreen';
