import {LlamaContext} from 'llama.rn';
import {AccessibilityInfo} from 'react-native';
import {renderHook, act, waitFor} from '@testing-library/react-native';
import {runInAction} from 'mobx';

import {textMessage} from '../../../jest/fixtures';
import {sessionFixtures} from '../../../jest/fixtures/chatSessions';
import {
  mockBasicModel,
  mockDefaultCompletionParams,
  mockLlamaContextParams,
  modelsList,
} from '../../../jest/fixtures/models';

import {useChatSession} from '../useChatSession';
import {
  VOICE_ANSWER_INSTRUCTION,
  VOICE_AUDIO_INSTRUCTION,
} from '../../services/voice/constants';
import {isReadUrlAllowed} from '../../services/talents';
import {bodyExtras} from '../../api/servers';

import {
  chatSessionStore,
  modelStore,
  palStore,
  serverStore,
  ttsStore,
  uiStore,
} from '../../store';

import {l10n} from '../../locales';
import {assistant} from '../../utils/chat';
import {MessageType, ModelOrigin} from '../../utils/types';
import {
  RemoteModelNotReadyError,
  RemoteModelRequestWithdrawnError,
} from '../../utils/errors';

const mockAssistant = {
  id: 'h3o3lc5xj',
};

/** What the model is actually handed, read one turn at a time. */
type SentMessages = Array<{role: string; content: any}>;

const lastUserParts = (messages: SentMessages) => {
  const last = [...messages].reverse().find(m => m.role === 'user')!;
  return Array.isArray(last.content)
    ? last.content
    : [{type: 'text', text: last.content}];
};
const textPartsOf = (parts: Array<{type: string; text?: string}>) =>
  parts.filter(part => part.type === 'text').map(part => part.text);
const audioPartsOf = (parts: Array<{type: string}>) =>
  parts.filter(part => part.type === 'input_audio');
const promptOf = (messages: SentMessages) =>
  messages
    .filter(message => message.role === 'system')
    .map(message => String(message.content))
    .join('\n\n');

beforeEach(() => {
  // Reset jest mocks' call counts without removing spies
  jest.clearAllMocks();

  // Reset mock stores to a known baseline between tests
  palStore.pals = [] as any;
  chatSessionStore.sessions = sessionFixtures as any;
  chatSessionStore.activeSessionId = 'session-1';

  // Reset model state
  modelStore.models = modelsList as any;
  modelStore.activeModelId = undefined;

  // Fresh mocked context each test
  modelStore.context = new LlamaContext(mockLlamaContextParams);

  // Set up a mock engine that delegates to context.completion
  modelStore.engine = {
    completion: jest.fn((params, onData) => {
      return modelStore.context!.completion(params, onData);
    }),
    stopCompletion: jest.fn(async () => {
      await modelStore.context?.stopCompletion();
    }),
  };
});

// Mock the applyChatTemplate function from utils/chat
const applyChatTemplateSpy = jest
  .spyOn(require('../../utils/chat'), 'applyChatTemplate')
  .mockImplementation(async () => 'mocked prompt');

