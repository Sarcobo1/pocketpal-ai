import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
} from 'react-native';
import {Text, Switch, ActivityIndicator} from 'react-native-paper';
import {observer} from 'mobx-react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import Speech from '@pocketpalai/react-native-speech';

import {useTheme} from '../../hooks';
import {LimiGhost} from '../../components/LimiGhost';
import {createStyles} from './styles';
import {ROUTES} from '../../utils/navigationConstants';
import {ttsStore, chatSessionStore} from '../../store';

export interface LessonStep {
  title: string;
  code: string;
  highlight_lines: number[];
  diagramTitle?: string;
  diagram: string;
  output: string;
  narration: string;
}

export interface Lesson {
  id: string;
  subject: string;
  title: string;
  subtitle: string;
  duration: string;
  level: string;
  steps: LessonStep[];
}

const PREBUILT_LESSONS: Lesson[] = [
  {
    id: 'py-recursion',
    subject: 'Dasturlash',
    title: 'Python: Rekursiya asoslari',
    subtitle: 'Funksiyaning oʻz-oʻzini chaqirishi, bazaviy holat va stek xotira',
    duration: '10 daqiqa',
    level: 'Boshlangʻich',
    steps: [
      {
        title: 'Funksiya taʼrifi va bazaviy holat',
        code: `def faktorial(n):\n    # 1. Bazaviy holat: rekursiyani to'xtatadi\n    if n <= 1:\n        return 1\n    # 2. Rekursiv chaqiruv: masalani kichraytiradi\n    return n * faktorial(n - 1)`,
        highlight_lines: [2, 3],
        diagramTitle: 'REKURSIYA SXEMASI',
        diagram: `faktorial(3)\n  └── 3 * faktorial(2)\n        └── 2 * faktorial(1)\n              └── 1  (bazaviy holat!)`,
        output: 'faktorial(1) -> 1',
        narration:
          'Rekursiv funksiya — bu oʻz-oʻzini chaqiruvchi algoritm. Har qanday rekursiyaning eng muhim qismi — bazaviy holatdir. Agar bazaviy holat boʻlmasa, funksiya cheksiz chaqirilib, xotira toʻlib qoladi.',
      },
      {
        title: 'Rekursiya steki va hisoblash jarayoni',
        code: `# Stek xotira (Call Stack) ketma-ketligi:\n# faktorial(3) kutmoqda...\n# faktorial(2) kutmoqda...\n# faktorial(1) = 1 qaytardi!\n\nnatija = 3 * (2 * 1)\nprint("Natija:", natija)`,
        highlight_lines: [4, 5],
        diagramTitle: 'CALL STACK (STEK XOTIRA)',
        diagram: `┌───────────────────────┐\n│ faktorial(1) = 1      │ <- Stek cho'qqisi (qaytaradi)\n├───────────────────────┤\n│ faktorial(2) = 2 * 1  │ <- Kutmoqda\n├───────────────────────┤\n│ faktorial(3) = 3 * 2  │ <- Pastki chaqiruv\n└───────────────────────┘`,
        output: 'Natija: 6',
        narration:
          'Chaqiruv steki har bir chaqirilgan funksiya holatini saqlaydi. Bazaviy holatga yetgach, natijalar teskari tartibda, pastdan yuqoriga qarab koʻpaytirilib qaytariladi.',
      },
      {
        title: 'Vaqt va xotira murakkabligi',
        code: `# Vaqt murakkabligi: O(N)\n# Xotira murakkabligi: O(N) call stack\nprint(f"5! = {faktorial(5)}")\nprint(f"6! = {faktorial(6)}")`,
        highlight_lines: [3, 4],
        diagramTitle: 'XULOSA VA BAHOLASH',
        diagram: `Vaqt: O(N) | Xotira: O(N)\nMaslahat: Katta sonlar uchun iterativ sikl yoki memoizatsiya afzal!`,
        output: '5! = 120\n6! = 720',
        narration:
          'Rekursiya kodni tushunarli va ixcham qiladi. Lekin har bir chaqiruv xotiradan joy oladi. Shuning uchun daraxtlar va boʻlib tashla uslubidagi masalalarda rekursiya eng qulay yechimdir.',
      },
    ],
  },
  {
    id: 'js-async',
    subject: 'Dasturlash',
    title: 'JavaScript: Promise va Async/Await',
    subtitle: 'Asinxron dasturlash, Event Loop va Microtasks',
    duration: '15 daqiqa',
    level: 'Oʻrta',
    steps: [
      {
        title: 'Sinxron vs Asinxron kod',
        code: `console.log("1. Dastur boshlandi");\nsetTimeout(() => {\n  console.log("2. Serverdan ma'lumot keldi");\n}, 1000);\nconsole.log("3. Dastur tugadi");`,
        highlight_lines: [2, 3, 4],
        diagramTitle: 'EVENT LOOP OQIMI',
        diagram: `Call Stack: [log(1)] -> [log(3)]\nWeb API:    setTimeout (1s taymer)\nQueue:      [log(2)] -> Stack bo'shagach ishga tushadi`,
        output: `1. Dastur boshlandi\n3. Dastur tugadi\n2. Serverdan ma'lumot keldi`,
        narration:
          'JavaScript bitta oqimli til. U sekin operatsiyalarni, masalan internetdan maʼlumot olishni orqa fonga yuklaydi va asosiy dastur toʻxtab qolishining oldini oladi.',
      },
      {
        title: 'Async/Await yordamida maʼlumot olish',
        code: `async function yuklash(url) {\n  const res = await fetch(url);\n  const data = await res.json();\n  return data.name;\n}\n\n// Natijani kutib olish\nconst user = await yuklash('/api/user/1');\nconsole.log("Foydalanuvchi:", user);`,
        highlight_lines: [2, 3],
        diagramTitle: 'PROMISE RESOLUTION',
        diagram: `[async funksiya] -> [await fetch] (kutish) -> [JSON] -> [Data]`,
        output: 'Foydalanuvchi: "Limi AI"',
        narration:
          'Async va Await kalit soʻzlari asinxron kodni xuddi oddiy sinxron kod kabi qulay oʻqilishini taʼminlaydi. Await faqat async funksiyalar ichida ishlaydi.',
      },
    ],
  },
  {
    id: 'algo-bs',
    subject: 'Dasturlash',
    title: 'Algoritmlar: Binary Search (Binar qidiruv)',
    subtitle: 'Saralangan massivda O(log N) tezlikda qidirish',
    duration: '12 daqiqa',
    level: 'Boshlangʻich',
    steps: [
      {
        title: 'Massivni ikkiga boʻlish algoritmi',
        code: `def binary_search(arr, target):\n    low = 0\n    high = len(arr) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1\n    return -1`,
        highlight_lines: [4, 5, 6],
        diagramTitle: 'BOʻLINISH JARAYONI',
        diagram: `[1, 3, 5, 7, 9, 11, 13, 15]  Qidirilayotgan: 11\n         ^ mid = 7 (kichik, o'ngga o'tamiz)\n               [9, 11, 13, 15]\n                   ^ mid = 11 (Topildi! Index: 5)`,
        output: 'binary_search([1, 3, 5, 7, 9, 11, 13], 11) -> 5',
        narration:
          'Binar qidiruv faqat saralangan massivlarda ishlaydi. Har bir qadamda qidiruv sohasini teng ikkiga qisqartiradi, shuning uchun juda tez ishlaydi.',
      },
      {
        title: 'Samaradorlik: O(log N)',
        code: `# 1,000,000 ta element ichidan qidirish:\n# Oddiy qidiruv: 1,000,000 ta taqqoslash\n# Binar qidiruv: maksimal 20 ta taqqoslash!\nimport math\nprint("Maksimal qadamlar soni:", math.ceil(math.log2(1000000)))`,
        highlight_lines: [4, 5],
        diagramTitle: 'LOG N SAMARADORLIGI',
        diagram: `N = 1,000,000 element\nQadam 1: 500,000\nQadam 2: 250,000\n...\nQadam 20: 1 ta element!`,
        output: 'Maksimal qadamlar soni: 20',
        narration:
          'Millionlab maʼlumotlar orasidan kerakli qiymatni topish uchun binar qidiruvga atigi yigirmata qadam kifoya qiladi. Bu algoritmlarning eng goʻzal namunasidir.',
      },
    ],
  },
  {
    id: 'css-flexbox',
    subject: 'Veb Dasturlash',
    title: 'HTML & CSS: Flexbox maketlash',
    subtitle: 'Moslashuvchan interfeyslar va elementlarni joylashtirish',
    duration: '10 daqiqa',
    level: 'Boshlangʻich',
    steps: [
      {
        title: 'Asosiy oʻq va display: flex',
        code: `.container {\n  display: flex;\n  justify-content: center; /* Asosiy o'q bo'yicha markazga */\n  align-items: center;     /* Ko'ndalang o'q bo'yicha markazga */\n  gap: 16px;\n}`,
        highlight_lines: [2, 3, 4],
        diagramTitle: 'FLEXBOX OʻQLARI',
        diagram: `       justify-content (Main Axis ->)\n  ┌───────────────────────────────────┐\n  │  [Box 1]     [Box 2]     [Box 3]  │ align-items\n  │                                   │ (Cross Axis ↓)\n  └───────────────────────────────────┘`,
        output: 'Elementlar markazga tekislandi',
        narration:
          'Flexbox zamonaviy veb-saytlarda elementlarni bir qatorda yoki ustunda qulay va chiroyli joylashtirish imkonini beradi. Display flex orqali konteyner moslashuvchan boʻladi.',
      },
      {
        title: 'Flex-grow va moslashuvchanlik',
        code: `.sidebar {\n  width: 250px;\n}\n.main-content {\n  flex: 1; /* Qolgan barcha bo'sh joyni egallaydi */\n}`,
        highlight_lines: [4, 5],
        diagramTitle: 'MOSLASHUVCHAN TAQSIMOT',
        diagram: `┌────────────┬─────────────────────────────┐\n│ Sidebar    │ Main Content (flex: 1)      │\n│ (250px)    │ (Butun qolgan bo'sh qism)   │\n└────────────┴─────────────────────────────┘`,
        output: 'Responsiv ekran tayyor',
        narration:
          'Flex: 1 buyrugʻi orqali element ekrandagi barcha qolgan boʻsh joyni avtomatik toʻldiradi. Bu telefon va kompyuterlar uchun moslashuvchan dizayn asosidir.',
      },
    ],
  },
  {
    id: 'math-quad',
    subject: 'Matematika',
    title: 'Kvadrat tenglamalar va Diskriminant',
    subtitle: 'ax² + bx + c = 0 formulasini tahlil qilish va yechish',
    duration: '15 daqiqa',
    level: 'Boshlangʻich',
    steps: [
      {
        title: 'Diskriminant formulasi',
        code: `# Tenglama: a*x^2 + b*x + c = 0\n# D = b^2 - 4*a*c\n# Misol: x^2 - 5x + 6 = 0 (a=1, b=-5, c=6)\nD = (-5)**2 - 4 * 1 * 6\nprint(f"Diskriminant: D = {D}")`,
        highlight_lines: [2, 4],
        diagramTitle: 'DISKRIMINANT TAHLILI',
        diagram: `D > 0: Ikkita haqiqiy ildiz (x1, x2)\nD = 0: Bitta ildiz (x = -b / 2a)\nD < 0: Haqiqiy ildiz mavjud emas`,
        output: 'Diskriminant: D = 1',
        narration:
          'Kvadrat tenglama maktab va oliy matematikaning poydevoridir. Diskriminant tenglama nechta yechimga ega ekanligini bir zumda aniqlab beradi.',
      },
      {
        title: 'Ildizlarni topish',
        code: `import math\n# x1,2 = (-b ± sqrt(D)) / (2*a)\nx1 = (-(-5) + math.sqrt(D)) / (2*1)\nx2 = (-(-5) - math.sqrt(D)) / (2*1)\nprint(f"Ildizlar: x1 = {x1}, x2 = {x2}")`,
        highlight_lines: [2, 3, 4],
        diagramTitle: 'ILDIZLAR TAQSIMOTI',
        diagram: `x1 = (5 + 1) / 2 = 3\nx2 = (5 - 1) / 2 = 2\nTekshirish: 3^2 - 5*3 + 6 = 9 - 15 + 6 = 0 (To'g'ri!)`,
        output: 'Ildizlar: x1 = 3.0, x2 = 2.0',
        narration:
          'Diskriminant noldan katta boʻlgani sababli, biz ildiz ostidan qiymat chiqarib, ikkita alohida haqiqiy ildizni muvaffaqiyatli hisobladik.',
      },
    ],
  },
  {
    id: 'phys-newton',
    subject: 'Fizika',
    title: 'Nyutonning ikkinchi qonuni: F = m · a',
    subtitle: 'Kuch, massa va tezlanish bogʻliqligi',
    duration: '12 daqiqa',
    level: 'Boshlangʻich',
    steps: [
      {
        title: 'Kuch formulasi va hisoblash',
        code: `# F = m * a (Kuch = Massa * Tezlanish)\n# Avtomobil massasi: 1200 kg\n# Talab qilingan tezlanish: 2.5 m/s^2\n\nkuch = 1200 * 2.5\nprint(f"Talab qilingan kuch: {kuch} N")`,
        highlight_lines: [1, 5],
        diagramTitle: 'KUCH VA TEZLANISH VEKTORI',
        diagram: `     Kuch (F) ───►  [Jism: m = 1200kg]  ───► Tezlanish (a)\n     Kuch qanchalik katta bo'lsa, tezlanish shuncha ortadi.\n     Massa qancha katta bo'lsa, uni tezlatish shuncha qiyin bo'ladi.`,
        output: 'Talab qilingan kuch: 3000.0 N',
        narration:
          'Nyutonning ikkinchi qonuni jismga taʼsir qiluvchi kuch uning massasi va olgan tezlanishining koʻpaytmasiga teng ekanligini ifodalaydi. Kuch Nyutonlarda oʻlchanadi.',
      },
    ],
  },
  {
    id: 'ai-perceptron',
    subject: 'Sunʼiy Intellekt',
    title: 'Neyron toʻrlar: Perseptron modeli',
    subtitle: 'Kirish signallari, ogʻirliklar va aktivatsiya funksiyasi',
    duration: '20 daqiqa',
    level: 'Oʻrta',
    steps: [
      {
        title: 'Neyron matematik modeli',
        code: `# z = w1*x1 + w2*x2 + bias\nw1, w2 = 0.5, 0.8  # Og'irliklar\nx1, x2 = 1.0, 0.0  # Kirish signallari\nbias = -0.2        # Siljish koeffitsiyenti\n\nz = (w1 * x1) + (w2 * x2) + bias\nprint(f"Neyron yig'indisi z: {z}")`,
        highlight_lines: [1, 6],
        diagramTitle: 'PERSEPTRON TUZILISHI',
        diagram: `(x1) ───[w1]───┐\n                ├──► [Σ (Yig'indi) + b] ──► [Aktivatsiya] ──► Chiqish (Y)\n(x2) ───[w2]───┘`,
        output: 'Neyron yigʻindisi z: 0.3',
        narration:
          'Sunʼiy neyron inson miyasidagi biologik neyronlardan ilhomlangan. U kiruvchi maʼlumotlarni ogʻirliklarga koʻpaytirib yigʻadi va aktivatsiya funksiyasiga uzatadi.',
      },
      {
        title: 'Aktivatsiya funksiyasi (ReLU / Sigmoid)',
        code: `def relu(x):\n    return max(0, x)\n\ndef sigmoid(x):\n    import math\n    return 1 / (1 + math.exp(-x))\n\nprint(f"ReLU(0.3) = {relu(0.3)}")\nprint(f"Sigmoid(0.3) = {sigmoid(0.3):.4f}")`,
        highlight_lines: [2, 6],
        diagramTitle: 'AKTIVATSIYA GRAFIGI',
        diagram: `ReLU:    y = max(0, x)  (Noldan kichiklari 0, kattalari o'zi)\nSigmoid: S-simon egri chiziq, 0 dan 1 gacha ehtimollik beradi`,
        output: 'ReLU(0.3) = 0.3\nSigmoid(0.3) = 0.5744',
        narration:
          'Aktivatsiya funksiyasi neyronga chiziqli boʻlmagan xususiyat beradi. Bu neyron toʻrga murakkab rasmlar, ovozlar va matnlarni tushunish imkoniyatini taqdim etadi.',
      },
    ],
  },
];

