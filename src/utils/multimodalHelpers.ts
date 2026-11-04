/**
 * Helper functions for multimodal support
 */

import {extractModelPrecision, getQuantRank} from '.';
import {HuggingFaceModel, ModelFile} from './types';
import {MMProjRegex} from './multimodalPatterns';

/**
 * Checks if a repository contains vision models based on the presence of mmproj files
 * @param siblings Array of model files in the repository
 * @returns boolean indicating if the repository contains vision models
 */
export function isVisionRepo(siblings: ModelFile[]): boolean {
  return siblings.some(f => MMProjRegex.test(f.rfilename));
}

/**
 * Gets the mmproj files from a repository
 * @param siblings Array of model files in the repository
 * @returns Array of mmproj filenames
 */
export function getMmprojFiles(siblings: ModelFile[]): ModelFile[] {
  return siblings.filter(f => MMProjRegex.test(f.rfilename));
}

/**
 * Gets the LLM files (non-mmproj files) from a repository
 * @param siblings Array of model files in the repository
 * @returns Array of LLM model files
 */
export function getLLMFiles(siblings: ModelFile[]): ModelFile[] {
  return siblings.filter(f => !MMProjRegex.test(f.rfilename));
}

/**
 * Checks if a model file is a projection model
 * @param filename Model filename
 * @returns boolean indicating if the model is a projection model
 */
export function isProjectionModel(filename: string): boolean {
  return MMProjRegex.test(filename);
}

/**
 * The projector this build wants to run with a model: Q8_0 first, F16 second,
 * then the best remaining quant. Projector quality matters more than matching
 * the LLM's own quant — an mmproj is a small encoder, and a Q8_0 one produces
 * better frames than the Q4 file that happens to share the LLM's tag.
 */
export function preferredProjectorModel(
  availableProjModels: string[],
): string | undefined {
  if (availableProjModels.length === 0) {
    return undefined;
  }
  const tier = (filename: string): number => {
    const precision = extractModelPrecision(filename);
    if (precision === 'q8') {
      return 2;
    }
    if (precision === 'f16') {
      return 1;
    }
    return 0;
  };
  return [...availableProjModels].sort((a, b) => {
    const byTier = tier(b) - tier(a);
    if (byTier !== 0) {
      return byTier;
    }
    return (
      getQuantRank(extractModelPrecision(b) ?? '') -
      getQuantRank(extractModelPrecision(a) ?? '')
    );
  })[0];
}

/**
 * Gets the recommended projection model for a vision model.
 *
 * The LLM filename is retained for callers that pass it, but it no longer picks
 * the projector: the preference is capability-based (Q8_0 > F16 > others), not
 * a quant-string match.
 *
 * @param _visionModelFilename Vision model filename (kept for API stability)
 * @param availableProjModels Array of available projection model filenames
 * @returns The recommended projection model filename or undefined if none found
 */
export function getRecommendedProjectionModel(
  _visionModelFilename: string,
  availableProjModels: string[],
): string | undefined {
  return preferredProjectorModel(availableProjModels);
}

/** Name parts that say nothing about which model a file belongs to. */
const IDENTITY_STOP_TOKENS = new Set([
  'mmproj',
  'proj',
  'projection',
  'model',
  'gguf',
  'fp',
]);

/** The filename without its quant tag, so quants never compare as identity. */
const stripQuant = (filename: string): string => {
  const quant = extractModelPrecision(filename);
  if (!quant) {
    return filename;
  }
  const at = filename.toLowerCase().indexOf(quant.toLowerCase());
  return at === -1
    ? filename
    : `${filename.slice(0, at)}-${filename.slice(at + quant.length)}`;
};

const identityTokens = (filename: string): string[] =>
  stripQuant(filename)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      token =>
        token.length > 1 &&
        /[a-z]/.test(token) &&
        !IDENTITY_STOP_TOKENS.has(token),
    );

/**
 * How many family tokens a model name and a projector name share. Zero means
 * the names describe different models, which is the one pairing mistake that
 * loads a foreign encoder into a context.
 */
export function familyTokenMatch(
  modelFilename: string,
  projectorFilename: string,
): number {
  const tokens = new Set(identityTokens(modelFilename));
  return identityTokens(projectorFilename).filter(token => tokens.has(token))
    .length;
}

/**
 * Picks the projectors in a local model folder that plausibly belong to this
 * model.
 *
 * Imported models share one folder on the phone, so "any mmproj nearby" would
 * happily pair a Qwen projector with an LFM3 model. A folder holding a single
 * GGUF is unambiguous; otherwise the names have to share a family token
 * (LFM3-Omni-2B in `mmproj-LFM3-Omni-2B-Q8_0.gguf`), and the strongest
 * agreement wins — a projector matching nothing stays unpaired rather than
 * loading the wrong encoder into a context.
 */
