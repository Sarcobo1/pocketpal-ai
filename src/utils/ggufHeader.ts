/**
 * Minimal, seek-based GGUF header reader.
 *
 * Two callers need a handful of scalar metadata keys from a GGUF file: the MTP
 * probe asks whether the model carries draft layers, and the media probe asks
 * which encoders a projector carries. Neither may materialize the tokenizer
 * vocab, which is what dominates a header: values that are not wanted are
 * skipped by their length prefixes, so a 10^5-string vocab is walked with
 * integer reads only.
 *
 * The reader works over a `GGUFSource`, which is either an HTTP range source
 * (remote probing) or a local-file source (downloaded projectors). GGUF is
 * little-endian, versioned (v1 uses 32-bit lengths, v2/v3 64-bit), and frozen
 * at the container level. Any structural anomaly throws; callers decide
 * whether that means `unknown` or an actionable error.
 */

import * as RNFS from '@dr.pogodin/react-native-fs';

const GGUF_MAGIC = 0x46554747; // "GGUF" read as LE u32

const HTTP_CHUNK_SIZE = 2 * 1024 * 1024;
const HTTP_TOTAL_MAX = 64 * 1024 * 1024;

const MAX_KV_COUNT = 4096;
const MAX_TENSOR_COUNT = 65536;
const MAX_KEY_LENGTH = 4096;
const MAX_ARRAY_COUNT = 32 * 1024 * 1024;
const MAX_ARRAY_DEPTH = 4;

// GGUF metadata value types.
const enum GGUFType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

const FIXED_SIZES: Partial<Record<number, number>> = {
  [GGUFType.UINT8]: 1,
  [GGUFType.INT8]: 1,
  [GGUFType.BOOL]: 1,
  [GGUFType.UINT16]: 2,
  [GGUFType.INT16]: 2,
  [GGUFType.UINT32]: 4,
  [GGUFType.INT32]: 4,
  [GGUFType.FLOAT32]: 4,
  [GGUFType.UINT64]: 8,
  [GGUFType.INT64]: 8,
  [GGUFType.FLOAT64]: 8,
};

export type GGUFValue = string | number | boolean;

export interface GGUFHeaderScan {
  values: Record<string, GGUFValue>;
  tensorNames: string[];
}

export interface GGUFHeaderScanOptions {
  /** Scalar keys to materialize. Everything else is skipped. */
  keyFilter?: (key: string) => boolean;
  /** Tensor names to retain. Everything else is skipped. */
  tensorFilter?: (name: string) => boolean;
}

/** A random-access byte source. Reads must be little-endian raw bytes. */
export interface GGUFSource {
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface GGUFHeaderProbeResult {
  nextnPredictLayers: number;
  hasNextnTensor: boolean;
}

export interface ReadGGUFHeaderOptions {
  fetchImpl?: typeof fetch;
  chunkSize?: number;
}

/**
 * Sequential-prefix buffer over HTTP range requests. A GGUF header is read
 * front-to-back, so growing one buffer costs less than issuing one request per
 * field and keeps the byte budget explicit.
 */
export class HttpRangeSource implements GGUFSource {
  private bytes = new Uint8Array(0);
  private view = new DataView(new ArrayBuffer(0));
  private eof = false;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly chunkSize: number = HTTP_CHUNK_SIZE,
    private readonly maxBytes: number = HTTP_TOTAL_MAX,
  ) {}

  private async ensure(end: number): Promise<void> {
    if (end > this.maxBytes) {
      throw new Error(`gguf header read past ${this.maxBytes} byte budget`);
    }
    while (this.bytes.byteLength < end && !this.eof) {
      const from = this.bytes.byteLength;
      const to = from + this.chunkSize - 1;
      const res = await this.fetchImpl(this.url, {
        headers: {Range: `bytes=${from}-${to}`},
      });
      if (!res.ok) {
        throw new Error(`gguf range request failed: HTTP ${res.status}`);
      }
      const chunk = new Uint8Array(await res.arrayBuffer());
      if (chunk.byteLength === 0) {
        this.eof = true;
        break;
      }
      const grown = new Uint8Array(this.bytes.byteLength + chunk.byteLength);
      grown.set(this.bytes);
      grown.set(chunk, this.bytes.byteLength);
      this.bytes = grown;
      this.view = new DataView(grown.buffer);
      if (chunk.byteLength < this.chunkSize) {
        this.eof = true;
      }
    }
    if (this.bytes.byteLength < end) {
      throw new Error('gguf header truncated');
    }
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    await this.ensure(offset + length);
    return this.bytes.subarray(offset, offset + length);
  }

