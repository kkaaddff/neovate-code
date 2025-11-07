import type { Context } from './context';
import { JsonlLogger, RequestLogger } from './jsonl';
import { LlmsContext } from './llmsContext';
import { runLoop, type StreamResult } from './loop';
import type { ImagePart, NormalizedMessage, UserContent } from './message';
import { resolveModelWithContext } from './model';
import { generatePlanSystemPrompt } from './planSystemPrompt';
import { Session, SessionConfigManager, type SessionId } from './session';
import { generateSystemPrompt } from './systemPrompt';
import type { ApprovalCategory, Tool, ToolUse } from './tool';
import { resolveTools, Tools } from './tool';
import { randomUUID } from './utils/randomUUID';

export type ProjectTaskKind = 'send' | 'plan';

export type ProjectTaskCallbacks = {
  onMessage?: (opts: { message: NormalizedMessage }) => Promise<void>;
  onToolApprove?: (opts: {
    toolUse: ToolUse;
    category?: ApprovalCategory;
  }) => Promise<boolean>;
  onTextDelta?: (text: string) => Promise<void>;
  onChunk?: (chunk: any, requestId: string) => Promise<void>;
  onStreamResult?: (result: StreamResult) => Promise<void>;
};

export type ProjectTaskOptions = ProjectTaskCallbacks & {
  kind: ProjectTaskKind;
  context: Context;
  session: Session;
  message: string | null;
  model?: string;
  signal?: AbortSignal;
  attachments?: ImagePart[];
  parentUuid?: string;
  thinking?: {
    effort: 'low' | 'medium' | 'high';
  };
};

export class Project {
  session: Session;
  context: Context;
  constructor(opts: { sessionId?: SessionId; context: Context }) {
    this.session = opts.sessionId
      ? Session.resume({
          id: opts.sessionId,
          logPath: opts.context.paths.getSessionLogPath(opts.sessionId),
        })
      : Session.create();
    this.context = opts.context;
  }

  async send(
    message: string | null,
    opts: Omit<
      ProjectTaskOptions,
      'kind' | 'context' | 'session' | 'message'
    > = {},
  ) {
    return executeProjectTask({
      ...opts,
      kind: 'send',
      context: this.context,
      session: this.session,
      message,
    });
  }

  async plan(
    message: string | null,
    opts: Omit<
      ProjectTaskOptions,
      'kind' | 'context' | 'session' | 'message'
    > = {},
  ) {
    return executeProjectTask({
      ...opts,
      kind: 'plan',
      context: this.context,
      session: this.session,
      message,
    });
  }
}

type TaskEnvironment = {
  tools: Tool[];
  systemPrompt?: string;
  defaultModel?: string | null;
  autoApproveTools: boolean;
};

type ResolvedProjectTaskOptions = ProjectTaskOptions & TaskEnvironment;

export async function executeProjectTask(opts: ProjectTaskOptions) {
  const environment = await resolveTaskEnvironment(opts);
  return runWithResolvedEnvironment({
    ...opts,
    ...environment,
  });
}

async function resolveTaskEnvironment(
  opts: ProjectTaskOptions,
): Promise<TaskEnvironment> {
  const isPlan = opts.kind === 'plan';
  let tools = await resolveTools({
    context: opts.context,
    sessionId: opts.session.id,
    write: !isPlan,
    todo: !isPlan,
  });

  let systemPrompt: string;
  if (isPlan) {
    systemPrompt = generatePlanSystemPrompt({
      todo: opts.context.config.todo!,
      productName: opts.context.productName,
      language: opts.context.config.language,
    });
  } else {
    systemPrompt = generateSystemPrompt({
      todo: opts.context.config.todo!,
      productName: opts.context.productName,
      language: opts.context.config.language,
    });
  }

  return {
    tools,
    systemPrompt,
    defaultModel: isPlan
      ? opts.context.config.planModel
      : opts.context.config.model,
    autoApproveTools: isPlan,
  };
}

