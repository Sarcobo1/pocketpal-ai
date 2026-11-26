import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import {modelStore} from './ModelStore';
import type {Model} from '../utils/types';

const {ApiServerModule} = NativeModules;

export interface ApiRequestLog {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  tokens?: number;
  note?: string;
}

interface IncomingHttpRequest {
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface NetworkStatus {
  isConnected: boolean;
  networkType: string;
  localIp: string;
}

const IDLE_UNLOAD_SECONDS = 10 * 60; // 10 daqiqa

function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = 'pk-';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export class ApiServerStore {
  isRunning = false;
  isStarting = false;
  deployedModelId: string | null = null;
  modelAlias = '';
  port = 11434;
  apiKey = generateApiKey();
  relayUrl = '';
  relayConnected = false;

  localIp = '127.0.0.1';
  isInternetConnected = false;
  networkType = 'none';

  isLoadingModel = false;
  activeRequests = 0;
  totalRequests = 0;
  totalTokensGenerated = 0;
  secondsUntilUnload: number | null = null;
  lastError: string | null = null;
  logs: ApiRequestLog[] = [];

  private lastRequestAt = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private networkPollTimer: ReturnType<typeof setInterval> | null = null;
  private requestSubscription: {remove: () => void} | null = null;
  private loadPromise: Promise<void> | null = null;
  private completionQueue: Promise<void> = Promise.resolve();
  private relaySocket: WebSocket | null = null;

  constructor() {
    makeAutoObservable(
      this,
      {
        // non-observable internals
      } as any,
      {autoBind: true},
    );

    makePersistable(this, {
      name: 'ApiServerStore',
      properties: ['apiKey', 'port', 'deployedModelId', 'modelAlias', 'relayUrl'],
      storage: AsyncStorage,
    });
  }

  get deployedModel(): Model | undefined {
    if (!this.deployedModelId) {
      return undefined;
    }
    return modelStore.models.find(m => m.id === this.deployedModelId);
  }

  get effectiveModelName(): string {
    if (this.modelAlias.trim()) {
      return this.modelAlias.trim();
    }
    return this.deployedModel?.name || 'pocketpal-model';
  }

  get isModelInRam(): boolean {
    return Boolean(
      this.deployedModelId &&
        modelStore.context &&
        modelStore.activeModelId === this.deployedModelId,
    );
  }

  get baseUrl(): string {
    return `http://${this.localIp}:${this.port}/v1`;
  }

  setDeployedModel(model: Model) {
    this.deployedModelId = model.id;
    this.modelAlias = model.name;
  }

  setModelAlias(alias: string) {
    this.modelAlias = alias;
  }

  setPort(port: number) {
    if (port >= 1024 && port <= 65535) {
      this.port = port;
    }
  }

  setRelayUrl(url: string) {
    this.relayUrl = url.trim();
  }

  regenerateApiKey() {
    this.apiKey = generateApiKey();
  }

  clearLogs() {
    this.logs = [];
  }

  private addLog(entry: Omit<ApiRequestLog, 'id' | 'timestamp'>) {
    runInAction(() => {
      this.logs = [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
          ...entry,
        },
        ...this.logs.slice(0, 49),
      ];
    });
  }

  async refreshNetworkStatus(): Promise<NetworkStatus> {
    if (Platform.OS === 'android' && ApiServerModule?.checkInternetConnectivity) {
      try {
        const res: NetworkStatus = await ApiServerModule.checkInternetConnectivity();
        runInAction(() => {
          this.isInternetConnected = Boolean(res.isConnected);
          this.networkType = res.networkType || 'none';
          this.localIp = res.localIp || '127.0.0.1';
        });
        return res;
      } catch {
        // fall through
      }
    }
    // Fallback for non-Android / tests
    const fallback: NetworkStatus = {
      isConnected: true,
      networkType: 'wifi',
      localIp: '127.0.0.1',
    };
    runInAction(() => {
      this.isInternetConnected = fallback.isConnected;
      this.networkType = fallback.networkType;
      this.localIp = fallback.localIp;
    });
    return fallback;
  }