  async u32(offset: number): Promise<number> {
    await this.ensure(offset + 4);
    return this.view.getUint32(offset, true);
  }

  async u64(offset: number): Promise<number> {
    await this.ensure(offset + 8);
    const value = this.view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('gguf length exceeds safe integer range');
    }
    return Number(value);
  }

  async i64(offset: number): Promise<number> {
    await this.ensure(offset + 8);
    return Number(this.view.getBigInt64(offset, true));
  }

  async f64(offset: number): Promise<number> {
    await this.ensure(offset + 8);
    return this.view.getFloat64(offset, true);
  }

  async f32(offset: number): Promise<number> {
    await this.ensure(offset + 4);
    return this.view.getFloat32(offset, true);
  }

  /** Advancing past bytes still fetches them (sequential prefix). */
  async skip(offset: number, length: number): Promise<number> {
    await this.ensure(offset + length);
    return offset + length;
  }
}

/**
 * Local files are random-access already, so a projector header can be read
 * without pulling the whole file into JS memory. `RNFS.read` returns base64
 * when a length is supplied; Hermes has no `atob`, hence the small decoder
 * below.
 */
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE64_ALPHABET.length; i++) {
  BASE64_LOOKUP[BASE64_ALPHABET[i]] = i;
}

export const decodeBase64 = (input: string): Uint8Array => {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((clean.length * 3) / 4 - padding);
  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64_LOOKUP[clean[i]] ?? 0;
    const b = BASE64_LOOKUP[clean[i + 1]] ?? 0;
    const c = BASE64_LOOKUP[clean[i + 2]] ?? 0;
    const d = BASE64_LOOKUP[clean[i + 3]] ?? 0;
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (out < output.length) {
      output[out++] = (chunk >> 16) & 0xff;
    }
    if (out < output.length) {
      output[out++] = (chunk >> 8) & 0xff;
    }
    if (out < output.length) {
      output[out++] = chunk & 0xff;
    }
  }
  return output;
};

export type LocalReadImpl = (
  path: string,
  length: number,
  position: number,
  encoding: 'base64',
) => Promise<string>;

const readLocalBase64: LocalReadImpl = (path, length, position, encoding) =>
  RNFS.read(path, length, position, encoding);

export const localFileSource = (
  path: string,
  readImpl: LocalReadImpl = readLocalBase64,
): GGUFSource => ({
  read: async (offset, length) =>
    decodeBase64(await readImpl(path, length, offset, 'base64')),
});

/** Strict-enough UTF-8 for GGUF keys and tensor names (short, ASCII-dominated). */
const decodeUtf8 = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 < 0xe0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b0 < 0xf0) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) |
          ((bytes[i + 1] & 0x3f) << 6) |
          (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return out;
};

const readU32 = (source: GGUFSource, offset: number): Promise<number> =>
  source instanceof HttpRangeSource
    ? source.u32(offset)
    : source.read(offset, 4).then(bytes => {
        return (
          (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>>
          0
        );
      });

const readU64 = (source: GGUFSource, offset: number): Promise<number> =>
  source instanceof HttpRangeSource
    ? source.u64(offset)
    : source.read(offset, 8).then(bytes => {
        let value = 0n;
        for (let i = 7; i >= 0; i--) {
          value = (value << 8n) | BigInt(bytes[i]);
        }
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('gguf length exceeds safe integer range');
        }
        return Number(value);
      });

