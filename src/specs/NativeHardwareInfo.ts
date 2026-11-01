import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface CPUProcessor {
  processor?: string;
  'model name'?: string;
  'cpu MHz'?: string;
  vendor_id?: string;
}

export interface CPUInfo {
  cores: number;
  processors?: CPUProcessor[];
  features?: string[];
  hasFp16?: boolean;
  hasDotProd?: boolean;
  hasSve?: boolean;
  hasI8mm?: boolean;
  socModel?: string;
  hardware?: string;
  maxFreqMhz?: number;
}

export interface GPUInfo {
  renderer: string;
  vendor: string;
  version: string;
  hasAdreno: boolean;
  hasMali: boolean;
  hasPowerVR: boolean;
  supportsOpenCL: boolean;
  gpuType: string;
}

/**
 * System memory and backing-store state, as the kernel reports it.
 * All sizes are bytes.
 */
export interface MemoryStats {
  /** MemTotal — installed physical RAM. */
  totalBytes: number;
  /** MemAvailable — RAM the kernel can give us now, reclaimable pages included. */
  availableBytes: number;
  /** SwapTotal — virtual RAM sized by the system (zram / "RAM Plus" / a swap file). 0 when none. */
  swapTotalBytes: number;
  /** SwapFree — the part of it not already taken. */
  swapFreeBytes: number;
  /** Backing-store kinds behind SwapTotal: 'zram', 'file', 'partition'. Empty when unreadable. */
  swapKinds: string[];
}

export interface Spec extends TurboModule {
  getCPUInfo(): Promise<CPUInfo>;
  getGPUInfo(): Promise<GPUInfo>;
  getChipset?(): Promise<string>; // Android only
  /**
   * Get available memory in bytes from the operating system.
   * - Android: Uses ActivityManager.getMemoryInfo() to get availMem
   * - iOS: Uses os_proc_available_memory()
   * @returns Promise<number> Available memory in bytes
   */
  getAvailableMemory(): Promise<number>;
  /**
   * Read memory and swap counters in one native round-trip.
   * - Android: /proc/meminfo plus the device list from /proc/swaps
   * - iOS: physical RAM and os_proc_available_memory(); swap is always 0
   *   because the app has no addressable backing store.
   */
  getMemoryStats(): Promise<MemoryStats>;
  /**
   * Collect memory metrics and write a snapshot entry to disk.
   * Appends to Documents/memory-snapshots.json (iOS) or externalFilesDir/memory-snapshots.json (Android).
   */
  writeMemorySnapshot(label: string): Promise<{label: string; status: string}>;
  /**
   * Hint the native allocator to release fully-free pages back to the
   * kernel. Best-effort: resolves with `purged: false` on platforms
   * without an underlying mechanism (iOS, Android < API 28).
   * `rss_kb_before`/`after` are sampled from /proc/self/status so
   * callers can record actual reclaim per call.
   */
  purgeNativeAllocator(): Promise<{
    purged: boolean;
    rss_kb_before: number;
    rss_kb_after: number;
  }>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('HardwareInfo');
