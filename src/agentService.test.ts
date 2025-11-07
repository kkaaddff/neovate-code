import fs from 'fs';
import os from 'os';
import path from 'pathe';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createAgentService } from './agentService';
import * as modelModule from './model';
import * as loopModule from './loop';

describe('AgentService integration', () => {
  const dummyModel = {
    provider: { id: 'openai', name: 'OpenAI' },
    model: {
      id: 'stub',
      reasoning: false,
      limit: { context: 1024, output: 512 },
    },
    m: {} as any,
  };

  let projectDir: string;
  let homeDir: string;
  let originalHome: string | undefined;
  let runLoopSpy: any;
  let resolveModelSpy: any;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-service-repo-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-service-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = homeDir;
    resolveModelSpy = vi
      .spyOn(modelModule, 'resolveModelWithContext')
      .mockResolvedValue({ model: dummyModel });
    runLoopSpy = vi
      .spyOn(loopModule, 'runLoop')
      .mockImplementation(async (opts) => {
        await opts.onMessage?.({
          role: 'assistant',
          content: 'done',
          type: 'message',
          timestamp: new Date().toISOString(),
          uuid: 'assistant-1',
          parentUuid: null,
          text: 'done',
          model: 'stub',
          usage: { input_tokens: 1, output_tokens: 1 },
        } as any);
        await opts.onTextDelta?.('delta');
        await opts.onChunk?.({ chunk: 'data' }, 'req-1');
        await opts.onStreamResult?.({
          requestId: 'req-1',
          prompt: [] as any,
          model: dummyModel,
          tools: [],
        });
        await opts.onToolApprove?.({
          name: 'write',
          params: { file_path: 'tmp.txt', content: 'hello' },
          callId: 'call-1',
        });
        return {
          success: true,
          data: {
            text: 'done',
            history: { messages: [] },
            usage: { promptTokens: 1, completionTokens: 1 },
          },
          metadata: { turnsCount: 1, toolCallsCount: 0, duration: 1 },
        };
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    if (projectDir && fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    if (homeDir && fs.existsSync(homeDir)) {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('runs send and plan end-to-end with callback hooks', async () => {
    const service = await createAgentService({
      cwd: projectDir,
      productName: 'NEOVATE',
      version: '0.0.0-test',
      configOverrides: {
        model: 'gpt-4o',
        planModel: 'gpt-4o',
      },
    });

    const callbacks = {
      onMessage: vi.fn(async () => {}),
      onToolApprove: vi.fn(async () => true),
      onTextDelta: vi.fn(async () => {}),
      onChunk: vi.fn(async () => {}),
      onStreamResult: vi.fn(async () => {}),
    };

    const sendResult = await service.send('build feature', callbacks);
    expect(sendResult.success).toBe(true);
    expect(runLoopSpy).toHaveBeenCalledTimes(1);
    expect(callbacks.onMessage).toHaveBeenCalled();
    expect(callbacks.onToolApprove).toHaveBeenCalled();
    expect(callbacks.onTextDelta).toHaveBeenCalled();
    expect(callbacks.onChunk).toHaveBeenCalled();
    expect(callbacks.onStreamResult).toHaveBeenCalled();

    callbacks.onMessage.mockClear();
    callbacks.onToolApprove.mockClear();
    callbacks.onTextDelta.mockClear();
    callbacks.onChunk.mockClear();
    callbacks.onStreamResult.mockClear();

    const planResult = await service.plan('plan steps', callbacks);
    expect(planResult.success).toBe(true);
    expect(runLoopSpy).toHaveBeenCalledTimes(2);
    expect(callbacks.onMessage).toHaveBeenCalled();
    expect(callbacks.onToolApprove).toHaveBeenCalled();
    expect(callbacks.onTextDelta).toHaveBeenCalled();
    expect(callbacks.onChunk).toHaveBeenCalled();
    expect(callbacks.onStreamResult).toHaveBeenCalled();

    expect(resolveModelSpy).toHaveBeenCalled();

    await service.destroy();
  });
});
