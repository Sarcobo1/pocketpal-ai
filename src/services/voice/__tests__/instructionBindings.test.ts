import * as fs from 'fs';
import * as path from 'path';

/**
 * The line that used to stand beside a voice clip is no longer sent anywhere.
 *
 * It survives in the codebase for one job only: recognising a reply that says it
 * back, in `src/utils/chat.ts`, so the turn can be refused and an older history
 * can be kept out of the next prompt. A prompt builder that imports it would
 * quietly put the instruction in front of the model again — and the model has
 * already shown what it does with a weak clip and that sentence: it quotes it
 * back as the user's own words.
 *
 * This is a source-level gate rather than a prompt assertion, because the paths
 * that build a voice turn are several (live, retry, A/B bench) and the one that
 * would regress is the one nobody thought to test. The runtime half is covered
 * by the spoken-turn tests in `useChatSession` and `abBench`.
 */

const SRC = path.resolve(__dirname, '../../..');
const GUARD = path.join(SRC, 'utils/chat.ts');
const DECLARATION = path.join(SRC, 'services/voice/constants.ts');
/** The distinctive halves, in case a builder inlines the line instead of importing it. */
const INLINE_INSTRUCTION =
  /the\s+user\s+spoke\s+the\s+attached\s+audio|do\s+not\s+repeat\s+or\s+transcribe/i;

const collectSourceFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') {
        continue;
      }
      files.push(...collectSourceFiles(full));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.includes('.test.')
    ) {
      files.push(full);
    }
  }
  return files;
};

const sourceFiles = collectSourceFiles(SRC);

describe('voice instruction bindings', () => {
  it('walks a meaningful slice of the source (sanity check)', () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it('only the history guard binds the beside-clip instruction', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      if (file === GUARD || file === DECLARATION) {
        continue;
      }
      const code = fs.readFileSync(file, 'utf8');
      if (
        /\bVOICE_AUDIO_INSTRUCTION\b/.test(code) ||
        INLINE_INSTRUCTION.test(code)
      ) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no prompt builder or voice engine imports it', () => {
    const promptPaths = [
      'hooks/useChatSession.ts',
      'services/voice/abBench.ts',
      'services/voice/omniEngine.ts',
      'services/voice/cascadeEngine.ts',
      'services/voice/speechBench.ts',
      'utils/chat.ts',
    ];
    for (const relative of promptPaths) {
      const code = fs.readFileSync(path.join(SRC, relative), 'utf8');
      const importsIt = new RegExp(
        `import\\s*\\{[^}]*\\bVOICE_AUDIO_INSTRUCTION\\b[^}]*\\}`,
      ).test(code);
      expect({relative, importsIt}).toEqual({
        relative,
        // The guard is the one place it may be imported, and only to build the
        // recogniser that keeps it out of history.
        importsIt: relative === 'utils/chat.ts',
      });
    }
  });
});
