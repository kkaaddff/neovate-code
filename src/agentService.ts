import type { Config } from './config';
import { Context } from './context';
import { Project, type ProjectTaskOptions } from './project';
import type { SessionId } from './session';

export type AgentServiceOptions = {
  cwd: string;
  productName: string;
  version: string;
  sessionId?: SessionId;
  configOverrides?: Partial<Config>;
};

export type AgentTaskOptions = Omit<
  ProjectTaskOptions,
  'kind' | 'context' | 'session' | 'message'
>;

export type AgentService = {
  sessionId: SessionId;
  context: Context;
  send: (
    message: string | null,
    opts?: AgentTaskOptions,
  ) => ReturnType<Project['send']>;
  plan: (
    message: string | null,
    opts?: AgentTaskOptions,
  ) => ReturnType<Project['plan']>;
  destroy: () => Promise<void>;
};

export async function createAgentService(
  opts: AgentServiceOptions,
): Promise<AgentService> {
  const context = await Context.create({
    cwd: opts.cwd,
    productName: opts.productName,
    version: opts.version,
    argvConfig: opts.configOverrides || {},
  });

  const project = new Project({
    context,
    sessionId: opts.sessionId,
  });

  return {
    sessionId: project.session.id,
    context,
    send: (message, sendOpts) => project.send(message, sendOpts),
    plan: (message, planOpts) => project.plan(message, planOpts),
    destroy: () => context.destroy(),
  };
}