  openNetworkSettings() {
    if (Platform.OS === 'android' && ApiServerModule?.openNetworkSettings) {
      ApiServerModule.openNetworkSettings();
    }
  }

  async start(): Promise<{ok: boolean; reason?: 'no_internet' | 'no_model' | 'error'; message?: string}> {
    if (this.isRunning) {
      return {ok: true};
    }
    const model = this.deployedModel;
    if (!model || !model.isDownloaded) {
      return {
        ok: false,
        reason: 'no_model',
        message: 'Avval yuklab olingan modelni tanlang.',
      };
    }

    runInAction(() => {
      this.isStarting = true;
      this.lastError = null;
    });

    try {
      const net = await this.refreshNetworkStatus();
      if (!net.isConnected) {
        runInAction(() => {
          this.isStarting = false;
          this.lastError = 'Internet o\'chirilgan. Modelni online qilish uchun internetni yoqing.';
        });
        return {
          ok: false,
          reason: 'no_internet',
          message: 'Modelni online qilish uchun Wi-Fi yoki mobil internetni yoqing.',
        };
      }

      if (Platform.OS === 'android' && ApiServerModule?.startServer) {
        const emitter = new NativeEventEmitter(ApiServerModule);
        this.requestSubscription?.remove();
        this.requestSubscription = emitter.addListener(
          'ApiServerRequest',
          (event: any) =>
            this.handleIncomingHttpRequest(event as IncomingHttpRequest),
        );
        const started = await ApiServerModule.startServer(
          this.port,
          this.effectiveModelName,
        );
        runInAction(() => {
          this.port = started.port ?? this.port;
          this.localIp = started.localIp ?? this.localIp;
        });
      }

      // Load model into RAM immediately on deploy so first request is instant
      await this.ensureModelInRam();

      this.touchActivity();
      this.startTimers();
      this.connectRelayIfConfigured();

      runInAction(() => {
        this.isRunning = true;
        this.isStarting = false;
      });

      this.addLog({
        method: 'SYSTEM',
        path: '/deploy',
        status: 200,
        latencyMs: 0,
        note: `Model online: ${this.effectiveModelName} (${this.baseUrl})`,
      });

      return {ok: true};
    } catch (err: any) {
      const msg = err?.message || 'Serverni ishga tushirishda xatolik';
      runInAction(() => {
        this.isRunning = false;
        this.isStarting = false;
        this.lastError = msg;
      });
      return {ok: false, reason: 'error', message: msg};
    }
  }

  async stop() {
    this.stopTimers();
    this.disconnectRelay();
    this.requestSubscription?.remove();
    this.requestSubscription = null;

    if (Platform.OS === 'android' && ApiServerModule?.stopServer) {
      try {
        await ApiServerModule.stopServer();
      } catch {
        // ignore
      }
    }

    runInAction(() => {
      this.isRunning = false;
      this.isStarting = false;
      this.secondsUntilUnload = null;
      this.activeRequests = 0;
    });

    this.addLog({
      method: 'SYSTEM',
      path: '/stop',
      status: 200,
      latencyMs: 0,
      note: 'API server to\'xtatildi',
    });
  }

  async unloadFromRamManually() {
    if (this.activeRequests > 0) {
      return;
    }
    if (modelStore.context) {
      await modelStore.releaseContext();
    }
    runInAction(() => {
      this.secondsUntilUnload = null;
    });
    this.syncNotification();
    this.addLog({
      method: 'RAM',
      path: '/unload',
      status: 200,
      latencyMs: 0,
      note: 'Model RAMdan qo\'lda bo\'shatildi',
    });
  }

  async loadIntoRamManually() {
    await this.ensureModelInRam();
    this.touchActivity();
  }

  private touchActivity() {
    this.lastRequestAt = Date.now();
    runInAction(() => {
      this.secondsUntilUnload = this.isModelInRam ? IDLE_UNLOAD_SECONDS : null;
    });
  }

