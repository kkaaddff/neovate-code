import fs from 'fs';
import os from 'os';
import path from 'pathe';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createAgentService } from './agentService';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: path.join(process.cwd(), '.env') });

describe('AgentService integration', () => {
  let projectDir: string;
  let homeDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-service-repo-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-service-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = homeDir;
    fs.writeFileSync(
      path.join(projectDir, 'local_file.txt'),
      'hello world',
      'utf-8',
    );
  });

  afterEach(() => {
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
        model: 'glm-4.6',
        planModel: 'glm-4.6',
      },
    });

    const callbacks = {
      onMessage: vi.fn(async (opts: { message: any }) => {
        const { message } = opts;
        console.log('[onMessage]', {
          role: message.role,
          uuid: message.uuid,
          parentUuid: message.parentUuid,
          content:
            typeof message.content === 'string'
              ? message.content.substring(0, 100)
              : JSON.stringify(message.content).substring(0, 100),
          timestamp: message.timestamp,
        });
      }),
      onToolApprove: vi.fn(
        async (opts: { toolUse: any; category?: string }) => {
          const { toolUse, category } = opts;
          console.log('[onToolApprove]', {
            toolName: toolUse.name,
            callId: toolUse.callId,
            params: JSON.stringify(toolUse.params),
            category,
          });
          return true;
        },
      ),
      onTextDelta: vi.fn(async (text: string) => {
        console.log('[onTextDelta]', text.substring(0, 200));
      }),
      onChunk: vi.fn(async (chunk: any, requestId: string) => {
        console.log('[onChunk]', {
          requestId,
          chunkType: typeof chunk,
          chunk: JSON.stringify(chunk).substring(0, 200),
        });
      }),
      onStreamResult: vi.fn(async (result: any) => {
        console.log('[onStreamResult]', {
          requestId: result.requestId,
          model: result.model?.modelId || JSON.stringify(result.model),
          hasError: !!result.error,
          statusCode: result.response?.statusCode,
          error: result.error
            ? JSON.stringify(result.error).substring(0, 300)
            : undefined,
        });
      }),
    };

    const sendResult = await service.send('Inspect repo', callbacks);
    expect(sendResult.success).toBe(true);
    expect(callbacks.onMessage).toHaveBeenCalled();
    // expect(callbacks.onToolApprove).toHaveBeenCalled();
    expect(callbacks.onTextDelta).toHaveBeenCalled();
    expect(callbacks.onChunk).toHaveBeenCalled();
    expect(callbacks.onStreamResult).toHaveBeenCalled();

    callbacks.onMessage.mockClear();
    callbacks.onToolApprove.mockClear();
    callbacks.onTextDelta.mockClear();
    callbacks.onChunk.mockClear();
    callbacks.onStreamResult.mockClear();

    const planResult = await service.plan('Plan next steps', callbacks);
    expect(planResult.success).toBe(true);
    expect(callbacks.onMessage).toHaveBeenCalled();
    expect(callbacks.onTextDelta).toHaveBeenCalled();
    expect(callbacks.onChunk).toHaveBeenCalled();
    expect(callbacks.onStreamResult).toHaveBeenCalled();

    await service.destroy();
  });
});