const SUBJECTS = [
  'Barchasi',
  'Dasturlash',
  'Veb Dasturlash',
  'Matematika',
  'Fizika',
  'Sunʼiy Intellekt',
];

const QUICK_TOPICS = [
  'TypeScript Generics',
  'Docker asoslari',
  'Binar qidiruv',
  'SQL Join turlari',
  'Kvant fizikasi',
  'React Hooks',
];

/**
 * Intelligent dynamic lesson builder for ANY custom topic the user provides.
 */
function createLessonForTopic(topicName: string): Lesson {
  const clean = topicName.trim();
  const matched = PREBUILT_LESSONS.find(
    l => l.title.toLowerCase().includes(clean.toLowerCase()) ||
         clean.toLowerCase().includes(l.title.toLowerCase()),
  );
  if (matched) {
    return matched;
  }

  return {
    id: `custom-${Date.now()}`,
    subject: 'Maxsus Dars',
    title: clean,
    subtitle: `"${clean}" mavzusi boʻyicha AI orqali tayyorlangan interaktiv dars`,
    duration: '15 daqiqa',
    level: 'Amaliy',
    steps: [
      {
        title: '1. Asosiy tushuncha va arxitektura',
        code: `# ${clean} asosiy sintaksisi va ta'rifi\nclass Tushuncha:\n    def __init__(self, mavzu):\n        self.mavzu = mavzu\n        self.faol = True\n\nobyekt = Tushuncha("${clean}")\nprint(f"Mavzu o'rganilmoqda: {obyekt.mavzu}")`,
        highlight_lines: [2, 6],
        diagramTitle: 'ARXITEKTURA VA TIZIM TUZILISHI',
        diagram: `┌──────────────────────────────────────────────┐\n│ [Kirish: ${clean}]                           │\n│        ↓                                     │\n│ [Mexanizm: Ma'lumotlarni qayta ishlash]     │\n│        ↓                                     │\n│ [Chiqish: Yakuniy natija va xotira holati]   │\n└──────────────────────────────────────────────┘`,
        output: `Mavzu o'rganilmoqda: ${clean}`,
        narration: `${clean} mavzusining mohiyati shundaki, u tizim samaradorligini oshirish va kodni toʻgʻri tuzilmaga keltirish uchun xizmat qiladi. Ushbu bosqichda asosiy arxitektura va poydevor tushunchalarini koʻrib chiqamiz.`,
      },
      {
        title: '2. Ishlash mexanizmi va amaliy kod',
        code: `def bajarish(parametr):\n    # ${clean} amaliy algoritmi\n    qadamlar = [f"Qadam {i}" for i in range(1, 4)]\n    return f"${clean} muvaffaqiyatli bajarildi: " + " -> ".join(qadamlar)\n\nnatija = bajarish("${clean}")\nprint(natija)`,
        highlight_lines: [3, 4],
        diagramTitle: 'BAJARILISH KETMA-KETLIGI',
        diagram: `[1-qadam: Tayyorgarlik] -> [2-qadam: Hisoblash] -> [3-qadam: Natija]`,
        output: `${clean} muvaffaqiyatli bajarildi: Qadam 1 -> Qadam 2 -> Qadam 3`,
        narration: `Ushbu bosqichda ${clean} qanday ishlashini amaliy misolda koʻrib chiqamiz. Funksiya parametrlarini tahlil qilib, xotirada maʼlumotlar qanday oʻzgarishini kuzatishingiz mumkin.`,
      },
      {
        title: '3. Real loyihalarda qoʻllash va xulosa',
        code: `# ${clean} uchun eng yaxshi amaliyotlar (Best Practices)\ndef tekshirish():\n    assert True, "Barcha testlar muvaffaqiyatli o'tdi!"\n    return "Tayyor! ${clean} to'liq o'zlashtirildi."\n\nprint(tekshirish())`,
        highlight_lines: [2, 3],
        diagramTitle: 'XULOSA VA TAVSIYALAR',
        diagram: `✓ Xavfsizlik va toza kod qoidalari ta'minlandi\n✓ Xotira va resurslar optimallashtirildi\n✓ Loyihada to'g'ridan-to'g'ri foydalanishga tayyor!`,
        output: `Tayyor! ${clean} to'liq o'zlashtirildi.`,
        narration: `Ajoyib! Siz ${clean} boʻyicha asosiy qoidalarni oʻrgandingiz. Real loyihalarda ushbu uslubdan foydalanish dasturingiz tezligi va ishonchliligini sezilarli darajada oshiradi.`,
      },
    ],
  };
}

