import React, {useContext, useEffect, useState} from 'react';
import {Text, View} from 'react-native';

import {useTheme} from '../../hooks';
import {L10nContext} from '../../utils';
import {t} from '../../locales';
import {LimiOrb, type LimiOrbState} from '../LimiOrb';

import {styles, createCountStyle} from './styles';

// Suppress the count for trivial in-progress calls so simple talents
// don't trade a dot-row for "1 tokens" the moment they start. The
// threshold is small enough that the user sees the count appear
// within the first few tokens of any non-trivial tool call.
const MIN_TOKENS = 10;

// Map talent name → l10n key under `components.pendingIndicator`.
// Keeping the mapping local to the renderer avoids leaking React-
// context-bound l10n into the service layer. New talents that want
// a label add an entry here; otherwise they fall back to the
// generic "Preparing tool".
const TALENT_LABEL_KEYS: Record<
  string,
  'buildingPage' | 'calculating' | 'lookingUpTime'
> = {
  render_html: 'buildingPage',
  calculate: 'calculating',
  datetime: 'lookingUpTime',
};

interface PendingIndicatorProps {
  /**
   * Names of tool calls the model is currently generating. The first
   * name (if any) drives the friendly label ("Building page", etc.).
   * Empty / undefined → no label, plain dot-row.
   */
  pendingTalentNames?: string[];
  /**
   * Number of token events received during the current tool-call
   * generation. Surfaced once it crosses {@link MIN_TOKENS}.
   */
  toolCallTokenCount?: number;
  /** Shows "Stopping…" in place of any label. */
  isStopping?: boolean;
}

/**
 * Three-dot pending indicator rendered below the latest turn during
 * prefill / tool-call generation / tool execution. Pure decoration —
 * visibility is gated by the caller.
 *
 * For long tool calls, when `pendingTalentNames` is non-empty the
 * indicator also renders a friendly per-talent label, the running
 * token count, and elapsed seconds so the user can tell the model is
 * still working rather than hung.
 */
export const PendingIndicator: React.FC<PendingIndicatorProps> = ({
  pendingTalentNames,
  toolCallTokenCount = 0,
  isStopping = false,
}) => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const countStyle = createCountStyle(theme).count;

  const firstTalent = pendingTalentNames?.[0];
  const inToolCallMode = !!firstTalent;

  // Elapsed seconds tracker. Starts when we enter tool-call mode,
  // resets when we leave. Uses a 1-second interval — coarse enough
  // not to thrash the UI, fine enough to reassure "still going".
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!inToolCallMode) {
      setElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [inToolCallMode]);

  // Build the label suffix.
  // - In `stopping` mode we override everything with "Stopping…" so
  //   the user knows their tap registered while we wait for native
  //   to wind down at the next chunk boundary.
  // - Otherwise it reads "Building page · 120 tokens · 4s" once the
  //   thresholds are crossed (see MIN_TOKENS / elapsed >= 1).
  let suffix: string | null = null;
  if (isStopping) {
    suffix = l10n.components.pendingIndicator.stopping;
  } else if (inToolCallMode) {
    const labelKey = firstTalent ? TALENT_LABEL_KEYS[firstTalent] : undefined;
    const label = labelKey
      ? l10n.components.pendingIndicator[labelKey]
      : l10n.components.pendingIndicator.preparingTool;
    const parts: string[] = [label];
    if (toolCallTokenCount >= MIN_TOKENS) {
      parts.push(
        t(l10n.components.toolMetrics.tokens, {
          count: toolCallTokenCount.toLocaleString(),
        }),
      );
    }
    if (elapsedSec >= 1) {
      parts.push(t(l10n.components.toolMetrics.elapsed, {seconds: elapsedSec}));
    }
    suffix = parts.join(' · ');
  }

  let orbState: LimiOrbState = 'composing';
  let defaultLabel = 'O‘ylayapman…';
  if (firstTalent === 'calculate') {
    orbState = 'solving';
    defaultLabel = 'Yechyapman…';
  } else if (firstTalent?.includes('search')) {
    orbState = 'searching';
    defaultLabel = 'Qidiryapman…';
  } else if (inToolCallMode) {
    orbState = 'working';
    defaultLabel = 'Ishlayapman…';
  }

  return (
    <View style={styles.container} testID="pending-indicator">
      <LimiOrb state={orbState} size={20} />
      <Text
        style={[countStyle, {marginLeft: 8}]}
        testID="pending-indicator-suffix">
        {suffix !== null ? suffix : defaultLabel}
      </Text>
    </View>
  );
};