const readI64 = (source: GGUFSource, offset: number): Promise<number> =>
  source instanceof HttpRangeSource
    ? source.i64(offset)
    : source.read(offset, 8).then(bytes => {
        let value = 0n;
        for (let i = 7; i >= 0; i--) {
          value = (value << 8n) | BigInt(bytes[i]);
        }
        return Number(BigInt.asIntN(64, value));
      });

const readF32 = (source: GGUFSource, offset: number): Promise<number> =>
  source instanceof HttpRangeSource
    ? source.f32(offset)
    : source.read(offset, 4).then(bytes => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
        return view.getFloat32(0, true);
      });

const readF64 = (source: GGUFSource, offset: number): Promise<number> =>
  source instanceof HttpRangeSource
    ? source.f64(offset)
    : source.read(offset, 8).then(bytes => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
        return view.getFloat64(0, true);
      });

const readU16 = (source: GGUFSource, offset: number): Promise<number> =>
  source.read(offset, 2).then(bytes => bytes[0] | (bytes[1] << 8));

const readNumber = async (
  source: GGUFSource,
  type: number,
  at: number,
): Promise<[number, number]> => {
  switch (type) {
    case GGUFType.UINT8:
      return [(await source.read(at, 1))[0], at + 1];
    case GGUFType.INT8:
      return [((await source.read(at, 1))[0] << 24) >> 24, at + 1];
    case GGUFType.BOOL:
      return [(await source.read(at, 1))[0] ? 1 : 0, at + 1];
    case GGUFType.UINT16:
    case GGUFType.INT16: {
      const val = await readU16(source, at);
      return [type === GGUFType.INT16 ? (val << 16) >> 16 : val, at + 2];
    }
    case GGUFType.UINT32:
      return [await readU32(source, at), at + 4];
    case GGUFType.INT32: {
      const raw = await readU32(source, at);
      return [raw | 0, at + 4];
    }
    case GGUFType.FLOAT32:
      return [await readF32(source, at), at + 4];
    case GGUFType.UINT64:
      return [await readU64(source, at), at + 8];
    case GGUFType.INT64:
      return [await readI64(source, at), at + 8];
    case GGUFType.FLOAT64:
      return [await readF64(source, at), at + 8];
    default:
      throw new Error(`gguf value type ${type} is not numeric`);
  }
};

const readScalar = async (
  source: GGUFSource,
  version: number,
  type: number,
  at: number,
): Promise<[GGUFValue, number]> => {
  if (type === GGUFType.STRING) {
    const lengthAt = at;
    const [length, afterLength] = await readLength(source, lengthAt, version);
    const bytes = await source.read(afterLength, length);
    return [decodeUtf8(bytes), afterLength + length];
  }
  if (type === GGUFType.BOOL) {
    return [(await source.read(at, 1))[0] ? true : false, at + 1];
  }
  return readNumber(source, type, at);
};

// v1 uses 32-bit lengths/counts; v2/v3 use 64-bit.
const readLength = async (
  source: GGUFSource,
  offset: number,
  version: number,
): Promise<[number, number]> =>
  version === 1
    ? [await readU32(source, offset), offset + 4]
    : [await readU64(source, offset), offset + 8];

const skipValue = async (
  source: GGUFSource,
  version: number,
  type: number,
  at: number,
  depth: number,
): Promise<number> => {
  const fixed = FIXED_SIZES[type];
  if (fixed !== undefined) {
    return at + fixed;
  }
  if (type === GGUFType.STRING) {
    const [length, afterLength] = await readLength(source, at, version);
    return afterLength + length;
  }
  if (type === GGUFType.ARRAY) {
    if (depth >= MAX_ARRAY_DEPTH) {
      throw new Error('gguf array nesting too deep');
    }
    const elemType = await readU32(source, at);
    const [count, next] = await readLength(source, at + 4, version);
    if (count > MAX_ARRAY_COUNT) {
      throw new Error('gguf array count out of range');
    }
    const elemFixed = FIXED_SIZES[elemType];
    if (elemFixed !== undefined) {
      return next + count * elemFixed;
    }
    let cursor = next;
    for (let i = 0; i < count; i++) {
      cursor = await skipValue(source, version, elemType, cursor, depth + 1);
    }
    return cursor;
  }
  throw new Error(`unknown gguf value type ${type}`);
};