describe('useChatSession', () => {
  beforeEach(() => {
    applyChatTemplateSpy.mockClear();
  });

  it('should send a message and update the chat session', async () => {
    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    await act(async () => {
      await result.current.handleSendPress(textMessage);
    });

    expect(chatSessionStore.addMessageToCurrentSession).toHaveBeenCalled();
    expect(modelStore.context?.completion).toHaveBeenCalled();
  });

  describe('a spoken send', () => {
    const addedRows = () =>
      (chatSessionStore.addMessageToCurrentSession as jest.Mock).mock.calls.map(
        ([row]) => row,
      );

    it('marks the user row and the assistant turn as spoken', async () => {
      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage, {spoken: true});
      });

      const user = addedRows().find(row => row.type === 'text');
      const turn = addedRows().find(row => row.type === 'assistant_turn');
      expect(user.metadata.spoken).toBe(true);
      expect(turn.metadata.spoken).toBe(true);
    });

    it("hands back the assistant turn's id once its row exists", async () => {
      (
        chatSessionStore.addMessageToCurrentSession as jest.Mock
      ).mockImplementation(async row => {
        row.id = `${row.type}-id`;
      });
      const onTurnCreated = jest.fn();
      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage, {
          spoken: true,
          onTurnCreated,
        });
      });

      expect(onTurnCreated).toHaveBeenCalledTimes(1);
      expect(onTurnCreated).toHaveBeenCalledWith('assistant_turn-id');
      (
        chatSessionStore.addMessageToCurrentSession as jest.Mock
      ).mockResolvedValue(undefined);
    });

    const sendWithThinkingOn = async (opts?: {spoken: boolean}) => {
      const model = {
        ...(modelsList as any)[0],
        reasoning: {
          isReasoning: 'yes',
          source: 'user',
          supportsEffort: true,
          effortValues: ['low', 'medium', 'high'],
          effortSource: 'user',
        },
      };
      modelStore.models = [model] as any;
      modelStore.activeModelId = model.id;
      const settings = await chatSessionStore.getCurrentCompletionSettings();
      (
        chatSessionStore.getCurrentCompletionSettings as jest.Mock
      ).mockResolvedValueOnce({
        ...settings,
        enable_thinking: true,
        reasoning: {enabled: true, effort: 'high'},
      });
      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );
      await act(async () => {
        await result.current.handleSendPress(textMessage, opts);
      });
      return (modelStore.engine!.completion as jest.Mock).mock.calls[0][0];
    };

    it('runs the reply with thinking off, whatever the chat setting', async () => {
      const params = await sendWithThinkingOn({spoken: true});

      expect(params.chat_template_kwargs).toEqual(
        expect.objectContaining({enable_thinking: false}),
      );
      expect(params.chat_template_kwargs?.reasoning_effort).toBeUndefined();
      expect(params.reasoning).toEqual({enabled: false});
    });

    it('asks a remote server for no thinking too', async () => {
      const params = await sendWithThinkingOn({spoken: true});
      const request = {samplers: {}, reasoning: params.reasoning};

      expect(bodyExtras('llama.cpp', request)).toEqual({
        reasoning_format: 'auto',
        chat_template_kwargs: {enable_thinking: false},
      });
      expect(bodyExtras('Ollama', request)).toEqual({reasoning_effort: 'none'});
    });

    it('leaves thinking to the chat setting for a typed send', async () => {
      const params = await sendWithThinkingOn();

      expect(params.chat_template_kwargs?.enable_thinking).not.toBe(false);
      expect(params.chat_template_kwargs?.reasoning_effort).toBe('high');
    });

    it('a typed send carries no spoken flag', async () => {
      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage);
      });

      for (const row of addedRows()) {
        expect(row.metadata).not.toHaveProperty('spoken');
      }
    });

    const sentMessages = async (opts?: {spoken: boolean}) => {
      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage, opts);
      });

      const sent = (modelStore.engine!.completion as jest.Mock).mock
        .calls[0][0] as {messages: Array<{role: string; content: any}>};
      return sent.messages;
    };

    const systemText = (messages: Array<{role: string; content: any}>) =>
      messages
        .filter(message => message.role === 'system')
        .map(message => String(message.content))
        .join('\n\n');

    describe('the short-answer instruction', () => {
      it('is the last thing a spoken turn tells the model', async () => {
        const messages = await sentMessages({spoken: true});
        const system = systemText(messages).trim();

        expect(system.slice(-VOICE_ANSWER_INSTRUCTION.length)).toBe(
          VOICE_ANSWER_INSTRUCTION,
        );
      });

      it('leaves a typed prompt as it was', async () => {
        const messages = await sentMessages();

        expect(systemText(messages)).not.toContain(VOICE_ANSWER_INSTRUCTION);
      });

      it('stands down when the setting is off', async () => {
        ttsStore.setVoiceShortAnswers(false);
        try {
          const messages = await sentMessages({spoken: true});

          expect(systemText(messages)).not.toContain(VOICE_ANSWER_INSTRUCTION);
        } finally {
          ttsStore.setVoiceShortAnswers(true);
        }
      });

      it('costs a spoken turn no extra message', async () => {
        const messages = await sentMessages({spoken: true});

        // A second system message makes strict chat templates raise, so the
        // instruction joins the one that already stands instead of following it.
        expect(
          messages.filter(message => message.role === 'system').length,
        ).toBe(1);
      });
    });
  });

  it('should handle model not loaded scenario', async () => {
    modelStore.context = undefined;
    modelStore.engine = undefined;
    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, assistant),
    );

    await act(async () => {
      await result.current.handleSendPress(textMessage);
    });

    // TODO: fix this test:         "text": "Model not loaded. Please initialize the model.",
    expect(chatSessionStore.addMessageToCurrentSession).toHaveBeenCalledWith({
      author: assistant,
      createdAt: expect.any(Number),
      id: expect.any(String),
      text: l10n.en.chat.modelNotLoaded,
      type: 'text',
      metadata: {system: true},
    });
  });

  it('should handle general errors during completion', async () => {
    const errorMessage = 'Some general error';
    if (modelStore.context) {
      modelStore.context.completion = jest
        .fn()
        .mockRejectedValueOnce(new Error(errorMessage));
    }

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    await act(async () => {
      await result.current.handleSendPress(textMessage);
    });

    expect(chatSessionStore.addMessageToCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `Completion failed: ${errorMessage}`,
        author: assistant,
      }),
    );
  });

  it('maps the speculative draft-context failure to friendly copy', async () => {
    // Low-RAM devices throw this at first completion; the raw native string
    // must not reach the chat.
    if (modelStore.context) {
      modelStore.context.completion = jest
        .fn()
        .mockRejectedValueOnce(new Error('failed to create draft context'));
    }

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    await act(async () => {
      await result.current.handleSendPress(textMessage);
    });

    expect(chatSessionStore.addMessageToCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        text: l10n.en.chat.speculativeInitFailed,
        author: assistant,
      }),
    );
  });

  it('maps a tool-call parse failure before any output to friendly copy', async () => {
    if (modelStore.context) {
      modelStore.context.completion = jest
        .fn()
        .mockRejectedValueOnce(
          new Error(
            'Failed to parse tool call arguments as JSON: [json.exception.parse_error.101] parse error',
          ),
        );
    }

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    await act(async () => {
      await result.current.handleSendPress(textMessage);
    });

    const texts = (
      chatSessionStore.addMessageToCurrentSession as jest.Mock
    ).mock.calls.map(call => call[0]?.text);
    expect(texts).toContain(l10n.en.chat.toolCallTruncated);
    expect(
      texts.filter(text => text?.startsWith(l10n.en.chat.completionFailed)),
    ).toEqual([]);
  });

  describe('a router turn that ends before its request', () => {
    type Row = {id: string; type: string; [key: string]: unknown};
    type Session = {id: string; title: string; messages: Row[]};
    let sessions: Session[];
    let nextId: number;
    const deleteMessage =
      chatSessionStore.deleteMessageFromSession as jest.Mock;
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const addToCurrent =
      chatSessionStore.addMessageToCurrentSession as jest.Mock;
    const setTitle =
      chatSessionStore.updateSessionTitleBySessionId as jest.Mock;

    const activeSession = () =>
      sessions.find(s => s.id === chatSessionStore.activeSessionId);
    const userRow = (id: string, text: string): Row => ({
      id,
      type: 'text',
      text,
      author: textMessage.author,
      createdAt: 0,
    });
    const assistantRow = (id: string, text: string): Row => ({
      id,
      type: 'text',
      text,
      author: assistant,
      createdAt: 0,
    });

    const failWith = (error: Error) => {
      modelStore.context!.completion = jest.fn().mockRejectedValueOnce(error);
    };
    const failWhenReleased = () => {
      let release!: (error: Error) => void;
      modelStore.context!.completion = jest.fn(
        () => new Promise((_resolve, reject) => (release = reject)),
      );
      return (error: Error) => release(error);
    };
    const renderSession = (ref = {current: null}) =>
      renderHook(() => useChatSession(ref, textMessage.author, mockAssistant))
        .result;
    const send = async (result = renderSession()) => {
      let undone: unknown;
      await act(async () => {
        undone = await result.current.handleSendPress(textMessage);
      });
      return undone;
    };

    beforeEach(() => {
      nextId = 0;
      sessions = [{id: 'S', title: 'text', messages: []}];
      chatSessionStore.sessions = sessions as any;
      chatSessionStore.activeSessionId = 'S';
      addToCurrent.mockImplementation(async (message: Row) => {
        message.id = `row-${++nextId}`;
        if (!activeSession()) {
          sessions.push({id: 'N', title: 'New Session', messages: []});
          chatSessionStore.activeSessionId = 'N';
        }
        const session = activeSession()!;
        const oldest = session.messages.at(-1);
        if (oldest && session.title === 'New Session') {
          session.title = oldest.text as string;
        }
        session.messages.unshift(message);
      });
      setTitle.mockImplementation(async (id: string, title: string) => {
        sessions.find(s => s.id === id)!.title = title;
      });
      deleteMessage.mockImplementation(
        async (sessionId: string, id: string) => {
          const owner = sessions.find(s => s.id === sessionId);
          if (owner) {
            owner.messages = owner.messages.filter(m => m.id !== id);
          }
        },
      );
    });

    afterEach(() => {
      addToCurrent.mockResolvedValue(undefined);
      setTitle.mockReset();
      setTitle.mockResolvedValue(undefined);
      deleteMessage.mockReset();
      deleteMessage.mockResolvedValue(undefined);
      Object.defineProperty(chatSessionStore, 'currentSessionMessages', {
        get: jest.fn(() => []),
        configurable: true,
      });
    });

    it('removes its user and assistant rows and hands the input back', async () => {
      failWith(new RemoteModelRequestWithdrawnError());

      const undone = await send();

      expect(deleteMessage.mock.calls.map(([, id]) => id).sort()).toEqual([
        'row-1',
        'row-2',
      ]);
      expect(sessions[0].messages).toEqual([]);
      expect(undone).toEqual({message: textMessage, sessionId: 'S'});
      expect(chatSessionStore.addMessageToSession).not.toHaveBeenCalled();
      expect(
        addToCurrent.mock.calls.filter(([m]) => m.metadata?.system),
      ).toEqual([]);
      expect(modelStore.inferencing).toBe(false);
    });

    it('resets the title of a chat the send created', async () => {
      sessions = [];
      chatSessionStore.sessions = sessions as any;
      chatSessionStore.activeSessionId = null as any;
      failWith(new RemoteModelRequestWithdrawnError());

      const undone = await send();

      expect(
        chatSessionStore.updateSessionTitleBySessionId,
      ).toHaveBeenCalledWith('N', 'New Session');
      expect(sessions[0].messages).toEqual([]);
      expect(undone).toEqual({message: textMessage, sessionId: 'N'});
    });

    it('leaves a new chat untitled after two undone sends', async () => {
      sessions = [];
      chatSessionStore.sessions = sessions as any;
      chatSessionStore.activeSessionId = null as any;
      const result = renderSession();
      const second = {...textMessage, text: 'second'};
      failWith(new RemoteModelRequestWithdrawnError());
      await send(result);

      failWith(new RemoteModelRequestWithdrawnError());
      let undone: unknown;
      await act(async () => {
        undone = await result.current.handleSendPress(second);
      });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].messages).toEqual([]);
      expect(sessions[0].title).toBe('New Session');
      expect(undone).toEqual({message: second, sessionId: 'N'});
    });

    it('keeps the title of a chat that already existed', async () => {
      failWith(new RemoteModelRequestWithdrawnError());

      await send();

      expect(
        chatSessionStore.updateSessionTitleBySessionId,
      ).not.toHaveBeenCalled();
    });

    it('sends alternating roles when the same text is sent again', async () => {
      sessions[0].messages = [
        assistantRow('a1', 'hi there'),
        userRow('u1', 'hello'),
      ];
      Object.defineProperty(chatSessionStore, 'currentSessionMessages', {
        get: jest.fn(() => [...sessions[0].messages]),
        configurable: true,
      });
      const requests: Array<Array<{role: string; content: unknown}>> = [];
      const completion = modelStore.engine!.completion;
      modelStore.engine!.completion = jest.fn((params, onData) => {
        requests.push(params.messages!.map(m => ({...m})) as any);
        return completion(params, onData);
      });
      const result = renderSession();
      failWith(new RemoteModelRequestWithdrawnError());
      await send(result);

      await send(result);

      const resent = requests[1].filter(m => m.role !== 'system');
      expect(resent.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(resent[2].content).toBe(textMessage.text);
    });

    it('keeps Send blocked until the user row is deleted', async () => {
      const atDelete: Array<{inferencing: boolean; generatingEnded: boolean}> =
        [];
      deleteMessage.mockImplementation(async () => {
        atDelete.push({
          inferencing: modelStore.inferencing,
          generatingEnded: (
            chatSessionStore.setIsGenerating as jest.Mock
          ).mock.calls.some(([value]) => value === false),
        });
      });
      failWith(new RemoteModelRequestWithdrawnError());

      await send();

      expect(atDelete).toHaveLength(2);
      expect(atDelete).toEqual(
        atDelete.map(() => ({inferencing: true, generatingEnded: false})),
      );
      expect(modelStore.inferencing).toBe(false);
    });

    it('ends the run even when the undo fails', async () => {
      sessions = [];
      chatSessionStore.sessions = sessions as any;
      chatSessionStore.activeSessionId = null as any;
      deleteMessage.mockRejectedValue(new Error('db locked'));
      (
        chatSessionStore.updateSessionTitleBySessionId as jest.Mock
      ).mockRejectedValueOnce(new Error('db locked'));
      failWith(new RemoteModelRequestWithdrawnError());
      const result = renderSession();

      await act(async () => {
        await result.current.handleSendPress(textMessage).catch(() => {});
      });

      expect(modelStore.inferencing).toBe(false);
      expect(
        (chatSessionStore.setIsGenerating as jest.Mock).mock.calls.at(-1),
      ).toEqual([false]);
    });

    it('deletes its own rows when a later send replaced the shared message info', async () => {
      const ref: {current: any} = {current: null};
      const result = renderSession(ref);
      const release = failWhenReleased();
      let sending!: Promise<unknown>;
      act(() => {
        sending = result.current.handleSendPress(textMessage);
      });
      await waitFor(() => expect(ref.current).not.toBeNull());

      ref.current = {createdAt: 0, id: 'other-turn', sessionId: 'T'};
      await act(async () => {
        release(new RemoteModelRequestWithdrawnError());
        await sending;
      });

      expect(deleteMessage.mock.calls.map(([, id]) => id).sort()).toEqual([
        'row-1',
        'row-2',
      ]);
    });

    it('keeps a turn that already has step content and undoes nothing', async () => {
      modelStore.context!.completion = jest.fn(async () => {
        const turn = sessions[0].messages.find(
          m => m.type === 'assistant_turn',
        )!;
        turn.steps = [{content: 'partial', toolCalls: []}];
        throw new RemoteModelRequestWithdrawnError();
      });

      const undone = await send();

      expect(undone).toBeUndefined();
      expect(deleteMessage).not.toHaveBeenCalled();
      expect(chatSessionStore.updateMessage).toHaveBeenCalledWith(
        'row-2',
        'S',
        expect.objectContaining({
          metadata: expect.objectContaining({interrupted: true}),
        }),
      );
      expect(sessions[0].messages.map(m => m.id)).toEqual(['row-2', 'row-1']);
    });

    it("adds one message to the turn's chat with the server words set apart", async () => {
      const release = failWhenReleased();
      const result = renderSession();
      let sending!: Promise<unknown>;
      act(() => {
        sending = result.current.handleSendPress(textMessage);
      });
      await waitFor(() => expect(sessions[0].messages).toHaveLength(2));

      chatSessionStore.activeSessionId = 'T';
      await act(async () => {
        release(new RemoteModelNotReadyError('load-failed', 'out of memory'));
        await sending;
      });

      const text = `${l10n.en.settings.routerModels.loadFailed}\n\n“out of memory”`;
      expect(chatSessionStore.addMessageToSession).toHaveBeenCalledTimes(1);
      expect(chatSessionStore.addMessageToSession).toHaveBeenCalledWith(
        'S',
        expect.objectContaining({text, metadata: {system: true}}),
      );
      expect(
        addToCurrent.mock.calls.filter(([m]) => m.metadata?.system),
      ).toEqual([]);
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(text);
      expect(sessions[0].messages.map(m => m.id)).toEqual(['row-1']);
    });

    it("adds the app's sentence alone when the server gave no words", async () => {
      const error = new RemoteModelNotReadyError('server-unreachable');
      failWith(error);

      await send();

      expect(chatSessionStore.addMessageToSession).toHaveBeenCalledWith(
        'S',
        expect.objectContaining({
          text: l10n.en.settings.routerModels.serverUnreachable,
        }),
      );
    });
  });

  it('should reset the conversation', () => {
    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    result.current.handleResetConversation();

    expect(chatSessionStore.addMessageToCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        text: l10n.en.chat.conversationReset,
        author: assistant,
      }),
    );
  });

  it('should not stop completion when inferencing is false', () => {
    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    result.current.handleStopPress();

    expect(modelStore.context?.stopCompletion).not.toHaveBeenCalled();
  });

  it('handleStopPress aborts the run and clears the run UI at once, without isStopping', async () => {
    let resolveCompletion!: (value: any) => void;
    modelStore.context!.completion = jest.fn(
      () =>
        new Promise(resolve => {
          resolveCompletion = resolve;
        }),
    ) as any;
    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    let sending!: Promise<unknown>;
    await act(async () => {
      sending = result.current.handleSendPress(textMessage);
    });
    await waitFor(() =>
      expect(modelStore.context!.completion).toHaveBeenCalled(),
    );
    expect(modelStore.inferencing).toBe(true);

    await result.current.handleStopPress();

    expect(modelStore.inferencing).toBe(false);
    expect(chatSessionStore.setIsGenerating).toHaveBeenLastCalledWith(false);
    expect(chatSessionStore.setIsStopping).not.toHaveBeenCalledWith(true);
    expect(modelStore.engine!.stopCompletion).toHaveBeenCalled();

    await act(async () => {
      resolveCompletion({text: '', content: '', interrupted: true});
      await sending;
    });
  });

  it('should set inferencing correctly during send', async () => {
    let resolveCompletion: (value: any) => void;
    const completionPromise = new Promise(resolve => {
      resolveCompletion = resolve;
    });

    if (modelStore.context) {
      modelStore.context.completion = jest
        .fn()
        .mockImplementation(() => completionPromise);
    }

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    const sendPromise = result.current.handleSendPress(textMessage);

    // Wait until inferencing flips to true (handleSendPress sets it after adding message)
    await waitFor(() => {
      expect(modelStore.inferencing).toBe(true);
    });

    // Complete the mocked completion and wait for the handler to finish
    resolveCompletion!({timings: {total: 100}, usage: {}});
    await act(async () => {
      await sendPromise;
    });
    expect(modelStore.inferencing).toBe(false);
  });

  test.each([
    {systemPrompt: undefined, shouldInclude: false, description: 'undefined'},
    {systemPrompt: '', shouldInclude: false, description: 'empty string'},
    {systemPrompt: '   ', shouldInclude: false, description: 'whitespace-only'},
    {
      systemPrompt: 'You are a helpful assistant',
      shouldInclude: true,
      description: 'valid prompt',
    },
    {
      systemPrompt: '  Trimmed prompt  ',
      shouldInclude: true,
      description: 'prompt with whitespace',
    },
  ])(
    'should handle system prompt for $description',
    async ({systemPrompt, shouldInclude}) => {
      const testModel = {
        ...mockBasicModel,
        id: 'test-model',
        chatTemplate: {...mockBasicModel.chatTemplate, systemPrompt},
      };

      modelStore.models = [testModel];
      modelStore.setActiveModel(testModel.id);

      // Mock the completion function to capture the messages passed to it
      let capturedMessages: any[] = [];
      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockImplementation((params, _onData) => {
            capturedMessages = params.messages || [];
            return Promise.resolve({timings: {total: 100}, usage: {}});
          });
      }

      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage);
      });

      if (shouldInclude && systemPrompt?.trim()) {
        // Check that a system message was included in the messages passed to completion
        expect(capturedMessages.some(msg => msg.role === 'system')).toBe(true);
        const systemMessage = capturedMessages.find(
          msg => msg.role === 'system',
        );
        expect(systemMessage.content).toBe(systemPrompt);
      } else {
        // Check that no system message was included
        expect(capturedMessages.some(msg => msg.role === 'system')).toBe(false);
      }
    },
  );

  it('should render parametrized system prompt when pal has parameters', async () => {
    // Create a mock pal with parametrized system prompt
    const mockPal = {
      id: 'test-pal-id',
      type: 'local' as const,
      name: 'Test Pal',
      systemPrompt: 'You are {{name}}, a {{role}} in {{setting}}.',
      parameters: {
        name: 'Gandalf',
        role: 'wizard',
        setting: 'Middle-earth',
      },
      parameterSchema: [
        {key: 'name', type: 'text' as const, label: 'Name', required: true},
        {key: 'role', type: 'text' as const, label: 'Role', required: true},
        {
          key: 'setting',
          type: 'text' as const,
          label: 'Setting',
          required: true,
        },
      ],
      isSystemPromptChanged: false,
      useAIPrompt: false,
      source: 'local' as const,
    };

    // Mock palStore to return our test pal
    palStore.pals = [mockPal];

    // Create a mock session with the pal
    const mockSession = {
      id: 'test-session-id',
      activePalId: 'test-pal-id',
      title: 'Test Session',
      date: new Date().toISOString().split('T')[0], // Format: YYYY-MM-DD
      messages: [],
      completionSettings: mockDefaultCompletionParams,
      settingsSource: 'pal' as const,
    };

    // Mock chatSessionStore to return our test session
    chatSessionStore.sessions = [mockSession];
    chatSessionStore.activeSessionId = 'test-session-id';

    // Mock the completion function to capture the messages passed to it
    let capturedMessages: any[] = [];
    if (modelStore.context) {
      modelStore.context.completion = jest
        .fn()
        .mockImplementation((params, _onData) => {
          capturedMessages = params.messages || [];
          return Promise.resolve({timings: {total: 100}, usage: {}});
        });
    }

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    await act(async () => {
      await result.current.handleSendPress(textMessage);
    });

    // Check that a system message was included with the rendered template
    expect(capturedMessages.some(msg => msg.role === 'system')).toBe(true);
    const systemMessage = capturedMessages.find(msg => msg.role === 'system');
    expect(systemMessage.content).toBe(
      'You are Gandalf, a wizard in Middle-earth.',
    );
  });

  it('emits multimodal warning when user sends an image but multimodal is disabled', async () => {
    if (modelStore.context) {
      modelStore.context.completion = jest
        .fn()
        .mockResolvedValue({text: 'ok', content: 'ok', timings: {}});
    }
    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );
    await act(async () => {
      await result.current.handleSendPress({
        text: 'look at this',
        type: 'text',
        imageUris: ['file:///photo.jpg'],
      });
    });
    expect(uiStore.setChatWarning).toHaveBeenCalled();
    const arg = (uiStore.setChatWarning as jest.Mock).mock.calls[0][0];
    // The warning carries the multimodalNotEnabled message text.
    expect(JSON.stringify(arg)).toContain(l10n.en.chat.multimodalNotEnabled);
  });

  it('sends an image on a remote model whose probe reported vision', async () => {
    runInAction(() => {
      modelStore.models = [
        {
          id: 'srv-1/gemma-4-e2b',
          origin: ModelOrigin.REMOTE,
          serverId: 'srv-1',
          remoteModelId: 'gemma-4-e2b',
        } as any,
      ];
      modelStore.activeModelId = 'srv-1/gemma-4-e2b';
      serverStore.remoteCaps = {'srv-1/gemma-4-e2b': {supportsVision: true}};
    });
    if (modelStore.context) {
      modelStore.context.completion = jest
        .fn()
        .mockResolvedValue({text: 'ok', content: 'ok', timings: {}});
    }

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );
    await act(async () => {
      await result.current.handleSendPress({
        text: 'look at this',
        type: 'text',
        imageUris: ['file:///photo.jpg'],
      });
    });

    const sent = (modelStore.engine!.completion as jest.Mock).mock
      .calls[0][0] as {messages: Array<{role: string; content: any}>};
    const lastUser = [...sent.messages].reverse().find(m => m.role === 'user')!;
    expect(lastUser.content).toEqual(
      expect.arrayContaining([
        {type: 'image_url', image_url: {url: 'file:///photo.jpg'}},
      ]),
    );

    const warnings = (uiStore.setChatWarning as jest.Mock).mock.calls;
    expect(
      warnings.some(call =>
        JSON.stringify(call[0]).includes(l10n.en.chat.multimodalNotEnabled),
      ),
    ).toBe(false);

    runInAction(() => {
      serverStore.remoteCaps = {};
      modelStore.activeModelId = undefined;
    });
  });

  describe('a camera turn', () => {
    const frameRow = (id: string, url: string) =>
      ({
        id,
        author: textMessage.author,
        type: 'text',
        text: `what is in ${id}`,
        imageUris: [url],
      }) as MessageType.Text;

    const withHistory = (messages: MessageType.Any[]) => {
      const original = Object.getOwnPropertyDescriptor(
        chatSessionStore,
        'currentSessionMessages',
      );
      Object.defineProperty(chatSessionStore, 'currentSessionMessages', {
        get: () => messages,
        configurable: true,
      });
      return () => {
        if (original) {
          Object.defineProperty(
            chatSessionStore,
            'currentSessionMessages',
            original,
          );
        }
      };
    };

    // The projector re-encodes every media part in the prompt, so the number of
    // frames in what was sent is the number of frames a turn pays for.
    const sendFrame = async (spoken: boolean) => {
      runInAction(() => {
        modelStore.models = [
          {
            id: 'srv-1/gemma-4-e2b',
            origin: ModelOrigin.REMOTE,
            serverId: 'srv-1',
            remoteModelId: 'gemma-4-e2b',
          } as any,
        ];
        modelStore.activeModelId = 'srv-1/gemma-4-e2b';
        serverStore.remoteCaps = {'srv-1/gemma-4-e2b': {supportsVision: true}};
      });
      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockResolvedValue({text: 'ok', content: 'ok', timings: {}});
      }
      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );
      await act(async () => {
        await result.current.handleSendPress(
          {text: 'look at this', type: 'text', imageUris: ['file:///new.jpg']},
          {spoken},
        );
      });
      const sent = (modelStore.engine!.completion as jest.Mock).mock
        .calls[0][0] as {messages: Array<{role: string; content: any}>};
      runInAction(() => {
        serverStore.remoteCaps = {};
        modelStore.activeModelId = undefined;
      });
      return sent.messages;
    };

    const framesIn = (messages: Array<{role: string; content: any}>) =>
      messages.flatMap(message =>
        Array.isArray(message.content)
          ? message.content
              .filter(part => part.type === 'image_url')
              .map(part => part.image_url.url)
          : [],
      );

    it('speaks from the frame it was sent, not the ones already answered', async () => {
      const restore = withHistory([
        frameRow('shot-1', 'file:///old.jpg'),
        {
          id: 'answer-1',
          author: assistant,
          type: 'text',
          text: 'A kettle on the stove.',
        } as MessageType.Text,
      ]);
      try {
        const messages = await sendFrame(true);
        expect(framesIn(messages)).toEqual(['file:///new.jpg']);
        expect(messages.some(m => m.content === 'A kettle on the stove.')).toBe(
          true,
        );
      } finally {
        restore();
      }
    });

    it('keeps every frame of a typed chat in view', async () => {
      const restore = withHistory([frameRow('shot-1', 'file:///old.jpg')]);
      try {
        const messages = await sendFrame(false);
        expect(framesIn(messages).sort()).toEqual(
          ['file:///new.jpg', 'file:///old.jpg'].sort(),
        );
      } finally {
        restore();
      }
    });

    const voiceRow = (id: string) =>
      ({
        id,
        author: textMessage.author,
        type: 'text',
        text: '',
        audioUri: `/voice-audio/${id}.wav`,
      }) as MessageType.Text;

    const audioIn = (messages: Array<{role: string; content: any}>) =>
      messages.flatMap(message =>
        Array.isArray(message.content)
          ? message.content.filter(part => part.type === 'input_audio')
          : [],
      );

    // A clip the model has already heard is not worth a second encoding: it
    // costs the turn its first token time and answers a question it was not
    // asked. The row still has to reach the prompt, or the model finds its own
    // last reply with no question in front of it.
    it.each([true, false])(
      'never replays an answered clip to a %s turn',
      async spoken => {
        const restore = withHistory([
          voiceRow('utt-1'),
          {
            id: 'answer-1',
            author: assistant,
            type: 'text',
            text: 'A kettle on the stove.',
          } as MessageType.Text,
        ]);
        try {
          const messages = await sendFrame(spoken);

          expect(audioIn(messages)).toEqual([]);
          expect(messages.some(m => m.content === '[voice message]')).toBe(
            true,
          );
        } finally {
          restore();
        }
      },
    );
    // An assistant row the app judged to be a repeat of its own question is
    // poison for the next turn: left in the history it is an example that says
    // restating the question is how you answer. The row stays in the chat the
    // user reads; it does not reach the model.
    it('keeps a turn marked as an echo out of the next prompt', async () => {
      const restore = withHistory([
        voiceRow('utt-1'),
        {
          id: 'echo-1',
          author: assistant,
          type: 'assistant_turn',
          steps: [{content: 'what is the weather like'}],
          metadata: {echoExcluded: true},
        } as MessageType.AssistantTurn,
        {
          id: 'kept-1',
          author: assistant,
          type: 'assistant_turn',
          steps: [{content: 'A kettle on the stove.'}],
          metadata: {},
        } as MessageType.AssistantTurn,
      ]);
      try {
        const sent = JSON.stringify(await sendFrame(false));

        expect(sent).toContain('A kettle on the stove.');
        expect(sent).not.toContain('what is the weather like');
      } finally {
        restore();
      }
    });

    it('a spoken turn with no clip to answer sends the words it was given', async () => {
      const restore = withHistory([]);
      try {
        const messages = await sendFrame(true);

        // A camera turn has its own text, so nothing is invented for it: the
        // instruction belongs to a turn that reaches the model with no words.
        const parts = lastUserParts(messages);
        expect(textPartsOf(parts)).toEqual(['look at this']);
        expect(audioPartsOf(parts)).toEqual([]);
      } finally {
        restore();
      }
    });
  });

  describe('a spoken turn that carries a clip', () => {
    const omniModel = {
      ...mockBasicModel,
      id: 'omni-1',
      origin: ModelOrigin.LOCAL,
      isLocal: true,
      mediaSupport: {vision: false, audioInput: true, audioOutput: true},
    } as any;

    const sendClip = async (text: string, reply = 'ok') => {
      runInAction(() => {
        modelStore.models = [omniModel];
        modelStore.activeModelId = omniModel.id;
        modelStore.isMultimodalActive = true;
      });
      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockResolvedValue({text: reply, content: reply, timings: {}});
      }
      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );
      await act(async () => {
        await result.current.handleSendPress(
          {
            id: 'utt-9',
            author: textMessage.author,
            type: 'text',
            text,
            audioUri: '/voice-audio/utt-9.wav',
          } as MessageType.Text,
          {spoken: true},
        );
      });
      const sent = (modelStore.engine!.completion as jest.Mock).mock
        .calls[0][0] as {messages: Array<{role: string; content: any}>};
      runInAction(() => {
        modelStore.models = modelsList as any;
        modelStore.activeModelId = undefined;
        modelStore.isMultimodalActive = false;
      });
      const rows = (
        chatSessionStore.addMessageToCurrentSession as jest.Mock
      ).mock.calls.map(([row]) => row);
      // What the row ends up carrying: every write merges into metadata, in
      // whatever order the turn made them.
      const metadata = (
        chatSessionStore.updateMessage as jest.Mock
      ).mock.calls.reduce(
        (acc: Record<string, any>, [, , patch]) => ({
          ...acc,
          ...(patch?.metadata ?? {}),
        }),
        {},
      );
      return {
        messages: sent.messages,
        userRow: rows.find(row => row.author?.id !== mockAssistant.id),
        metadata,
      };
    };

    it('answers the clip instead of reading it back', async () => {
      const {messages} = await sendClip('');
      const parts = lastUserParts(messages);

      expect(audioPartsOf(parts)).toHaveLength(1);
      // The instruction rides the user turn, beside the audio, because that is
      // where a model trained to transcribe an input looks for what to do with
      // it. The system prompt keeps only the short-answer rule.
      expect(textPartsOf(parts)).toEqual([VOICE_AUDIO_INSTRUCTION]);
      expect(promptOf(messages)).not.toContain(VOICE_AUDIO_INSTRUCTION);
    });

    it('keeps the row empty so the bubble keeps its label', async () => {
      const {messages, userRow} = await sendClip('');

      expect(userRow.text).toBe('');
      expect(userRow.audioUri).toBe('/voice-audio/utt-9.wav');
      expect(
        lastUserParts(messages).some(
          part => part.type === 'text' && part.text === '',
        ),
      ).toBe(false);
    });

    it('leaves a dictated turn the words it was sent with', async () => {
      const {messages} = await sendClip('turn the heating on');

      expect(textPartsOf(lastUserParts(messages))).toEqual([
        'turn the heating on',
      ]);
    });

    // The write side of the same rule: an omni voice turn has no transcript to
    // diff against, so the reply that reports the speaker is caught by its
    // shape. Marked here, filtered out of every later prompt.
    it('marks a reply that reports the speaker instead of answering', async () => {
      const {metadata} = await sendClip(
        '',
        'The user asked what the weather is like.',
      );

      expect(metadata.echoExcluded).toBe(true);
    });

    it('leaves a reply that answers the clip unmarked', async () => {
      const {metadata} = await sendClip('', 'It is raining in Tashkent.');

      expect(metadata.echoExcluded).toBeUndefined();
    });
  });

  it('should use system prompt as-is when pal has no parameters', async () => {
    // Create a mock pal without parameters
    const mockPal = {
      id: 'test-pal-id-no-params',
      type: 'local' as const,
      name: 'Test Pal No Params',
      systemPrompt: 'You are a helpful assistant.',
      parameters: {},
      parameterSchema: [],
      isSystemPromptChanged: false,
      useAIPrompt: false,
      source: 'local' as const,
    };

    // Mock palStore to return our test pal
    palStore.pals = [mockPal];

    // Create a mock session with the pal
    const mockSession = {
      id: 'test-session-id-no-params',
      activePalId: 'test-pal-id-no-params',
      title: 'Test Session No Params',
      date: new Date().toISOString().split('T')[0], // Format: YYYY-MM-DD
      messages: [],
      completionSettings: mockDefaultCompletionParams,
      settingsSource: 'pal' as const,
    };

    // Mock chatSessionStore to return our test session
    chatSessionStore.sessions = [mockSession];
    chatSessionStore.activeSessionId = 'test-session-id-no-params';

    // Mock the completion function to capture the messages passed to it
    let capturedMessages: any[] = [];
    if (modelStore.context) {
      modelStore.context.completion = jest
        .fn()
        .mockImplementation((params, _onData) => {
          capturedMessages = params.messages || [];
          return Promise.resolve({timings: {total: 100}, usage: {}});
        });
    }

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    await act(async () => {
      await result.current.handleSendPress(textMessage);
    });

    // Check that a system message was included with the original prompt
    expect(capturedMessages.some(msg => msg.role === 'system')).toBe(true);
    const systemMessage = capturedMessages.find(msg => msg.role === 'system');
    expect(systemMessage.content).toBe('You are a helpful assistant.');
  });

  describe('search grounding', () => {
    const webSearchTool = {
      type: 'function',
      function: {name: 'web_search', description: '', parameters: {}},
    };

    const activateSearchTools = async () => {
      const baseSettings =
        await chatSessionStore.getCurrentCompletionSettings();
      (
        chatSessionStore.getCurrentCompletionSettings as jest.Mock
      ).mockResolvedValueOnce({...baseSettings, tools: [webSearchTool]});
    };

    const useSessionWithPal = (systemPrompt: string) => {
      const pal = {
        id: 'search-pal-id',
        type: 'local' as const,
        name: 'Search Pal',
        systemPrompt,
        parameters: {},
        parameterSchema: [],
        isSystemPromptChanged: false,
        useAIPrompt: false,
        source: 'local' as const,
      };
      palStore.pals = [pal];
      chatSessionStore.sessions = [
        {
          id: 'search-session-id',
          activePalId: pal.id,
          title: 'Search Session',
          date: new Date().toISOString().split('T')[0],
          messages: [],
          completionSettings: mockDefaultCompletionParams,
          settingsSource: 'pal' as const,
        },
      ];
      chatSessionStore.activeSessionId = 'search-session-id';
      return pal;
    };

    const captureMessages = () => {
      const captured: {messages: any[]} = {messages: []};
      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockImplementation((params, _onData) => {
            captured.messages = params.messages || [];
            return Promise.resolve({timings: {total: 100}, usage: {}});
          });
      }
      return captured;
    };

    const send = async () => {
      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );
      await act(async () => {
        await result.current.handleSendPress(textMessage);
      });
    };

    // Strict templates reject a second system message ("must be at the
    // beginning"), so grounding folds into the pal's system message.
    it('sends exactly one system message carrying both the pal prompt and the grounding', async () => {
      const pal = useSessionWithPal('You are a research assistant.');
      await activateSearchTools();
      const captured = captureMessages();

      await send();

      const systemMessages = captured.messages.filter(
        msg => msg.role === 'system',
      );
      expect(systemMessages).toHaveLength(1);

      const today = new Date().toISOString().slice(0, 10);
      expect(systemMessages[0].content).toContain(
        'You are a research assistant.',
      );
      expect(systemMessages[0].content).toContain(`Today's date is ${today}`);
      expect(systemMessages[0].content).toContain('web_search');

      // Composition happens at assembly time only.
      expect(pal.systemPrompt).toBe('You are a research assistant.');
    });

    it('sends the grounding as the sole system message when the pal has no system prompt', async () => {
      useSessionWithPal('');
      await activateSearchTools();
      const captured = captureMessages();

      await send();

      const systemMessages = captured.messages.filter(
        msg => msg.role === 'system',
      );
      expect(systemMessages).toHaveLength(1);

      const today = new Date().toISOString().slice(0, 10);
      expect(systemMessages[0].content).toContain(`Today's date is ${today}`);
      expect(systemMessages[0].content).toContain('web_search');
    });

    it('leaves the pal system message alone when no search tools are active', async () => {
      useSessionWithPal('You are a research assistant.');
      const captured = captureMessages();

      await send();

      const systemMessages = captured.messages.filter(
        msg => msg.role === 'system',
      );
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0].content).toBe('You are a research assistant.');
    });

    it('seeds the read_url allowlist from URLs the user wrote', async () => {
      useSessionWithPal('');
      await activateSearchTools();
      captureMessages();

      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );
      await act(async () => {
        await result.current.handleSendPress({
          ...textMessage,
          text: 'summarize https://user.example.com/doc please',
        });
      });

      expect(isReadUrlAllowed('https://user.example.com/doc')).toBe(true);
      expect(isReadUrlAllowed('https://other.example.com/x')).toBe(false);
    });
  });

  it('omits the search grounding line when no search tools are active', async () => {
    let capturedMessages: any[] = [];
    if (modelStore.context) {
      modelStore.context.completion = jest
        .fn()
        .mockImplementation((params, _onData) => {
          capturedMessages = params.messages || [];
          return Promise.resolve({timings: {total: 100}, usage: {}});
        });
    }

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );

    await act(async () => {
      await result.current.handleSendPress(textMessage);
    });

    expect(
      capturedMessages.some(
        msg =>
          msg.role === 'system' &&
          typeof msg.content === 'string' &&
          msg.content.includes("Today's date is"),
      ),
    ).toBe(false);
  });

  describe('TTS streaming wiring', () => {
    beforeEach(() => {
      // Hook is gated on ttsStore.streamsReplies (false in the mock by
      // default); open the gate and opt in for tests that assert it fires.
      (ttsStore as any).userTTSOverride = true;
      (ttsStore as any).autoSpeakEnabled = true;
    });

    afterEach(() => {
      (ttsStore as any).userTTSOverride = null;
      (ttsStore as any).autoSpeakEnabled = false;
    });

    it('fires onAssistantMessageStart on first token and onAssistantMessageChunk per delta', async () => {
      const finalText = 'Hello world.';

      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockImplementation(async (_params, onData) => {
            if (onData) {
              // First chunk — should trigger start + first chunk
              onData({token: 'tok', content: 'Hello '});
              // Second chunk — cumulative content; delta is "world."
              onData({token: 'tok', content: 'Hello world.'});
            }
            return {
              timings: {total: 100},
              usage: {},
              text: finalText,
              content: finalText,
              reasoning_content: '',
            };
          });
      }

      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage);
      });

      expect(ttsStore.onAssistantMessageStart).toHaveBeenCalledTimes(1);
      expect(ttsStore.onAssistantMessageChunk).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        'Hello ',
        undefined,
      );
      expect(ttsStore.onAssistantMessageChunk).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        'world.',
        undefined,
      );
    });

    it('Case A: forwards reasoning_content deltas and hadReasoning on complete', async () => {
      const finalText = 'Final answer.';

      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockImplementation(async (_params, onData) => {
            if (onData) {
              // Reasoning-only chunks (model thinking).
              onData({token: 'tok', content: '', reasoning_content: 'Let me '});
              onData({
                token: 'tok',
                content: '',
                reasoning_content: 'Let me think.',
              });
              // Real content begins.
              onData({
                token: 'tok',
                content: 'Final answer.',
                reasoning_content: 'Let me think.',
              });
            }
            return {
              timings: {total: 100},
              usage: {},
              text: finalText,
              content: finalText,
              reasoning_content: 'Let me think.',
            };
          });
      }

      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage);
      });

      // Reasoning deltas arrive as the 3rd arg with empty content delta.
      expect(ttsStore.onAssistantMessageChunk).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        '',
        'Let me ',
      );
      expect(ttsStore.onAssistantMessageChunk).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        '',
        'think.',
      );
      expect(ttsStore.onAssistantMessageChunk).toHaveBeenNthCalledWith(
        3,
        expect.any(String),
        'Final answer.',
        undefined,
      );
      expect(ttsStore.onAssistantMessageComplete).toHaveBeenCalledWith(
        expect.any(String),
        finalText,
        {hadReasoning: true},
      );
    });

    it('fires ttsStore.onAssistantMessageComplete exactly once after completion', async () => {
      const finalText = 'the-final-text';

      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockImplementation(async (_params, onData) => {
            if (onData) {
              onData({token: 'partial', content: finalText});
            }
            return {
              timings: {total: 100},
              usage: {},
              text: finalText,
              content: finalText,
              reasoning_content: '',
            };
          });
      }

      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage);
      });

      expect(ttsStore.onAssistantMessageComplete).toHaveBeenCalledTimes(1);
      expect(ttsStore.onAssistantMessageComplete).toHaveBeenCalledWith(
        expect.any(String),
        finalText,
        {hadReasoning: false},
      );
    });

    it('a throwing onAssistantMessageStart/Chunk does NOT kill the completion stream', async () => {
      const finalText = 'All good, final text.';

      (ttsStore.onAssistantMessageStart as jest.Mock).mockImplementationOnce(
        () => {
          throw new Error('tts start boom');
        },
      );
      (ttsStore.onAssistantMessageChunk as jest.Mock).mockImplementation(() => {
        throw new Error('tts chunk boom');
      });

      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockImplementation(async (_params, onData) => {
            if (onData) {
              onData({token: 'tok', content: 'All good, '});
              onData({token: 'tok', content: finalText});
            }
            return {
              timings: {total: 100},
              usage: {},
              text: finalText,
              content: finalText,
              reasoning_content: '',
            };
          });
      }

      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      // No throw expected — try/catch wraps the TTS hooks.
      await act(async () => {
        await result.current.handleSendPress(textMessage);
      });

      // Stream completed normally despite the TTS exceptions.
      expect(modelStore.context?.completion).toHaveBeenCalled();
      expect(ttsStore.onAssistantMessageComplete).toHaveBeenCalledWith(
        expect.any(String),
        finalText,
        {hadReasoning: false},
      );
    });

    it('a throwing onAssistantMessageComplete does NOT bubble out of handleSendPress', async () => {
      const finalText = 'done';

      (ttsStore.onAssistantMessageComplete as jest.Mock).mockImplementationOnce(
        () => {
          throw new Error('tts complete boom');
        },
      );

      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockImplementation(async (_params, onData) => {
            if (onData) {
              onData({token: 'tok', content: finalText});
            }
            return {
              timings: {total: 100},
              usage: {},
              text: finalText,
              content: finalText,
              reasoning_content: '',
            };
          });
      }

      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await expect(
        act(async () => {
          await result.current.handleSendPress(textMessage);
        }),
      ).resolves.not.toThrow();
    });

    it('does NOT fire onAssistantMessageComplete on error paths', async () => {
      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockRejectedValueOnce(new Error('boom'));
      }

      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage);
      });

      expect(ttsStore.onAssistantMessageComplete).not.toHaveBeenCalled();
    });

    it('skips per-chunk TTS hooks entirely when autoSpeakEnabled is off', async () => {
      // Override the beforeEach default for this single test.
      (ttsStore as any).autoSpeakEnabled = false;

      const finalText = 'one two three';
      if (modelStore.context) {
        modelStore.context.completion = jest
          .fn()
          .mockImplementation(async (_params, onData) => {
            if (onData) {
              onData({token: 'tok', content: 'one '});
              onData({token: 'tok', content: 'one two '});
              onData({token: 'tok', content: finalText});
            }
            return {
              timings: {total: 100},
              usage: {},
              text: finalText,
              content: finalText,
              reasoning_content: '',
            };
          });
      }

      const {result} = renderHook(() =>
        useChatSession({current: null}, textMessage.author, mockAssistant),
      );

      await act(async () => {
        await result.current.handleSendPress(textMessage);
      });

      expect(ttsStore.onAssistantMessageStart).not.toHaveBeenCalled();
      expect(ttsStore.onAssistantMessageChunk).not.toHaveBeenCalled();
    });
  });
});

