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
  runAbBench,
  saveNewestClip,
} from '../../../../services/voice/abBench';
import type {AbSummaryRow} from '../../../../services/voice/abBench';
import {voiceAudioDir} from '../../../../services/voice/wav';

/**
 * The screen that runs the spoken-turn A/B: one recorded clip, four prompt
 * shapes, five runs each, on the model that is loaded right now.
 *
 * Everything the bench prints goes to the console as well, so the same numbers
 * can be read out of `logcat` after the fact — this list is only so a run can
 * be judged without a cable attached.
 */

const MAX_LOG_LINES = 400;

const VoiceAbScreen = () => {
  const navigation = useNavigation();
  const [clipName, setClipName] = useState('');
  const [expectText, setExpectText] = useState('');
  const [runs, setRuns] = useState('5');
  const [lines, setLines] = useState<string[]>([]);
  const [summary, setSummary] = useState<AbSummaryRow[]>([]);
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

  const best = useMemo(() => {
    const clean = summary
      .filter(row => row.failed === 0)
      .sort(
        (a, b) => b.answered - a.answered || a.medianTotalMs - b.medianTotalMs,
      );
    return clean[0];
  }, [summary]);

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
          <Card.Title title="Log" subtitle="also on logcat as [voice-ab]" />
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