async function runWithResolvedEnvironment(opts: ResolvedProjectTaskOptions) {
  const startTime = new Date();
  const tools = opts.tools || [];
  const jsonlLogger = new JsonlLogger({
    filePath: opts.context.paths.getSessionLogPath(opts.session.id),
  });
  const requestLogger = new RequestLogger({
    globalProjectDir: opts.context.paths.globalProjectDir,
  });

  const message = opts.message;

  const model = (
    await resolveModelWithContext(
      opts.model ?? opts.defaultModel ?? null,
      opts.context,
    )
  ).model!;

  const llmsContext = await LlmsContext.create({
    context: opts.context,
    sessionId: opts.session.id,
    userPrompt: message,
  });

  let userMessage: NormalizedMessage | null = null;
  if (message !== null) {
    const lastMessageUuid =
      opts.parentUuid ||
      opts.session.history.messages[opts.session.history.messages.length - 1]
        ?.uuid;

    let content: UserContent = message;
    if (opts.attachments?.length) {
      content = [
        {
          type: 'text' as const,
          text: message,
        },
        ...opts.attachments,
      ];
    }

    userMessage = {
      parentUuid: lastMessageUuid || null,
      uuid: randomUUID(),
      role: 'user',
      content,
      type: 'message',
      timestamp: new Date().toISOString(),
    };
    const userMessageWithSessionId = {
      ...userMessage,
      sessionId: opts.session.id,
    };
    jsonlLogger.addMessage({
      message: userMessageWithSessionId,
    });
    await opts.onMessage?.({
      message: userMessage,
    });
  }
  const historyMessages = opts.parentUuid
    ? opts.session.history.getMessagesToUuid(opts.parentUuid)
    : opts.session.history.messages;
  const input =
    historyMessages.length > 0
      ? [...historyMessages, userMessage]
      : [userMessage];
  const filteredInput = input.filter((message) => message !== null);
  const toolsManager = new Tools(tools);
  const result = await runLoop({
    input: filteredInput,
    model,
    tools: toolsManager,
    cwd: opts.context.cwd,
    systemPrompt: opts.systemPrompt,
    llmsContexts: llmsContext.messages,
    signal: opts.signal,
    autoCompact: opts.context.config.autoCompact,
    thinking: opts.thinking,
    onMessage: async (message) => {
      const normalizedMessage = {
        ...message,
        sessionId: opts.session.id,
      };
      jsonlLogger.addMessage({
        message: normalizedMessage,
      });
      await opts.onMessage?.({
        message: normalizedMessage,
      });
    },
    onTextDelta: async (text) => {
      await opts.onTextDelta?.(text);
    },
    onStreamResult: async (result) => {
      requestLogger.logMetadata({
        requestId: result.requestId,
        prompt: result.prompt,
        model: result.model,
        tools: result.tools,
        request: result.request,
        response: result.response,
        error: result.error,
      });
      await opts.onStreamResult?.(result);
    },
    onChunk: async (chunk, requestId) => {
      requestLogger.logChunk(requestId, chunk);
      await opts.onChunk?.(chunk, requestId);
    },
    onText: async () => {},
    onReasoning: async () => {},
    onToolUse: async (toolUse) => toolUse,
    onToolResult: async (_toolUse, toolResult) => toolResult,
    onToolApprove: async (toolUse) => {
      return await handleToolApproval({
        toolUse,
        toolsManager,
        context: opts.context,
        session: opts.session,
        autoApprove: opts.autoApproveTools,
        callbacks: opts,
      });
    },
  });
  const endTime = new Date();
  if (result.success && result.data.history) {
    opts.session.updateHistory(result.data.history);
  }
  return result;
}

type ToolApprovalOpts = {
  toolUse: ToolUse;
  toolsManager: Tools;
  context: Context;
  session: Session;
  autoApprove: boolean;
  callbacks: ProjectTaskCallbacks;
};

async function handleToolApproval(opts: ToolApprovalOpts): Promise<boolean> {
  if (opts.autoApprove) {
    const tool = opts.toolsManager.get(opts.toolUse.name);
    return (
      (await opts.callbacks.onToolApprove?.({
        toolUse: opts.toolUse,
        category: tool?.approval?.category,
      })) ?? true
    );
  }
  const approvalMode = opts.context.config.approvalMode;
  if (approvalMode === 'yolo') {
    return true;
  }
  const tool = opts.toolsManager.get(opts.toolUse.name);
  if (!tool) {
    return true;
  }
  if (tool.approval?.category === 'read') {
    return true;
  }
  const needsApproval = tool.approval?.needsApproval;
  if (needsApproval) {
    const needsApprovalResult = await needsApproval({
      toolName: opts.toolUse.name,
      params: opts.toolUse.params,
      approvalMode,
      context: opts.context,
    });
    if (!needsApprovalResult) {
      return true;
    }
  }
  const sessionConfigManager = new SessionConfigManager({
    logPath: opts.context.paths.getSessionLogPath(opts.session.id),
  });
  if (tool.approval?.category === 'write') {
    if (
      sessionConfigManager.config.approvalMode === 'autoEdit' ||
      approvalMode === 'autoEdit'
    ) {
      return true;
    }
  }
  if (sessionConfigManager.config.approvalTools.includes(opts.toolUse.name)) {
    return true;
  }
  return (
    (await opts.callbacks.onToolApprove?.({
      toolUse: opts.toolUse,
      category: tool.approval?.category,
    })) ?? false
  );
}
