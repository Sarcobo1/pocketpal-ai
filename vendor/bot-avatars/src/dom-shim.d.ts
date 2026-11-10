/**
 * DOM ambient types for the vendored `bot-avatars` web package.
 *
 * `bot-avatars` is a canvas-2D library written for the browser. The React
 * Native port (`bot-avatars-native`) imports only its *rig* (engine, presets,
 * shapes, colour maths, plastic bakes) — none of the canvas drawing — but the
 * package's own source still names `Path2D`, `ImageData`, `document`,
 * `CanvasRenderingContext2D` and friends.
 *
 * The app's tsconfig deliberately does not pull in `lib: ["DOM"]`: this is a
 * React Native app, and opening DOM globals to app code would let `document`
 * typecheck where it cannot run. These declarations give the vendored source
 * exactly the names it mentions and nothing more.
 *
 * Nothing here is implemented — it is a type-only shim. At runtime the port
 * never touches these paths: `plastic.ts` guards every canvas access behind
 * `typeof document !== 'undefined'` / `typeof OffscreenCanvas !== 'undefined'`,
 * and `draw.ts` / `mesh.ts` are only reached from the browser component, which
 * this app does not mount.
 */

declare global {
  interface DOMMatrix2DInit {
    a?: number;
    b?: number;
    c?: number;
    d?: number;
    e?: number;
    f?: number;
  }

  interface Path2D {
    addPath(path: Path2D, transform?: DOMMatrix2DInit): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number,
      counterclockwise?: boolean,
    ): void;
    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
    bezierCurveTo(
      cp1x: number,
      cp1y: number,
      cp2x: number,
      cp2y: number,
      x: number,
      y: number,
    ): void;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
    ellipse(
      x: number,
      y: number,
      radiusX: number,
      radiusY: number,
      rotation: number,
      startAngle: number,
      endAngle: number,
      counterclockwise?: boolean,
    ): void;
    rect(x: number, y: number, w: number, h: number): void;
    closePath(): void;
  }
  // eslint-disable-next-line no-redeclare
  var Path2D: {
    new (d?: string | Path2D): Path2D;
  };

  interface ImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
  }
  // eslint-disable-next-line no-redeclare
  var ImageData: {
    new (width: number, height: number): ImageData;
    new (data: Uint8ClampedArray, width: number, height?: number): ImageData;
  };

  interface CanvasGradient {
    addColorStop(offset: number, color: string): void;
  }

  interface CanvasPattern {
    setTransform?(m: DOMMatrix): void;
  }

  interface CanvasRenderingContext2D {
    canvas: HTMLCanvasElement;
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    globalAlpha: number;
    globalCompositeOperation: string;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: string;
    lineWidth: number;
    lineCap: string;
    lineJoin: string;
    miterLimit: number;
    lineDashOffset: number;
    filter: string;
    font: string;
    textAlign: string;
    textBaseline: string;
    shadowBlur: number;
    shadowColor: string;
    shadowOffsetX: number;
    shadowOffsetY: number;
    save(): void;
    restore(): void;
    beginPath(): void;
    closePath(): void;
    fill(path?: Path2D): void;
    stroke(path?: Path2D): void;
    clip(path?: Path2D): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number,
      counterclockwise?: boolean,
    ): void;
    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
    bezierCurveTo(
      cp1x: number,
      cp1y: number,
      cp2x: number,
      cp2y: number,
      x: number,
      y: number,
    ): void;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
    ellipse(
      x: number,
      y: number,
      radiusX: number,
      radiusY: number,
      rotation: number,
      startAngle: number,
      endAngle: number,
      counterclockwise?: boolean,
    ): void;
    rect(x: number, y: number, w: number, h: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    strokeRect(x: number, y: number, w: number, h: number): void;
    clearRect(x: number, y: number, w: number, h: number): void;
    translate(x: number, y: number): void;
    scale(x: number, y: number): void;
    rotate(angle: number): void;
    transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    setTransform(m: DOMMatrix2DInit): void;
    resetTransform(): void;
    getTransform(): {a: number; b: number; c: number; d: number; e: number; f: number};
    setLineDash(segments: number[]): void;
    getLineDash(): number[];
    drawImage(image: unknown, dx: number, dy: number, dw?: number, dh?: number): void;
    drawImage(
      image: unknown,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw?: number,
      dh?: number,
    ): void;
    putImageData(data: ImageData, dx: number, dy: number): void;
    getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
    createImageData(w: number, h: number): ImageData;
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
    createRadialGradient(
      x0: number,
      y0: number,
      r0: number,
      x1: number,
      y1: number,
      r1: number,
    ): CanvasGradient;
    createConicGradient(startAngle: number, x: number, y: number): CanvasGradient;
    createPattern(image: unknown, repetition: string | null): CanvasPattern | null;
    measureText(text: string): {width: number};
    fillText(text: string, x: number, y: number): void;
    strokeText(text: string, x: number, y: number): void;
  }

  interface HTMLCanvasElement {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
    getContext(contextId: '2d', options?: {willReadFrequently?: boolean}): CanvasRenderingContext2D | null;
  }

  interface OffscreenCanvas {
    width: number;
    height: number;
    getContext(contextId: '2d', options?: {willReadFrequently?: boolean}): CanvasRenderingContext2D | null;
  }
  // eslint-disable-next-line no-redeclare
  var OffscreenCanvas: {
    new (width: number, height: number): OffscreenCanvas;
  };

  /**
   * `plastic.ts` reaches for a canvas through `document.createElement`. The
   * whole call site is behind `typeof document !== 'undefined'`, so this only
   * needs to typecheck, never to exist.
   */
  interface DOMMatrix {
    scale(s: number): DOMMatrix;
  }
  // eslint-disable-next-line no-redeclare
  var DOMMatrix: {
    new (): DOMMatrix;
  };

  var window: {
    addEventListener(type: string, cb: (...args: any[]) => void, opts?: unknown): void;
    removeEventListener(type: string, cb: (...args: any[]) => void): void;
  };

  var document: {
    createElement(tag: 'canvas'): HTMLCanvasElement;
    hidden: boolean;
    addEventListener(type: string, cb: (...args: any[]) => void, opts?: unknown): void;
    removeEventListener(type: string, cb: (...args: any[]) => void): void;
  };
}

export {};