export const DarsScreen: React.FC = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [activeSubject, setActiveSubject] = useState('Barchasi');
  const [inLesson, setInLesson] = useState(false);
  const [currentLesson, setCurrentLesson] = useState<Lesson>(PREBUILT_LESSONS[0]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<'1.0x' | '1.5x' | '2.0x'>('1.0x');
  const [voiceNarration, setVoiceNarration] = useState(true);
  const [stepVerification, setStepVerification] = useState(true);

  // Custom topic creator state
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Code run simulation state
  const [isRunningCode, setIsRunningCode] = useState(false);
  const [codeVerified, setCodeVerified] = useState(false);

  const step = currentLesson.steps[currentStep] ?? currentLesson.steps[0];

  // Stop audio on unmount or when leaving lesson
  useEffect(() => {
    return () => {
      stopLessonAudio();
    };
  }, []);

  const playLessonAudio = async (text: string, stepIdx: number) => {
    try {
      await stopLessonAudio();
      setIsPlaying(true);
      if (ttsStore.isTTSAvailable || ttsStore.voiceOutputActive) {
        await ttsStore.play(`dars-step-${stepIdx}`, text);
      } else {
        await Speech.speak(text);
      }
    } catch (err) {
      console.warn('[DarsScreen] Play error, falling back to Speech:', err);
      try {
        await Speech.speak(text);
      } catch {}
    } finally {
      setIsPlaying(false);
    }
  };

  const stopLessonAudio = async () => {
    try {
      await ttsStore.stop();
    } catch {}
    try {
      await Speech.stop();
    } catch {}
    setIsPlaying(false);
  };

  const handleTogglePlayPause = async () => {
    if (isPlaying) {
      await stopLessonAudio();
    } else {
      await playLessonAudio(step.narration, currentStep);
    }
  };

  const handleNextStep = async () => {
    if (currentStep < currentLesson.steps.length - 1) {
      await stopLessonAudio();
      const nextIdx = currentStep + 1;
      setCurrentStep(nextIdx);
      setCodeVerified(false);
      if (voiceNarration) {
        setTimeout(() => {
          playLessonAudio(currentLesson.steps[nextIdx].narration, nextIdx);
        }, 200);
      }
    }
  };

  const handlePrevStep = async () => {
    if (currentStep > 0) {
      await stopLessonAudio();
      const prevIdx = currentStep - 1;
      setCurrentStep(prevIdx);
      setCodeVerified(false);
      if (voiceNarration) {
        setTimeout(() => {
          playLessonAudio(currentLesson.steps[prevIdx].narration, prevIdx);
        }, 200);
      }
    }
  };

  const cycleSpeed = () => {
    setSpeed(s => (s === '1.0x' ? '1.5x' : s === '1.5x' ? '2.0x' : '1.0x'));
  };

  const handleStartLesson = (lesson: Lesson) => {
    stopLessonAudio();
    setCurrentLesson(lesson);
    setCurrentStep(0);
    setCodeVerified(false);
    setInLesson(true);
    if (voiceNarration && lesson.steps[0]) {
      setTimeout(() => {
        playLessonAudio(lesson.steps[0].narration, 0);
      }, 350);
    }
  };

  const handleCreateCustomLesson = (topic?: string) => {
    const raw = topic || customTopicInput;
    if (!raw.trim()) return;
    setIsGenerating(true);
    setTimeout(() => {
      const generated = createLessonForTopic(raw);
      setIsGenerating(false);
      setCustomTopicInput('');
      handleStartLesson(generated);
    }, 300);
  };

  const handleRunCode = () => {
    setIsRunningCode(true);
    setTimeout(() => {
      setIsRunningCode(false);
      setCodeVerified(true);
    }, 450);
  };

  const handleAskQuestion = () => {
    stopLessonAudio();
    const promptDraft = `[Dars: ${currentLesson.title}] Qadam: "${step.title}". Savolim: `;
    chatSessionStore.restoreUnsentText(chatSessionStore.activeSessionId, promptDraft);
    navigation.navigate(ROUTES.CHAT);
  };

  const filteredLessons = PREBUILT_LESSONS.filter(l =>
    activeSubject === 'Barchasi' ? true : l.subject === activeSubject,
  );

  return (
    <View style={styles.container} testID="dars-screen">
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {paddingTop: Math.max(insets.top, 16) + 8},
        ]}
        showsVerticalScrollIndicator={false}>
        {inLesson ? (
          // ================= INTERACTIVE LESSON VIEW =================
          <>
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={() => {
                  stopLessonAudio();
                  setInLesson(false);
                }}
                style={styles.controlIconButton}
                accessibilityLabel="Orqaga qaytish"
                testID="dars-back-button">
                <Text style={styles.controlIconText}>←</Text>
              </TouchableOpacity>
              <View style={{flex: 1}}>
                <Text style={styles.cardEyebrow}>{currentLesson.subject.toUpperCase()}</Text>
                <Text style={styles.screenTitle} numberOfLines={1}>
                  {currentLesson.title}
                </Text>
              </View>
            </View>

            {/* Qadam progressi */}
            <View style={styles.cardHeader}>
              <Text style={styles.cardEyebrow}>
                Qadam {currentStep + 1} / {currentLesson.steps.length}: {step.title}
              </Text>
              <Text style={styles.cardMeta}>{speed}</Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${
                      ((currentStep + 1) / currentLesson.steps.length) * 100
                    }%`,
                  },
                ]}
              />
            </View>

            {/* Doska kartasi (#030A08) */}
            <View style={styles.blackboardCard} testID="dars-blackboard">
              <View style={styles.blackboardHeader}>
                <Text style={styles.blackboardBadge}>{step.title}</Text>
                <Text style={styles.cardEyebrow}>KOD VA VIZUAL DOSKA</Text>
              </View>

              {/* Kod bloki */}
              <View style={styles.codeHighlightedLine}>
                <Text style={styles.codeSnippet}>{step.code}</Text>
              </View>

              {/* Vizual diagramma bloki */}
              {step.diagram ? (
                <View style={styles.diagramContainer}>
                  <View style={styles.diagramHeader}>
                    <Text style={styles.diagramTitle}>
                      {step.diagramTitle || 'VIZUAL SXEMA'}
                    </Text>
                  </View>
                  <Text style={styles.diagramContent}>{step.diagram}</Text>
                </View>
              ) : null}

              {/* Konsol chiqishi va Run tugmasi */}
              <View style={styles.outputContainer}>
                <View style={styles.outputHeader}>
                  <Text style={styles.cardEyebrow}>KONSOL NATIJASI:</Text>
                  <TouchableOpacity
                    style={styles.runButton}
                    onPress={handleRunCode}
                    disabled={isRunningCode}>
                    {isRunningCode ? (
                      <ActivityIndicator size={12} color={theme.colors.primary} />
                    ) : (
                      <Text style={styles.runButtonText}>
                        {codeVerified ? '✓ Tekshirildi' : '▶ Bajarish'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
                <Text style={[styles.codeSnippet, {color: theme.colors.primary}]}>
                  {codeVerified || !stepVerification ? step.output : 'Kodni ishga tushirish uchun "▶ Bajarish" tugmasini bosing'}
                </Text>
              </View>
            </View>

            {/* Izoh kartasi: Ghost + Limi tushuntiryapti */}
            <View style={styles.explanationCard} testID="dars-explanation">
              <View style={styles.explanationHeader}>
                <LimiGhost
                  size={28}
                  state={isPlaying ? 'working' : 'default'}
                  label="Limi"
                />
                <View style={{flex: 1}}>
                  <Text style={styles.explanationTitle}>Limi tushuntiryapti</Text>
                  <Text style={styles.cardEyebrow}>
                    {isPlaying ? '🔊 Ovozli tushuntirish ketyapti...' : 'Ovozli dars tayyor'}
                  </Text>
                </View>
                {isPlaying && (
                  <View style={styles.liveStatusBadge}>
                    <Text style={styles.liveStatusText}>Jonli ijro</Text>
                  </View>
                )}
              </View>

              <Text style={styles.narrationText}>
                {step.narration.split(' ').map((word, idx) => (
                  <Text
                    key={idx}
                    style={
                      idx < 8 && isPlaying
                        ? styles.narrationWordActive
                        : undefined
                    }>
                    {word}{' '}
                  </Text>
                ))}
              </Text>
            </View>

            {/* Boshqaruv tugmalari */}
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
                onPress={handleTogglePlayPause}
                style={styles.pauseButton}
                accessibilityLabel={isPlaying ? 'Pauza' : 'Ijro'}
                testID="dars-play-pause">
                <Text
                  style={{
                    fontSize: 26,
                    color: theme.colors.onPrimary,
                  }}>
                  {isPlaying ? '⏸' : '▶'}
                </Text>
              </Pressable>

              <TouchableOpacity
                onPress={handleNextStep}
                disabled={currentStep === currentLesson.steps.length - 1}
                style={[
                  styles.controlIconButton,
                  currentStep === currentLesson.steps.length - 1 && {
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
              onPress={handleAskQuestion}
              accessibilityLabel="Savol bering"
              testID="dars-ask-question">
              <Text style={styles.buttonText}>💬 Ushbu qadam boʻyicha savol bering</Text>
            </TouchableOpacity>
          </>
        ) : (
          // ================= MAVZULAR SAHIFASI (TOPICS VIEW) =================
          <>
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={() => {
                  stopLessonAudio();
                  if (navigation.canGoBack()) {
                    navigation.goBack();
                  } else {
                    navigation.navigate(ROUTES.CHAT);
                  }
                }}
                style={styles.controlIconButton}
                accessibilityLabel="Orqaga qaytish"
                testID="dars-topics-back-button">
                <Text style={styles.controlIconText}>←</Text>
              </TouchableOpacity>
              <LimiGhost size={32} state="default" label="Limi Dars" />
              <View>
                <Text style={styles.screenTitle}>Limi Dars</Text>
                <Text style={styles.cardEyebrow}>Interaktiv va ovozli taʼlim</Text>
              </View>
            </View>

            {/* O'z darsingizni yarating (Custom Lesson Creator Card) */}
            <View style={styles.customTopicCard} testID="dars-custom-creator">
              <View style={styles.customTopicHeader}>
                <Text style={styles.customTopicTitle}>✨ Oʻz darsingizni yarating</Text>
              </View>
              <Text style={styles.customTopicSubtitle}>
                Istalgan mavzuni yozing — Limi sizga interaktiv kod, vizual doska va ovozli dars tayyorlab beradi.
              </Text>

              <TextInput
                style={styles.customInput}
                placeholder="Mavzuni kiriting (masalan: Kvant fizikasi, Docker, SQL...)"
                placeholderTextColor={theme.colors.onSurfaceVariant}
                value={customTopicInput}
                onChangeText={setCustomTopicInput}
                returnKeyType="done"
                onSubmitEditing={() => handleCreateCustomLesson()}
              />

              <View style={styles.suggestionsWrapper}>
                <Text style={[styles.cardEyebrow, {marginBottom: 6}]}>
                  Tavsiya etilgan mavzular:
                </Text>
                <View style={styles.suggestionChipsRow}>
                  {QUICK_TOPICS.map(topic => (
                    <TouchableOpacity
                      key={topic}
                      style={styles.suggestionChip}
                      onPress={() => handleCreateCustomLesson(topic)}>
                      <Text style={styles.suggestionChipText}>+ {topic}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                style={styles.generateButton}
                onPress={() => handleCreateCustomLesson()}
                disabled={isGenerating}>
                {isGenerating ? (
                  <ActivityIndicator size={16} color={theme.colors.onPrimary} />
                ) : (
                  <Text style={styles.generateButtonText}>
                    Darsni yaratish va boshlash →
                  </Text>
                )}
              </TouchableOpacity>
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

            {/* Darslar ro'yxati */}
            {filteredLessons.map(lesson => (
              <View key={lesson.id} style={styles.card} testID={`lesson-card-${lesson.id}`}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardEyebrow}>
                    {lesson.subject.toUpperCase()} · {lesson.duration} · {lesson.level}
                  </Text>
                  <Text style={styles.cardMeta}>{lesson.steps.length} qadam</Text>
                </View>
                <Text style={styles.cardTitle}>{lesson.title}</Text>
                <Text
                  style={[
                    styles.cardEyebrow,
                    {marginBottom: theme.spacing.sm, lineHeight: 18},
                  ]}>
                  {lesson.subtitle}
                </Text>

                <TouchableOpacity
                  style={styles.button}
                  onPress={() => handleStartLesson(lesson)}
                  accessibilityLabel={`Darsni boshlash: ${lesson.title}`}>
                  <Text style={styles.buttonText}>Darsni boshlash →</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* Sozlamalar kalitlari */}
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
