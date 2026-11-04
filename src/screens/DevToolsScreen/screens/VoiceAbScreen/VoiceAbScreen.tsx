import React, {useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  type ScrollViewInstance,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import {Card, Button, TextInput} from 'react-native-paper';
import {useNavigation} from '@react-navigation/native';

import {
  AB_VARIANTS,
  abClipPath,
  abDir,
  runAbBench,
  saveNewestClip,
} from '../../../../services/voice/abBench';
import type {AbSummaryRow} from '../../../../services/voice/abBench';
import {
  runSpeechBench,
  runSpeechCacheProbe,
  runSpeechQuantBench,
  speechQuantOptions,
  type SpeechCellSummary,
  type SpeechFileOption,
} from '../../../../services/voice/speechBench';
import {modelStore} from '../../../../store';
import {voiceAudioDir} from '../../../../services/voice/wav';

/**
 * The screen that runs the spoken-turn A/B: one recorded clip, four prompt
 * shapes, five runs each, on the model that is loaded right now.
 *
 * Everything the bench prints goes to the console as well, so the same numbers
 * can be read out of `logcat` after the fact — this list is only so a run can
 * be judged without a cable attached.
 *
 * The speech half below answers a different question — which setting on THIS
 * phone makes the model's voice keep up — and so it runs speech only: no
 * microphone, no text completion, no playback.
 */

const MAX_LOG_LINES = 400;

const VoiceAbScreen = () => {
  const navigation = useNavigation();
  const [clipName, setClipName] = useState('');
  const [expectText, setExpectText] = useState('');
  const [runs, setRuns] = useState('5');
  const [lines, setLines] = useState<string[]>([]);
  const [summary, setSummary] = useState<AbSummaryRow[]>([]);
  const [speechSummary, setSpeechSummary] = useState<SpeechCellSummary[]>([]);
  const [quantFiles, setQuantFiles] = useState<{
    texts: SpeechFileOption[];
    projectors: SpeechFileOption[];
  } | null>(null);
  const [selTexts, setSelTexts] = useState<string[]>([]);
  const [selProjectors, setSelProjectors] = useState<string[]>([]);
  const [quantSummary, setQuantSummary] = useState<SpeechCellSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const cancelRef = useRef(false);

  const append = (line: string) =>
    setLines(prev => [...prev.slice(-(MAX_LOG_LINES - 1)), line]);

  const pickClip = async () => {
    try {
      const name = await saveNewestClip();
      setClipName(name);
      append(`clip ${name} -> ${abClipPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('No clip', message);
      append(`clip failed: ${message}`);
    }
  };

  const run = async () => {
    if (busy) {
      return;
    }
    cancelRef.current = false;
    setBusy(true);
    setSummary([]);
    append(`=== run ${runs}x ${AB_VARIANTS.map(v => v.id).join('/')} ===`);
    try {
      const result = await runAbBench({
        runs: Math.max(1, Math.min(20, Number(runs) || 5)),
        expectText,
        isCancelled: () => cancelRef.current,
        onLine: append,
      });
      setSummary(result.summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Bench failed', message);
      append(`failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The speech matrix. It builds its own context per setting it measures, so it
   * unloads the model the chat is holding and the model has to be tapped again
   * when the table is done — said here rather than discovered by a blank chat.
   */
  const runSpeech = async (scope: 'quick' | 'full') => {
    if (busy) {
      return;
    }
    cancelRef.current = false;
    setBusy(true);
    setSpeechSummary([]);
    append(`=== speech bench ${scope} ${runs}x 1/2/3 sentences ===`);
    try {
      const result = await runSpeechBench({
        scope,
        runs: Math.max(1, Math.min(20, Number(runs) || 5)),
        isCancelled: () => cancelRef.current,
        onLine: append,
      });
      setSpeechSummary(result.summary);
      append('model unloaded — tap it again to resume chat or voice mode');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Speech bench failed', message);
      append(`speech failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  /** Whether a spoken reply leaves the next turn's prefix cache standing. */
  const runProbe = async () => {
    if (busy) {
      return;
    }
    cancelRef.current = false;
    setBusy(true);
    append('=== next-turn cache probe ===');
    try {
      await runSpeechCacheProbe({
        runs: Math.max(1, Math.min(10, Number(runs) || 3)),
        isCancelled: () => cancelRef.current,
        onLine: append,
      });
      append('model unloaded — tap it again to resume chat or voice mode');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Probe failed', message);
      append(`probe failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  /** Which GGUF files this phone could compare, as the run needs them. */
  const listQuantFiles = () => {
    const options = speechQuantOptions(modelStore.models);
    setQuantFiles(options);
    append(
      `on this phone: ${options.texts.length} model file(s), ${options.projectors.length} projector file(s)`,
    );
  };

  const toggleIn =
    (setter: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
      setter(prev =>
        prev.includes(id) ? prev.filter(value => value !== id) : [...prev, id],
      );

  /**
   * The same words out of two sets of weights. Each pair is its own model load,
   * so the run ends with the model unloaded like every other speech cell here.
   */
  const runQuant = async () => {
    if (busy || !selTexts.length) {
      return;
    }
    cancelRef.current = false;
    setBusy(true);
    setQuantSummary([]);
    append(
      `=== quant run ${runs}x — ${selTexts.length} model(s) × ${
        selProjectors.length || 'their own paired projector'
      } ===`,
    );
    try {
      const result = await runSpeechQuantBench({
        textIds: selTexts,
        projectorIds: selProjectors,
        runs: Math.max(1, Math.min(20, Number(runs) || 5)),
        isCancelled: () => cancelRef.current,
        onLine: append,
      });
      setQuantSummary(result.summary);
      append('model unloaded — tap it again to resume chat or voice mode');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Quant run failed', message);
      append(`quant failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const best = useMemo(() => {
    const clean = summary
      .filter(row => row.failed === 0)
      .sort(
        (a, b) => b.answered - a.answered || a.medianTotalMs - b.medianTotalMs,
      );
    return clean[0];
  }, [summary]);

  /** The cell that says the most per second of waiting, failures aside. */
  const bestSpeech = useMemo(() => {
    const clean = speechSummary
      .filter(row => row.failed === 0 && row.medianRtf !== null)
      .sort((a, b) => (a.medianRtf ?? 99) - (b.medianRtf ?? 99));
    return clean[0];
  }, [speechSummary]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Voice A/B</Text>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => navigation.goBack()}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}>
        <Card elevation={1} style={styles.card}>
          <Card.Title
            title="Fixed clip"
            subtitle={clipName ? `${clipName} → ${abClipPath}` : 'not chosen'}
          />
          <Card.Content>
            <Text style={styles.note}>
              Takes the newest recording voice mode left in {voiceAudioDir} and
              copies it to a fixed path, so every variant is asked the same
              question. History is empty by construction: the bench sends one
              turn, never the chat.
            </Text>
            <Button mode="outlined" onPress={pickClip} style={styles.button}>
              Save newest clip as bench clip
            </Button>
            <TextInput
              label="What the clip says"
              value={expectText}
              onChangeText={setExpectText}
              mode="outlined"
              style={styles.input}
              multiline
              numberOfLines={2}
            />
            <TextInput
              label="Runs per variant"
              value={runs}
              onChangeText={setRuns}
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
            />
            <View style={styles.buttonRow}>
              <Button
                mode="contained"
                onPress={run}
                disabled={busy || !clipName}
                style={styles.button}>
                {busy ? 'Running…' : 'Run V0–V3'}
              </Button>
              <Button
                mode="outlined"
                onPress={() => {
                  cancelRef.current = true;
                  append('stop asked');
                }}
                disabled={!busy}
                style={styles.button}>
                Stop
              </Button>
            </View>
          </Card.Content>
        </Card>

        {summary.length > 0 && (
          <Card elevation={1} style={styles.card}>
            <Card.Title
              title="Variant table"
              subtitle={best ? `most answers: ${best.variant}` : 'no clean run'}
            />
            <Card.Content>
              {summary.map(row => (
                <View key={row.variant} style={styles.row}>
                  <Text style={styles.rowHead}>
                    {row.variant} · answered {row.answered}/{runs} · echo{' '}
                    {row.echoed} · fail {row.failed}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {row.label} — ttft {row.medianTtftMs}ms, total{' '}
                    {row.medianTotalMs}ms, prefill {row.medianPromptMs}ms
                  </Text>
                  <Text style={styles.rowSample}>“{row.sample}”</Text>
                </View>
              ))}
            </Card.Content>
          </Card>
        )}

        <Card elevation={1} style={styles.card}>
          <Card.Title
            title="Speech bench"
            subtitle="same words, one setting at a time, no mic and no playback"
          />
          <Card.Content>
            <Text style={styles.note}>
              Runs the decoder over three fixed texts — one, two and three
              sentences — {runs} times each, once per cell. Quick takes the axes
              a phone answers in minutes (projector device, threads, streaming,
              cache isolation); Full adds batch size and flash attention. Every
              cell that changes a context parameter builds its own context, so
              the model is unloaded when the run ends. Results are written next
              to the A/B dump in {abDir}.
            </Text>
            <View style={styles.buttonRow}>
              <Button
                mode="contained"
                onPress={() => runSpeech('quick')}
                disabled={busy}
                style={styles.button}>
                {busy ? 'Running…' : 'Run quick'}
              </Button>
              <Button
                mode="outlined"
                onPress={() => runSpeech('full')}
                disabled={busy}
                style={styles.button}>
                Run full
              </Button>
            </View>
            <Button mode="outlined" onPress={runProbe} disabled={busy}>
              Next-turn cache probe
            </Button>
            <Button
              mode="outlined"
              onPress={() => {
                cancelRef.current = true;
                append('stop asked');
              }}
              disabled={!busy}
              style={styles.button}>
              Stop
            </Button>
          </Card.Content>
        </Card>

        {speechSummary.length > 0 && (
          <Card elevation={1} style={styles.card}>
            <Card.Title
              title="Speech table"
              subtitle={
                bestSpeech
                  ? `fastest: ${bestSpeech.cell} (rtf ${bestSpeech.medianRtf})`
                  : 'no clean run'
              }
            />
            <Card.Content>
              {speechSummary.map(row => (
                <View key={row.cell} style={styles.row}>
                  <Text style={styles.rowHead}>
                    {row.cell} · rtf {row.medianRtf ?? '-'} · first{' '}
                    {row.medianFirstAudioMs}ms
                  </Text>
                  <Text style={styles.rowMeta}>
                    prefill {row.medianPromptMs}ms · p95 frame{' '}
                    {row.worstP95Frame}ms · ok {row.runs - row.failed}/
                    {row.runs} · audio {row.audioSeconds}s
                  </Text>
                  <Text style={styles.rowSample}>
                    s1 {row.perLen[0].medianRtf ?? '-'} / s2{' '}
                    {row.perLen[1].medianRtf ?? '-'} / s3{' '}
                    {row.perLen[2].medianRtf ?? '-'} — first sound{' '}
                    {row.perLen.map(p => p.medianFirstAudioMs).join('/')}ms
                  </Text>
                </View>
              ))}
            </Card.Content>
          </Card>
        )}

        <Card elevation={1} style={styles.card}>
          <Card.Title
            title="Quantization run"
            subtitle="same settings, different weights — and the audio it made"
          />
          <Card.Content>
            <Text style={styles.note}>
              Voices the same three texts from every file pair you pick, on the
              engine settings this phone already uses, so the only thing that
              moves is the weights. Which quant is faster is a table; whether
              the cheaper one still sounds right is not, so one clip per pair is
              written to {`${abDir}/speech-quant`} for a laptop to play.
            </Text>
            <Button mode="outlined" onPress={listQuantFiles} disabled={busy}>
              List files on this phone
            </Button>
            {quantFiles && (
              <View style={styles.group}>
                <Text style={styles.rowHead}>Text models</Text>
                {quantFiles.texts.map(file => (
                  <Button
                    key={file.id}
                    mode={selTexts.includes(file.id) ? 'contained' : 'outlined'}
                    style={styles.button}
                    disabled={busy}
                    onPress={() => toggleIn(setSelTexts)(file.id)}>
                    {`${selTexts.includes(file.id) ? '[x]' : '[ ]'} ${
                      file.label
                    } · ${(file.bytes / 1e9).toFixed(1)} GB`}
                  </Button>
                ))}
                <Text style={styles.rowHead}>
                  Projectors — the speech decoder lives in these
                </Text>
                {quantFiles.projectors.map(file => (
                  <Button
                    key={file.id}
                    mode={
                      selProjectors.includes(file.id) ? 'contained' : 'outlined'
                    }
                    style={styles.button}
                    disabled={busy}
                    onPress={() => toggleIn(setSelProjectors)(file.id)}>
                    {`${selProjectors.includes(file.id) ? '[x]' : '[ ]'} ${
                      file.label
                    } · ${(file.bytes / 1e9).toFixed(1)} GB`}
                  </Button>
                ))}
                {quantFiles.projectors.length === 0 && (
                  <Text style={styles.note}>
                    Nothing is listed as a projector, so every model is voiced
                    by the file already paired with it.
                  </Text>
                )}
                <Button
                  mode="contained"
                  onPress={runQuant}
                  disabled={busy || selTexts.length === 0}>
                  {busy
                    ? 'Running…'
                    : `Run ${
                        selTexts.length *
                        Math.max(1, quantFiles.projectors.length)
                      } pair(s)`}
                </Button>
              </View>
            )}
          </Card.Content>
        </Card>

        {quantSummary.length > 0 && (
          <Card elevation={1} style={styles.card}>
            <Card.Title
              title="Quant table"
              subtitle="one row per file pair, on this phone's own settings"
            />
            <Card.Content>
              {quantSummary.map(row => (
                <View key={row.cell} style={styles.row}>
                  <Text style={styles.rowHead}>
                    {row.cell} · rtf {row.medianRtf ?? '-'} · first{' '}
                    {row.medianFirstAudioMs}ms
                  </Text>
                  <Text style={styles.rowMeta}>
                    prefill {row.medianPromptMs}ms · p95 frame{' '}
                    {row.worstP95Frame}ms · ok {row.runs - row.failed}/
                    {row.runs} · audio {row.audioSeconds}s
                  </Text>
                  <Text style={styles.rowSample}>
                    s1 {row.perLen[0].medianRtf ?? '-'} / s2{' '}
                    {row.perLen[1].medianRtf ?? '-'} / s3{' '}
                    {row.perLen[2].medianRtf ?? '-'} — wall{' '}
                    {row.perLen.map(p => p.medianWallMs).join('/')}ms
                  </Text>
                </View>
              ))}
            </Card.Content>
          </Card>
        )}

        <Card elevation={1} style={styles.card}>
          <Card.Title
            title="Log"
            subtitle="also on logcat, as [voice-ab] and [speech-bench]"
          />
          <Card.Content>
            <ScrollView
              ref={scrollRef}
              style={styles.log}
              onContentSizeChange={() =>
                scrollRef.current?.scrollToEnd({animated: false})
              }>
              {lines.length === 0 ? (
                <Text style={styles.logLine}>
                  Load the Omni model, speak one question in voice mode, then
                  save the clip and run.
                </Text>
              ) : (
                lines.map((line, index) => (
                  <Text
                    key={`${index}-${line.slice(0, 12)}`}
                    style={styles.logLine}>
                    {line}
                  </Text>
                ))
              )}
            </ScrollView>
            <Button
              mode="text"
              onPress={() => {
                setLines([]);
                setSummary([]);
              }}
              style={styles.button}>
              Clear
            </Button>
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    fontSize: 16,
    color: '#007AFF',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingBottom: 24,
  },
  card: {
    marginHorizontal: 12,
    marginBottom: 12,
  },
  note: {
    fontSize: 13,
    opacity: 0.8,
    marginBottom: 8,
  },
  input: {
    marginTop: 8,
  },
  button: {
    marginTop: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  group: {
    marginTop: 8,
    gap: 2,
  },
  row: {
    marginBottom: 10,
  },
  rowHead: {
    fontSize: 14,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 12,
    opacity: 0.8,
  },
  rowSample: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  log: {
    maxHeight: 360,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 6,
    padding: 8,
  },
  logLine: {
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
});

export default VoiceAbScreen;
