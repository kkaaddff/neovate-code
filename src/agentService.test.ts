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
        model: 'local-test',
        planModel: 'local-test',
      },
    });

    const callbacks = {
      onMessage: vi.fn(async () => {}),
      onToolApprove: vi.fn(async () => true),
      onTextDelta: vi.fn(async () => {}),
      onChunk: vi.fn(async () => {}),
      onStreamResult: vi.fn(async () => {}),
    };

    const sendResult = await service.send('Inspect repo', callbacks);
    expect(sendResult.success).toBe(true);
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

    const planResult = await service.plan('Plan next steps', callbacks);
    expect(planResult.success).toBe(true);
    expect(callbacks.onMessage).toHaveBeenCalled();
    expect(callbacks.onTextDelta).toHaveBeenCalled();
    expect(callbacks.onChunk).toHaveBeenCalled();
    expect(callbacks.onStreamResult).toHaveBeenCalled();

    await service.destroy();
  });
});
