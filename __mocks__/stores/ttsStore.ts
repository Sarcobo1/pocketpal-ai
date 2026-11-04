import {makeAutoObservable, observable, runInAction} from 'mobx';

import {VOICE_ENDPOINT_HANG_MS} from '../../src/services/voice/constants';

type DownloadState = 'not_installed' | 'downloading' | 'ready' | 'error';

class MockTTSStore {
  // Mirror the real store shape: `isTTSAvailable` is derived from
  // `deviceMeetsMemory` and `userTTSOverride`. Tests should mutate the inputs.
  deviceMeetsMemory = false;
  userTTSOverride: boolean | null = null;
  get isTTSAvailable(): boolean {
    if (this.userTTSOverride === true) {
      return true;
    }
    if (this.userTTSOverride === false) {
      return false;
    }
    return this.deviceMeetsMemory;
  }
  playbackState:
    | {mode: 'idle'}
    | {mode: 'streaming'; messageId: string}
    | {mode: 'playing'; messageId: string} = {mode: 'idle'};
  autoSpeakEnabled = false;
  voiceOutputActive = false;
  voiceSpeechStarted: string | null = null;
  voiceStreamFailed: string | null = null;
  speechReason: string | null = null;
  get streamsReplies(): boolean {
    return (
      this.voiceOutputActive || (this.isTTSAvailable && this.autoSpeakEnabled)
    );
  }
  currentVoice: any = null;
  // Mirrors the real store: the sink is installed by a voice session whose
  // model can voice its own replies, and `usesModelVoice` is what consumers
  // read instead of probing the model themselves.
  modelVoice: any = null;
  get usesModelVoice(): boolean {
    return (
      this.voiceOutputActive &&
      this.modelVoice !== null &&
      !this.forceTTSFallback
    );
  }
  isSetupSheetOpen = false;
  lastSpokenMessageId: string | null = null;
  forceTTSFallback = false;
  speechLanguage = '';
  // Mirrors the real default, so a test that wants the old whole-buffer
  // behavior has to say so instead of inheriting it by accident.
  streamSpeech = true;
  voiceShortAnswers = true;
  slowSpeech: 'wait' | 'system' = 'wait';
  // The real default, so a voice test that counts the endpoint wait gets the
  // one the phone runs with unless it says otherwise.
  voiceEndpointMs = VOICE_ENDPOINT_HANG_MS;

  supertonicDownloadState: DownloadState = 'not_installed';
  supertonicDownloadProgress = 0;
  supertonicDownloadError: string | null = null;
  supertonicSteps: 1 | 2 | 3 | 5 | 10 = 3;
  supertonicLanguage: string = 'na';

  kokoroDownloadState: DownloadState = 'not_installed';
  kokoroDownloadProgress = 0;
  kokoroDownloadError: string | null = null;

  kittenDownloadState: DownloadState = 'not_installed';
  kittenDownloadProgress = 0;
  kittenDownloadError: string | null = null;

  phononDownloadState: DownloadState = 'not_installed';
  phononDownloadProgress = 0;
  phononDownloadError: string | null = null;
  phononSupported = false;

  init: jest.Mock;
  refreshPhononSupport: jest.Mock;
  play: jest.Mock;
  preview: jest.Mock;
  isPreviewingVoice: jest.Mock;
  stop: jest.Mock;
  setAutoSpeak: jest.Mock;
  setVoiceOutputActive: jest.Mock;
  setModelVoice: jest.Mock;
  setUserTTSOverride: jest.Mock;
  setCurrentVoice: jest.Mock;
  setSupertonicSteps: jest.Mock;
  setSupertonicLanguage: jest.Mock;
  setForceTTSFallback: jest.Mock;
  setSpeechLanguage: jest.Mock;
  setStreamSpeech: jest.Mock;
  setVoiceShortAnswers: jest.Mock;
  setVoiceEndpointMs: jest.Mock;
  setSlowSpeech: jest.Mock;
  openSetupSheet: jest.Mock;
  closeSetupSheet: jest.Mock;
  onAssistantMessageStart: jest.Mock;
  onAssistantMessageChunk: jest.Mock;
  onAssistantMessageComplete: jest.Mock;
  downloadSupertonic: jest.Mock;
  retryDownload: jest.Mock;
  deleteSupertonic: jest.Mock;
  downloadKokoro: jest.Mock;
  retryKokoroDownload: jest.Mock;
  deleteKokoro: jest.Mock;
  downloadKitten: jest.Mock;
  retryKittenDownload: jest.Mock;
  deleteKitten: jest.Mock;
  downloadPhonon: jest.Mock;
  retryPhononDownload: jest.Mock;
  deletePhonon: jest.Mock;

