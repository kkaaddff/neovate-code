import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import assert from 'assert';
import type { Context } from './context';

export type ProviderInfo = {
  id: string;
  name: string;
};

export type ModelMeta = {
  id: string;
  reasoning: boolean;
  limit: {
    context: number;
    output: number;
  };
};

export type ModelInfo = {
  provider: ProviderInfo;
  model: ModelMeta;
  m: LanguageModelV2;
};

const DEFAULT_LIMIT = { context: 128_000, output: 8_192 };

const BUILTIN_MODELS: Record<string, ModelMeta> = {
  'gpt-4o': {
    id: 'gpt-4o',
    reasoning: false,
    limit: DEFAULT_LIMIT,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    reasoning: false,
    limit: { context: 128_000, output: 6_000 },
  },
  'o4-mini': {
    id: 'o4-mini',
    reasoning: true,
    limit: { context: 160_000, output: 16_000 },
  },
  'o3-mini': {
    id: 'o3-mini',
    reasoning: true,
    limit: { context: 128_000, output: 8_000 },
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
    provider: {
      id: 'openai',
      name: 'OpenAI',
    },
    model: resolveModelMeta(modelId),
    m: client.chat(modelId),
  };
}
