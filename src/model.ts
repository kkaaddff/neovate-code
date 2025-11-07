import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import assert from 'assert';
import type { Context } from './context';

export type ModelMeta = {
  id: string;
  reasoning: boolean;
  limit: {
    context: number;
    output: number;
  };
};

export type ModelInfo = {
  model: ModelMeta;
  m: LanguageModelV2;
};

const DEFAULT_LIMIT = { context: 128_000, output: 8_192 };

const BUILTIN_MODELS: Record<string, ModelMeta> = {
  'glm-4.6': {
    id: 'glm-4.6',
    reasoning: false,
    limit: DEFAULT_LIMIT,
  },
};

function resolveModelMeta(modelId: string): ModelMeta {
  return (
    BUILTIN_MODELS[modelId] || {
      id: modelId,
      reasoning: false,
      limit: DEFAULT_LIMIT,
    }
  );
}

export async function resolveModelWithContext(
  name: string | null,
  context: Context,
) {
  const modelId = name || context.config.model;
  assert(modelId, 'A language model must be specified in config or arguments.');
  const model = await createOpenAIModel(modelId);
  return { model };
}

async function createOpenAIModel(modelId: string): Promise<ModelInfo> {
  const apiKey = process.env.OPENAI_API_KEY;
  assert(apiKey, 'OPENAI_API_KEY is required to call the agent.');
  const client = createOpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  });
  return {
    model: resolveModelMeta(modelId),
    m: client.chat(modelId),
  };
}