  isEngineOffered(id: string): boolean {
    return id !== 'phonon' || this.phononSupported;
  }

  constructor() {
    makeAutoObservable(this, {
      init: false,
      refreshPhononSupport: false,
      play: false,
      preview: false,
      isPreviewingVoice: false,
      stop: false,
      setAutoSpeak: false,
      setVoiceOutputActive: false,
      setModelVoice: false,
      modelVoice: observable.shallow,
      setUserTTSOverride: false,
      setCurrentVoice: false,
      setSupertonicSteps: false,
      setSupertonicLanguage: false,
      setForceTTSFallback: false,
      setSpeechLanguage: false,
      setStreamSpeech: false,
      setVoiceShortAnswers: false,
      openSetupSheet: false,
      closeSetupSheet: false,
      onAssistantMessageStart: false,
      onAssistantMessageChunk: false,
      onAssistantMessageComplete: false,
      downloadSupertonic: false,
      retryDownload: false,
      deleteSupertonic: false,
      downloadKokoro: false,
      retryKokoroDownload: false,
      deleteKokoro: false,
      downloadKitten: false,
      retryKittenDownload: false,
      deleteKitten: false,
      downloadPhonon: false,
      retryPhononDownload: false,
      deletePhonon: false,
    });
    this.init = jest.fn().mockResolvedValue(undefined);
    this.refreshPhononSupport = jest.fn().mockResolvedValue(undefined);
    this.play = jest.fn().mockResolvedValue(undefined);
    this.preview = jest.fn().mockResolvedValue(undefined);
    this.isPreviewingVoice = jest.fn().mockReturnValue(false);
    this.stop = jest.fn().mockResolvedValue(undefined);
    this.setAutoSpeak = jest.fn();
    this.setVoiceOutputActive = jest.fn((active: boolean) => {
      runInAction(() => {
        this.voiceOutputActive = active;
      });
    });
    this.setModelVoice = jest.fn((sink: unknown) => {
      runInAction(() => {
        this.modelVoice = sink;
      });
    });
    this.setUserTTSOverride = jest.fn();
    this.setCurrentVoice = jest.fn();
    this.setSupertonicSteps = jest.fn();
    this.setSupertonicLanguage = jest.fn();
    this.setForceTTSFallback = jest.fn((on: boolean) => {
      runInAction(() => {
        this.forceTTSFallback = on;
      });
    });
    this.setSpeechLanguage = jest.fn((value: string) => {
      runInAction(() => {
        this.speechLanguage = value;
      });
    });
    this.setStreamSpeech = jest.fn((on: boolean) => {
      runInAction(() => {
        this.streamSpeech = on;
      });
    });
    this.setVoiceShortAnswers = jest.fn((on: boolean) => {
      runInAction(() => {
        this.voiceShortAnswers = on;
      });
    });
    this.setSlowSpeech = jest.fn((policy: 'wait' | 'system') => {
      runInAction(() => {
        this.slowSpeech = policy;
      });
    });
    this.setVoiceEndpointMs = jest.fn((ms: number) => {
      runInAction(() => {
        this.voiceEndpointMs = Math.min(Math.max(Math.round(ms), 300), 1500);
      });
    });
    this.openSetupSheet = jest.fn();
    this.closeSetupSheet = jest.fn();
    this.onAssistantMessageStart = jest.fn();
    this.onAssistantMessageChunk = jest.fn();
    this.onAssistantMessageComplete = jest.fn();
    this.downloadSupertonic = jest.fn().mockResolvedValue(undefined);
    this.retryDownload = jest.fn().mockResolvedValue(undefined);
    this.deleteSupertonic = jest.fn().mockResolvedValue(undefined);
    this.downloadKokoro = jest.fn().mockResolvedValue(undefined);
    this.retryKokoroDownload = jest.fn().mockResolvedValue(undefined);
    this.deleteKokoro = jest.fn().mockResolvedValue(undefined);
    this.downloadKitten = jest.fn().mockResolvedValue(undefined);
    this.retryKittenDownload = jest.fn().mockResolvedValue(undefined);
    this.deleteKitten = jest.fn().mockResolvedValue(undefined);
    this.downloadPhonon = jest.fn().mockResolvedValue(undefined);
    this.retryPhononDownload = jest.fn().mockResolvedValue(undefined);
    this.deletePhonon = jest.fn().mockResolvedValue(undefined);
  }
}

export const mockTTSStore = new MockTTSStore();