/**
 * The one right the context has.
 *
 * The bridge holds a native `ContextClaim` per operation and throws
 * `Context is busy` at a second taker instead of queueing, so a turn that
 * arrives while the model is still voicing its last reply never begins. That
 * is not an answer to keep: it is a question to ask again once the right is
 * back, with nothing left in the history.
 */
describe('a turn the context refused as busy', () => {
  const addedRows = () =>
    (chatSessionStore.addMessageToCurrentSession as jest.Mock).mock.calls.map(
      ([row]) => row,
    );
  const completion = () => modelStore.engine!.completion as jest.Mock;
  const busy = () => new Error('Exception in HostFunction: Context is busy');

  it('runs the turn only after the model has stopped speaking', async () => {
    // A previous reply still being voiced when this question arrives.
    const speaking = await modelStore.acquireGeneration('speech');
    setTimeout(() => speaking!.end(), 10);

    let holderWhenSent = 'speech';
    const delegate = completion();
    delegate.mockImplementationOnce(async (params, onData) => {
      holderWhenSent = String(modelStore.generationHolder);
      return delegate(params, onData);
    });

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );
    await act(async () => {
      await result.current.handleSendPress(textMessage, {spoken: true});
    });

    expect(holderWhenSent).toBe('completion');
    expect(modelStore.generationHolder).toBeNull();
  });

  it('keeps nothing of a refused turn and asks it once more', async () => {
    const delegate = completion();
    delegate.mockRejectedValueOnce(busy());
    // Read the moment the retry asks: this is the refused attempt's rollback,
    // counted before anything a later attempt might clean up of its own.
    let deletedBeforeRetry = -1;
    delegate.mockImplementationOnce(async (_params: any, onData: any) => {
      deletedBeforeRetry = (
        chatSessionStore.deleteMessageFromSession as jest.Mock
      ).mock.calls.length;
      onData?.({token: 'tok', content: 'Salom'});
      return {
        timings: {total: 10},
        usage: {},
        text: 'Salom',
        content: 'Salom',
        reasoning_content: '',
      };
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );
    let undone: any;
    await act(async () => {
      undone = await result.current.handleSendPress(textMessage, {
        spoken: true,
      });
    });

    // The retry, not a second refusal: the question was answered on the retry.
    expect(delegate).toHaveBeenCalledTimes(2);
    // Neither half of the failed attempt is left in the chat — the empty
    // answer the prompt never filled, and the question it failed to answer.
    expect(deletedBeforeRetry).toBe(2);
    for (const row of addedRows()) {
      expect(String(row.text ?? '')).not.toMatch(/Completion failed/i);
      expect(row.metadata?.system).toBeUndefined();
    }
    expect(undone).toBeUndefined();
    error.mockRestore();
  });

  it('calls a second refusal a real failure, and stops retrying', async () => {
    completion().mockRejectedValue(busy());
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );
    let undone: any;
    await act(async () => {
      undone = await result.current.handleSendPress(textMessage, {
        spoken: true,
      });
    });

    expect(completion()).toHaveBeenCalledTimes(2);
    expect(undone).toEqual(expect.objectContaining({reason: 'claim_busy'}));
    error.mockRestore();
  });

  it('holds the right for the whole turn and gives it back after', async () => {
    let holderWhileRunning: string = 'none';
    let busyWhileRunning = false;
    completion().mockImplementationOnce(async () => {
      holderWhileRunning = String(modelStore.generationHolder);
      busyWhileRunning = modelStore.isGenerationBusy;
      throw busy();
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const {result} = renderHook(() =>
      useChatSession({current: null}, textMessage.author, mockAssistant),
    );
    await act(async () => {
      await result.current.handleSendPress(textMessage);
    });

    expect(holderWhileRunning).toBe('completion');
    expect(busyWhileRunning).toBe(true);
    expect(modelStore.generationHolder).toBeNull();
    expect(modelStore.isGenerationBusy).toBe(false);
    error.mockRestore();
  });
});