export function projectorsForLocalModel(
  modelFilename: string,
  folderFilenames: string[],
): string[] {
  const ggufs = folderFilenames.filter(name =>
    name.toLowerCase().endsWith('.gguf'),
  );
  const projectors = ggufs.filter(isProjectionModel);
  if (projectors.length === 0) {
    return [];
  }
  if (ggufs.length - projectors.length <= 1) {
    return projectors;
  }

  const names: string[] = [];
  let best = 0;
  for (const projector of projectors) {
    const hits = familyTokenMatch(modelFilename, projector);
    if (hits > best) {
      best = hits;
      names.length = 0;
      names.push(projector);
    } else if (hits === best && hits > 0) {
      names.push(projector);
    }
  }
  return names;
}

/**
 * Why the running model has no projector attached, and the single move that
 * puts it back. A media turn that degrades to text is otherwise silent, and
 * "multimodal is not enabled" is not something a user can act on.
 */
export type ProjectionGap =
  | {kind: 'none'}
  /** The library knows this file; the phone does not hold it. */
  | {kind: 'download'; filename: string}
  /** A model that arrived as a file, whose folder holds no projector. */
  | {kind: 'folder'}
  /** The file is there and the engine refused it. */
  | {kind: 'attach'; filename: string}
  /** The file is there, but loading it beside the running model is hopeless. */
  | {kind: 'noRam'; filename: string};

/** The four chat strings the gap can be answered with. */
interface ProjectionGapCopy {
  chat: {
    multimodalNeedsProjection: string;
    multimodalNeedsProjectorFolder: string;
    multimodalProjectionRejected: string;
    multimodalProjectionTooBig: string;
  };
}

/**
 * The sentence for a gap, or undefined for `none` — which is also the honest
 * answer about a model that cannot see at all, so the caller keeps its generic
 * warning instead of inventing a missing file.
 */
export function projectionGapCopy(
  gap: ProjectionGap,
  l10n: ProjectionGapCopy,
): string | undefined {
  switch (gap.kind) {
    case 'download':
      return l10n.chat.multimodalNeedsProjection.replace(
        '{{file}}',
        gap.filename,
      );
    case 'folder':
      return l10n.chat.multimodalNeedsProjectorFolder;
    case 'attach':
      return l10n.chat.multimodalProjectionRejected.replace(
        '{{file}}',
        gap.filename,
      );
    case 'noRam':
      return l10n.chat.multimodalProjectionTooBig.replace(
        '{{file}}',
        gap.filename,
      );
    default:
      return undefined;
  }
}

/**
 * Filters out projection models from a list of models for display purposes
 * @param models Array of models to filter
 * @returns Array of models with projection models removed
 */
export function filterProjectionModels<T extends {modelType?: string}>(
  models: T[],
): T[] {
  return models.filter(model => model.modelType !== 'projection');
}

/**
 * Gets size breakdown for a vision model using HF siblings data
 * This is used in HF search context where projection models aren't in modelStore yet
 * @param modelFile The LLM model file
 * @param hfModel The HF model containing siblings
 * @returns Object with llmSize, projectionSize, and totalSize
 */
export function getVisionModelSizeBreakdown(
  modelFile: ModelFile,
  hfModel: HuggingFaceModel,
): {
  llmSize: number;
  projectionSize: number;
  totalSize: number;
  hasProjection: boolean;
} {
  const llmSize = modelFile.size || 0;
  let projectionSize = 0;
  let hasProjection = false;

  // Find the default projection model from siblings
  const mmprojFiles = getMmprojFiles(hfModel.siblings || []);
  if (mmprojFiles.length > 0) {
    // Get the recommended projection model
    const recommendedProj = getRecommendedProjectionModel(
      modelFile.rfilename,
      mmprojFiles.map(f => f.rfilename),
    );

    if (recommendedProj) {
      const projFile = mmprojFiles.find(f => f.rfilename === recommendedProj);
      if (projFile && projFile.size) {
        projectionSize = projFile.size;
        hasProjection = true;
      }
    }
  }

  return {
    llmSize,
    projectionSize,
    totalSize: llmSize + projectionSize,
    hasProjection,
  };
}

/** One file of a pair, as the bar reads it. */
export type DownloadPart = {
  bytes: number;
  done: boolean;
  progress: number;
};

/**
 * Percent of a two-file download that has arrived, weighted by bytes.
 *
 * An Omni model is two files and one wait: the bar a card draws from the LLM
 * alone reaches 100% while the projector that makes it hear is still coming,
 * and the user reads that as finished. Weighting by bytes is what makes the
 * two halves line up — the projector is a tenth of the pair, so it should take
 * about a tenth of the bar.
 */
export function pairedDownloadProgress(parts: DownloadPart[]): number {
  const wanted = parts.filter(part => part.bytes > 0);
  const total = wanted.reduce((sum, part) => sum + part.bytes, 0);
  if (!total) {
    return 0;
  }
  const arrived = wanted.reduce((sum, part) => {
    const fraction = part.done
      ? 1
      : Math.min(Math.max(part.progress / 100, 0), 1);
    return sum + part.bytes * fraction;
  }, 0);
  return Math.min(100, Math.round((arrived / total) * 100));
}