/**
 * Walk the header once, keep the requested scalar keys and tensor names, and
 * skip everything else. Arrays are deliberately never materialized: none of
 * the supported capability keys is an array, and the tokenizer vocab is the
 * reason this reader exists.
 */
export const scanGGUFHeader = async (
  source: GGUFSource,
  options: GGUFHeaderScanOptions = {},
): Promise<GGUFHeaderScan> => {
  if ((await readU32(source, 0)) !== GGUF_MAGIC) {
    throw new Error('not a GGUF file (bad magic)');
  }
  const version = await readU32(source, 4);
  if (version < 1 || version > 3) {
    throw new Error(`unsupported gguf version ${version}`);
  }

  let offset = 8;
  let tensorCount: number;
  let kvCount: number;
  [tensorCount, offset] = await readLength(source, offset, version);
  [kvCount, offset] = await readLength(source, offset, version);
  if (kvCount > MAX_KV_COUNT || tensorCount > MAX_TENSOR_COUNT) {
    throw new Error('gguf header counts out of range');
  }

  const values: Record<string, GGUFValue> = {};
  const tensorNames: string[] = [];
  const wantsKey = options.keyFilter ?? (() => false);
  const wantsTensor = options.tensorFilter ?? (() => false);

  for (let i = 0; i < kvCount; i++) {
    const [keyLen, afterLen] = await readLength(source, offset, version);
    if (keyLen > MAX_KEY_LENGTH) {
      throw new Error('gguf key length out of range');
    }
    const key = decodeUtf8(await source.read(afterLen, keyLen));
    const typeAt = afterLen + keyLen;
    const valueType = await readU32(source, typeAt);
    const valueAt = typeAt + 4;

    if (wantsKey(key) && valueType !== GGUFType.ARRAY) {
      const [value, next] = await readScalar(
        source,
        version,
        valueType,
        valueAt,
      );
      values[key] = value;
      offset = next;
    } else {
      offset = await skipValue(source, version, valueType, valueAt, 0);
    }
  }

  for (let i = 0; i < tensorCount; i++) {
    const [nameLen, afterLen] = await readLength(source, offset, version);
    if (nameLen > MAX_KEY_LENGTH) {
      throw new Error('gguf tensor name length out of range');
    }
    const name = decodeUtf8(await source.read(afterLen, nameLen));
    if (wantsTensor(name)) {
      tensorNames.push(name);
    }
    let at = afterLen + nameLen;
    const nDims = await readU32(source, at);
    if (nDims > 8) {
      throw new Error('gguf tensor rank out of range');
    }
    at += 4;
    at += nDims * (version === 1 ? 4 : 8);
    at += 4; // dtype
    at += 8; // data offset
    offset = at;
  }

  return {values, tensorNames};
};

const NEXTN_KV_SUFFIX = '.nextn_predict_layers';
const NEXTN_TENSOR = /(^|\.)nextn\./;

export const readGGUFHeaderForMTP = async (
  url: string,
  options?: ReadGGUFHeaderOptions,
): Promise<GGUFHeaderProbeResult> => {
  const scan = await scanGGUFHeader(
    new HttpRangeSource(
      url,
      options?.fetchImpl ?? fetch,
      options?.chunkSize ?? HTTP_CHUNK_SIZE,
    ),
    {
      keyFilter: key => key.endsWith(NEXTN_KV_SUFFIX),
      tensorFilter: name => NEXTN_TENSOR.test(name),
    },
  );

  let nextnPredictLayers = 0;
  for (const [key, value] of Object.entries(scan.values)) {
    if (
      key.endsWith(NEXTN_KV_SUFFIX) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0
    ) {
      nextnPredictLayers = value;
      break;
    }
  }

  return {
    nextnPredictLayers,
    hasNextnTensor: scan.tensorNames.length > 0,
  };
};
