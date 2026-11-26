import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {DrawerActions, useNavigation} from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {apiServerStore, modelStore} from '../../store';
import {ROUTES} from '../../utils/navigationConstants';
import {MenuIcon} from '../../assets/icons';
import {createStyles} from './styles';

type CodeLang = 'python' | 'curl' | 'node';

function formatCountdown(sec: number | null): string {
  if (sec === null) return '--:--';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export const ApiServerScreen: React.FC = observer(() => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const styles = createStyles(theme, insets.top, insets.bottom);

  const [codeLang, setCodeLang] = useState<CodeLang>('python');
  const [portInput, setPortInput] = useState(String(apiServerStore.port));
  const [isTesting, setIsTesting] = useState(false);
  const [testReply, setTestReply] = useState<string | null>(null);

  const downloadedModels = modelStore.models.filter(m => m.isDownloaded);

  useEffect(() => {
    apiServerStore.refreshNetworkStatus().catch(() => {});
    if (!apiServerStore.deployedModelId && downloadedModels.length > 0) {
      apiServerStore.setDeployedModel(downloadedModels[0]!);
    }
  }, [downloadedModels.length]);

  const handleCopy = (label: string, value: string) => {
    Clipboard.setString(value);
    Alert.alert('Nusxalandi', `${label} buferga nusxalandi.`);
  };

  const handleDeployToggle = async () => {
    if (apiServerStore.isRunning) {
      await apiServerStore.stop();
      setTestReply(null);
      return;
    }

    const parsedPort = parseInt(portInput, 10);
    if (!isNaN(parsedPort)) {
      apiServerStore.setPort(parsedPort);
    }

    const res = await apiServerStore.start();
    if (!res.ok) {
      if (res.reason === 'no_internet') {
        Alert.alert(
          'Internet talab qilinadi',
          res.message || 'Modelni online qilish uchun internetni yoqing.',
          [
            {text: 'Bekor qilish', style: 'cancel'},
            {
              text: 'Internetni yoqish',
              onPress: () => apiServerStore.openNetworkSettings(),
            },
          ],
        );
      } else {
        Alert.alert('Xatolik', res.message || 'Serverni yoqib bo\'lmadi.');
      }
    }
  };

  const handleTestApi = async () => {
    if (!apiServerStore.isRunning) return;
    setIsTesting(true);
    setTestReply(null);
    const t0 = Date.now();
    try {
      const resp = await fetch(
        `http://127.0.0.1:${apiServerStore.port}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiServerStore.apiKey}`,
          },
          body: JSON.stringify({
            model: apiServerStore.effectiveModelName,
            messages: [{role: 'user', content: 'Salom! Qisqa javob ber.'}],
            max_tokens: 64,
            temperature: 0.7,
          }),
        },
      );
      const data = await resp.json();
      if (!resp.ok) {
        setTestReply(`Xato (${resp.status}): ${data?.error?.message || 'Noma\'lum xato'}`);
      } else {
        const txt = data?.choices?.[0]?.message?.content ?? '';
        const ms = Date.now() - t0;
        setTestReply(`✅ (${ms} ms): ${txt.trim()}`);
      }
    } catch (e: any) {
      setTestReply(`❌ Ulanish xatosi: ${e?.message || e}`);
    } finally {
      setIsTesting(false);
    }
  };

  const modelName = apiServerStore.effectiveModelName;
  const baseUrl = apiServerStore.baseUrl;
  const apiKey = apiServerStore.apiKey;

  const codeSnippet =
    codeLang === 'python'
      ? `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${apiKey}",
)

res = client.chat.completions.create(
    model="${modelName}",
    messages=[{"role": "user", "content": "Salom!"}],
)
print(res.choices[0].message.content)`
      : codeLang === 'curl'
      ? `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "model": "${modelName}",
    "messages": [{"role": "user", "content": "Salom!"}]
  }'`
      : `const res = await fetch("${baseUrl}/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiKey}",
  },
  body: JSON.stringify({
    model: "${modelName}",
    messages: [{ role: "user", content: "Salom!" }],
  }),
});
const data = await res.json();
console.log(data.choices[0].message.content);`;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.hamburgerButton}
            onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
            accessibilityLabel="Menyu"
            accessibilityRole="button">
            <MenuIcon stroke={theme.colors.text} width={22} height={22} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Model API (Deploy)</Text>
        </View>
        <View
          style={[
            styles.statusPill,
            apiServerStore.isRunning && styles.statusPillOnline,
          ]}>
          <View
            style={[
              styles.statusDot,
              apiServerStore.isRunning && styles.statusDotOnline,
            ]}
          />
          <Text style={styles.statusPillText}>
            {apiServerStore.isRunning ? 'ONLINE' : 'OFFLINE'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* Internet status card */}
        <View
          style={[
            styles.card,
            apiServerStore.isInternetConnected
              ? styles.netBannerOnline
              : styles.netBannerOffline,
          ]}>
          <View style={styles.rowBetween}>
            <View style={{flex: 1}}>
              <Text style={styles.cardTitle}>
                {apiServerStore.isInternetConnected
                  ? `🌐 Internet yoniq (${apiServerStore.networkType.toUpperCase()})`
                  : '⚠️ Internet o\'chirilgan'}
              </Text>
              <Text style={styles.cardSub}>
                {apiServerStore.isInternetConnected
                  ? `Telefon IP manzili: ${apiServerStore.localIp}`
                  : 'Modelni API sifatida deploy qilish uchun internetni yoqing.'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() =>
                apiServerStore.isInternetConnected
                  ? apiServerStore.refreshNetworkStatus()
                  : apiServerStore.openNetworkSettings()
              }>
              <Text style={styles.secondaryBtnText}>
                {apiServerStore.isInternetConnected
                  ? 'Yangilash'
                  : 'Yoqish'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Model selector card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>1. Yuklab olingan modelni tanlang</Text>
          {downloadedModels.length === 0 ? (
            <View style={{gap: 8}}>
              <Text style={styles.cardSub}>
                Hali hech qanday model yuklab olinmagan. Avval Models bo'limidan
                model yuklab oling.
              </Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => navigation.navigate(ROUTES.MODELS)}>
                <Text style={styles.secondaryBtnText}>Modellarga o'tish →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{gap: 8}}>
              {downloadedModels.map(m => {
                const selected = apiServerStore.deployedModelId === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[
                      styles.modelItem,
                      selected && styles.modelItemSelected,
                    ]}
                    disabled={apiServerStore.isRunning}
                    onPress={() => apiServerStore.setDeployedModel(m)}>
                    <View style={{flex: 1}}>
                      <Text style={styles.modelName}>{m.name}</Text>
                      <Text style={styles.modelMeta}>
                        {formatSize(m.size)} · {m.params ? `${m.params}B` : 'Local GGUF'}
                      </Text>
                    </View>
                    <Text style={{color: selected ? theme.colors.primary : theme.colors.onSurfaceVariant}}>
                      {selected ? '✓ Tanlangan' : 'Tanlash'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {downloadedModels.length > 0 && (
            <View style={{gap: 10, marginTop: 4}}>
              <View>
                <Text style={styles.inputLabel}>API Model nomi (kodda chaqiriladigan nom)</Text>
                <TextInput
                  style={styles.input}
                  value={apiServerStore.modelAlias}
                  onChangeText={t => apiServerStore.setModelAlias(t)}
                  editable={!apiServerStore.isRunning}
                  placeholder="Masalan: my-local-llm"
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                />
              </View>
              <View>
                <Text style={styles.inputLabel}>Port</Text>
                <TextInput
                  style={styles.input}
                  value={portInput}
                  onChangeText={setPortInput}
                  keyboardType="numeric"
                  editable={!apiServerStore.isRunning}
                  placeholder="11434"
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                />
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              apiServerStore.isRunning && styles.stopBtn,
              (downloadedModels.length === 0 || apiServerStore.isStarting) &&
                styles.primaryBtnDisabled,
            ]}
            disabled={downloadedModels.length === 0 || apiServerStore.isStarting}
            onPress={handleDeployToggle}>
            {apiServerStore.isStarting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : null}
            <Text style={styles.primaryBtnText}>
              {apiServerStore.isStarting
                ? 'Ishga tushirilmoqda...'
                : apiServerStore.isRunning
                ? '⏹ API Serverni to\'xtatish'
                : '🚀 Modelni Deploy qilish (Online)'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* RAM & 10-minute auto-unload card */}
        {apiServerStore.isRunning && (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                {apiServerStore.isLoadingModel
                  ? '⏳ Storagedan RAMga yuklanmoqda...'
                  : apiServerStore.isModelInRam
                  ? '🟢 RAMda faol'
                  : '🟡 Kutish rejimi (RAM bo\'shatilgan)'}
              </Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                disabled={apiServerStore.isLoadingModel || apiServerStore.activeRequests > 0}
                onPress={() =>
                  apiServerStore.isModelInRam
                    ? apiServerStore.unloadFromRamManually()
                    : apiServerStore.loadIntoRamManually()
                }>
                <Text style={styles.secondaryBtnText}>
                  {apiServerStore.isModelInRam ? 'RAMdan bo\'shatish' : 'RAMga yuklash'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.cardSub}>
              {apiServerStore.isModelInRam
                ? `Telefon qizimasligi uchun 10 daqiqa so'rov kelmasa model avtomatik RAMdan bo'shatiladi. Qolgan vaqt: ${formatCountdown(apiServerStore.secondsUntilUnload)}`
                : 'Model hozir RAMda joy egallamayapti. Tashqaridan API so\'rov kelishi bilan storagedan darhol RAMga yuklanib javob beradi.'}
            </Text>
            <View style={styles.statRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{apiServerStore.totalRequests}</Text>
                <Text style={styles.statLabel}>Jami so'rovlar</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{apiServerStore.activeRequests}</Text>
                <Text style={styles.statLabel}>Faol so'rov</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{apiServerStore.totalTokensGenerated}</Text>
                <Text style={styles.statLabel}>Tokenlar</Text>
              </View>
            </View>
          </View>
        )}

        {/* API Credentials & Endpoints */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>2. API ma'lumotlari (OpenAI mos)</Text>
          <View>
            <Text style={styles.inputLabel}>API Base URL</Text>
            <View style={styles.kvBox}>
              <Text style={styles.kvValue} selectable>
                {baseUrl}
              </Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => handleCopy('API URL', baseUrl)}>
                <Text style={styles.secondaryBtnText}>Nusxa</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View>
            <Text style={styles.inputLabel}>Model nomi</Text>
            <View style={styles.kvBox}>
              <Text style={styles.kvValue} selectable>
                {modelName}
              </Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => handleCopy('Model nomi', modelName)}>
                <Text style={styles.secondaryBtnText}>Nusxa</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View>
            <Text style={styles.inputLabel}>API Key (Bearer Token)</Text>
            <View style={styles.kvBox}>
              <Text style={styles.kvValue} numberOfLines={1} selectable>
                {apiKey}
              </Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => handleCopy('API Key', apiKey)}>
                <Text style={styles.secondaryBtnText}>Nusxa</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => apiServerStore.regenerateApiKey()}>
                <Text style={styles.secondaryBtnText}>↻</Text>
              </TouchableOpacity>
            </View>
          </View>

          {apiServerStore.isRunning && (
            <View style={{gap: 8}}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                disabled={isTesting}
                onPress={handleTestApi}>
                <Text style={styles.secondaryBtnText}>
                  {isTesting ? '⏳ So\'rov yuborilmoqda...' : '⚡ API ni sinash (Real HTTP Test)'}
                </Text>
              </TouchableOpacity>
              {testReply && (
                <View style={styles.codeBox}>
                  <Text style={styles.codeText}>{testReply}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Code examples */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>3. Kodda chaqirish namunasi</Text>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => handleCopy('Kod namunasi', codeSnippet)}>
              <Text style={styles.secondaryBtnText}>Kodni nusxalash</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.tabRow}>
            {(['python', 'curl', 'node'] as const).map(lang => (
              <TouchableOpacity
                key={lang}
                style={[styles.tabChip, codeLang === lang && styles.tabChipActive]}
                onPress={() => setCodeLang(lang)}>
                <Text
                  style={[
                    styles.tabChipText,
                    codeLang === lang && styles.tabChipTextActive,
                  ]}>
                  {lang === 'python' ? 'Python' : lang === 'curl' ? 'cURL' : 'Node.js'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.codeBox}>
            <Text style={styles.codeText} selectable>
              {codeSnippet}
            </Text>
          </View>
        </View>

        {/* Optional Outbound Relay */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>4. Tashqi server Relay (Ixtiyoriy)</Text>
          <Text style={styles.cardSub}>
            Agar tashqi serveringiz boshqa tarmoqda (masalan VPS/Cloud) bo'lsa va telefoningiz mobil internetda bo'lsa, WebSocket relay manzilini kiriting:
          </Text>
          <TextInput
            style={styles.input}
            value={apiServerStore.relayUrl}
            onChangeText={t => apiServerStore.setRelayUrl(t)}
            editable={!apiServerStore.isRunning}
            placeholder="wss://your-relay.example.com/ws"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            autoCapitalize="none"
          />
          {apiServerStore.relayUrl ? (
            <Text style={styles.cardSub}>
              Relay holati: {apiServerStore.relayConnected ? '🟢 Ulangan' : '⚪ Ulanmagan'}
            </Text>
          ) : null}
        </View>

        {/* Logs */}
        {apiServerStore.logs.length > 0 && (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>So'rovlar jurnali</Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => apiServerStore.clearLogs()}>
                <Text style={styles.secondaryBtnText}>Tozalash</Text>
              </TouchableOpacity>
            </View>
            {apiServerStore.logs.slice(0, 15).map(log => (
              <View key={log.id} style={styles.logRow}>
                <View style={styles.logTop}>
                  <Text style={styles.logPath}>
                    {log.method} {log.path} → {log.status}
                  </Text>
                  <Text style={styles.logMeta}>
                    {new Date(log.timestamp).toLocaleTimeString()} · {log.latencyMs}ms
                    {log.tokens ? ` · ${log.tokens} tok` : ''}
                  </Text>
                </View>
                {log.note ? <Text style={styles.logMeta}>{log.note}</Text> : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
});