  private syncNotification() {
    if (Platform.OS === 'android' && ApiServerModule?.updateServiceNotification) {
      ApiServerModule.updateServiceNotification(
        this.effectiveModelName,
        this.isModelInRam,
      );
    }
  }

  private startTimers() {
    this.stopTimers();
    this.idleTimer = setInterval(() => {
      if (!this.isRunning) return;
      if (this.activeRequests > 0 || this.isLoadingModel) {
        this.lastRequestAt = Date.now();
        if (this.isModelInRam) {
          runInAction(() => {
            this.secondsUntilUnload = IDLE_UNLOAD_SECONDS;
          });
        }
        return;
      }
      if (!this.isModelInRam) {
        if (this.secondsUntilUnload !== null) {
          runInAction(() => {
            this.secondsUntilUnload = null;
          });
        }
        return;
      }
      const elapsed = Math.floor((Date.now() - this.lastRequestAt) / 1000);
      const remaining = Math.max(0, IDLE_UNLOAD_SECONDS - elapsed);
      runInAction(() => {
        this.secondsUntilUnload = remaining;
      });
      if (remaining === 0) {
        this.performIdleUnload();
      }
    }, 1000);

    this.networkPollTimer = setInterval(() => {
      this.refreshNetworkStatus().catch(() => {});
    }, 5000);
  }

