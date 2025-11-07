import type { ModelInfo } from './model';

export function getThinkingConfig(
  model: ModelInfo,
  reasoningEffort: 'low' | 'medium' | 'high',
): Record<string, any> | undefined {
  if (!model.model.reasoning) {
    return undefined;
  }

  if (model.model.id.startsWith('claude-')) {
    return {
      providerOptions: {
        anthropic: {
          thinking: {
            type: 'enabled' as const,
            budgetTokens: reasoningEffort === 'low' ? 1024 : 31999,
          },
        },
      },
    };
  }

  return undefined;
}