  private stopTimers() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.networkPollTimer) {
      clearInterval(this.networkPollTimer);
      this.networkPollTimer = null;
    }
  }

  private async performIdleUnload() {
    if (this.activeRequests > 0 || !this.isModelInRam) {
      return;
    }
    try {
      await modelStore.releaseContext();
      runInAction(() => {
        this.secondsUntilUnload = null;
      });
      this.syncNotification();
      this.addLog({
        method: 'RAM',
        path: '/auto-unload',
        status: 200,
        latencyMs: 0,
        note: '10 daqiqa so\'rov kelmadi — telefon qizimasligi uchun RAMdan bo\'shatildi',
      });
    } catch (e: any) {
      console.warn('[ApiServerStore] Auto-unload error:', e);
    }
  }

  private async ensureModelInRam(): Promise<void> {
    if (this.isModelInRam) {
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }
    const model = this.deployedModel;
    if (!model) {
      throw new Error('Tanlangan model topilmadi');
    }

    this.loadPromise = (async () => {
      const start = Date.now();
      runInAction(() => {
        this.isLoadingModel = true;
      });
      this.addLog({
        method: 'RAM',
        path: '/load',
        status: 200,
        latencyMs: 0,
        note: `Storagedan RAMga yuklanmoqda: ${model.name}`,
      });
      try {
        await modelStore.initContext(model);
        this.syncNotification();
        this.addLog({
          method: 'RAM',
          path: '/ready',
          status: 200,
          latencyMs: Date.now() - start,
          note: `Model RAMga yuklandi (${Date.now() - start} ms)`,
        });
      } finally {
        runInAction(() => {
          this.isLoadingModel = false;
        });
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  private runSerializedCompletion<T>(task: () => Promise<T>): Promise<T> {
    const next = this.completionQueue.then(task, task);
    this.completionQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private isAuthorized(headers: Record<string, string>): boolean {
    const auth = headers['authorization'] || headers['Authorization'] || '';
    if (!auth) return false;
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    return token === this.apiKey;
  }

  private sendJson(requestId: string, status: number, payload: any) {
    if (Platform.OS === 'android' && ApiServerModule?.sendResponse) {
      ApiServerModule.sendResponse(
        requestId,
        status,
        JSON.stringify({'Content-Type': 'application/json; charset=utf-8'}),
        JSON.stringify(payload),
      );
    }
  }

  private handleIncomingHttpRequest = async (req: IncomingHttpRequest) => {
    const start = Date.now();
    const {requestId, method, path, headers, body} = req;

    try {
      // 1. Health endpoint (public)
      if (method === 'GET' && (path === '/health' || path === '/')) {
        this.sendJson(requestId, 200, {
          status: 'ok',
          online: this.isRunning,
          model: this.effectiveModelName,
          ram_loaded: this.isModelInRam,
          seconds_until_unload: this.secondsUntilUnload,
        });
        return;
      }

      // 2. Auth check for /v1/* endpoints
      if (!this.isAuthorized(headers)) {
        this.sendJson(requestId, 401, {
          error: {
            message: 'Invalid or missing API key. Pass Authorization: Bearer <api_key>',
            type: 'authentication_error',
            code: 'invalid_api_key',
          },
        });
        this.addLog({
          method,
          path,
          status: 401,
          latencyMs: Date.now() - start,
          note: 'Noto\'g\'ri API kalit',
        });
        return;
      }

      // 3. List models
      if (method === 'GET' && path === '/v1/models') {
        this.sendJson(requestId, 200, {
          object: 'list',
          data: [
            {
              id: this.effectiveModelName,
              object: 'model',
              created: Math.floor(Date.now() / 1000),
              owned_by: 'pocketpal-phone',
            },
          ],
        });
        this.addLog({method, path, status: 200, latencyMs: Date.now() - start});
        return;
      }

      // 4. Chat completions (OpenAI compatible)
      if (method === 'POST' && path === '/v1/chat/completions') {
        let parsed: any;
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          this.sendJson(requestId, 400, {
            error: {message: 'Invalid JSON body', type: 'invalid_request_error'},
          });
          return;
        }

        const requestedModel = parsed.model;
        if (
          requestedModel &&
          requestedModel !== this.effectiveModelName &&
          requestedModel !== this.deployedModel?.name &&
          requestedModel !== this.deployedModel?.id
        ) {
          this.sendJson(requestId, 404, {
            error: {
              message: `Model '${requestedModel}' topilmadi. Faol model: '${this.effectiveModelName}'`,
              type: 'invalid_request_error',
              code: 'model_not_found',
            },
          });
          this.addLog({
            method,
            path,
            status: 404,
            latencyMs: Date.now() - start,
            note: `Noma'lum model: ${requestedModel}`,
          });
          return;
        }

        const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
        if (messages.length === 0) {
          this.sendJson(requestId, 400, {
            error: {
              message: "'messages' maydoni bo'sh bo'lmasligi kerak",
              type: 'invalid_request_error',
            },
          });
          return;
        }

        const stream = Boolean(parsed.stream);
        const temperature =
          typeof parsed.temperature === 'number' ? parsed.temperature : 0.7;
        const maxTokens =
          typeof parsed.max_tokens === 'number' ? parsed.max_tokens : 512;

        runInAction(() => {
          this.activeRequests += 1;
          this.totalRequests += 1;
        });
        this.touchActivity();

        try {
          const result = await this.runSerializedCompletion(async () => {
            await this.ensureModelInRam();
            const ctx = modelStore.context;
            if (!ctx) {
              throw new Error('Model konteksti yuklanmadi');
            }

            const completionId = `chatcmpl-${Date.now()}`;
            const created = Math.floor(Date.now() / 1000);

            if (stream && Platform.OS === 'android' && ApiServerModule?.startStream) {
              ApiServerModule.startStream(requestId, 200, '{}');
              const res = await ctx.completion(
                {
                  messages,
                  temperature,
                  n_predict: maxTokens,
                },
                (data: {token?: string}) => {
                  if (data?.token) {
                    const chunkPayload = {
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created,
                      model: this.effectiveModelName,
                      choices: [
                        {
                          index: 0,
                          delta: {content: data.token},
                          finish_reason: null,
                        },
                      ],
                    };
                    ApiServerModule.sendStreamChunk(
                      requestId,
                      `data: ${JSON.stringify(chunkPayload)}\n\n`,
                    );
                  }
                },
              );
              const doneChunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model: this.effectiveModelName,
                choices: [{index: 0, delta: {}, finish_reason: 'stop'}],
              };
              ApiServerModule.sendStreamChunk(
                requestId,
                `data: ${JSON.stringify(doneChunk)}\n\ndata: [DONE]\n\n`,
              );
              ApiServerModule.endStream(requestId);
              return {streamed: true, res};
            }

            const res = await ctx.completion({
              messages,
              temperature,
              n_predict: maxTokens,
            });
            return {streamed: false, res, completionId, created};
          });

          const predictedTokens = result.res?.timings?.predicted_n ?? 0;
          const promptTokens = result.res?.timings?.prompt_n ?? 0;
          runInAction(() => {
            this.totalTokensGenerated += predictedTokens;
          });

          if (!result.streamed) {
            this.sendJson(requestId, 200, {
              id: result.completionId,
              object: 'chat.completion',
              created: result.created,
              model: this.effectiveModelName,
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: result.res?.text ?? '',
                  },
                  finish_reason: result.res?.stopped_limit ? 'length' : 'stop',
                },
              ],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: predictedTokens,
                total_tokens: promptTokens + predictedTokens,
              },
            });
          }

          this.addLog({
            method,
            path,
            status: 200,
            latencyMs: Date.now() - start,
            tokens: predictedTokens,
          });
        } finally {
          runInAction(() => {
            this.activeRequests = Math.max(0, this.activeRequests - 1);
          });
          this.touchActivity();
        }
        return;
      }

      this.sendJson(requestId, 404, {
        error: {message: `Endpoint topilmadi: ${method} ${path}`},
      });
      this.addLog({method, path, status: 404, latencyMs: Date.now() - start});
    } catch (err: any) {
      if (Platform.OS === 'android' && ApiServerModule?.endStream) {
        ApiServerModule.endStream(requestId);
      }
      this.sendJson(requestId, 500, {
        error: {message: err?.message || 'Internal Server Error'},
      });
      this.addLog({
        method,
        path,
        status: 500,
        latencyMs: Date.now() - start,
        note: err?.message,
      });
    }
  };

  // Optional outbound WebSocket relay for servers outside local Wi-Fi/VPN
  private connectRelayIfConfigured() {
    if (!this.relayUrl) {
      return;
    }
    this.disconnectRelay();
    try {
      const ws = new WebSocket(this.relayUrl);
      this.relaySocket = ws;
      ws.onopen = () => {
        runInAction(() => {
          this.relayConnected = true;
        });
        ws.send(
          JSON.stringify({
            type: 'register',
            model: this.effectiveModelName,
            apiKey: this.apiKey,
          }),
        );
      };
      ws.onmessage = async event => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'chat_completion' && msg.requestId) {
            const messages = Array.isArray(msg.messages) ? msg.messages : [];
            runInAction(() => {
              this.activeRequests += 1;
              this.totalRequests += 1;
            });
            this.touchActivity();
            try {
              const res = await this.runSerializedCompletion(async () => {
                await this.ensureModelInRam();
                const ctx = modelStore.context;
                if (!ctx) throw new Error('Model konteksti yuklanmadi');
                return ctx.completion({
                  messages,
                  temperature: msg.temperature ?? 0.7,
                  n_predict: msg.max_tokens ?? 512,
                });
              });
              ws.send(
                JSON.stringify({
                  type: 'chat_completion_result',
                  requestId: msg.requestId,
                  model: this.effectiveModelName,
                  content: res.text ?? '',
                }),
              );
            } finally {
              runInAction(() => {
                this.activeRequests = Math.max(0, this.activeRequests - 1);
              });
              this.touchActivity();
            }
          }
        } catch {
          // ignore malformed relay message
        }
      };
      ws.onclose = () => {
        runInAction(() => {
          this.relayConnected = false;
        });
      };
      ws.onerror = () => {
        runInAction(() => {
          this.relayConnected = false;
        });
      };
    } catch {
      runInAction(() => {
        this.relayConnected = false;
      });
    }
  }

  private disconnectRelay() {
    if (this.relaySocket) {
      try {
        this.relaySocket.close();
      } catch {
        // ignore
      }
      this.relaySocket = null;
    }
    runInAction(() => {
      this.relayConnected = false;
    });
  }
}

export const apiServerStore = new ApiServerStore();
