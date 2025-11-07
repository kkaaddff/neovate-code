#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import fs from 'fs';
import path from 'pathe';
import { fileURLToPath } from 'url';
import yargsParser from 'yargs-parser';
import { createAgentService } from './agentService';
import { PRODUCT_NAME } from './constants';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'),
);

function printHelp() {
  console.log(`
Usage: ${PRODUCT_NAME.toLowerCase()} [options] <prompt>

Options:
  --cwd <path>          Working directory (defaults to current)
  --model <model>       LLM model identifier (required)
  --plan                Run in planning mode (read-only)
  --session <id>        Resume an existing session log
  --language <lang>     Preferred response language
  --approval-mode <mode>  Tool approval mode (default, autoEdit, yolo)
  -h, --help            Show this help message
`);
}

async function run() {
  const args = yargsParser(process.argv.slice(2), {
    boolean: ['plan', 'help'],
    string: ['cwd', 'model', 'language', 'approval-mode', 'session'],
    alias: {
      h: 'help',
    },
  });

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const prompt = (args._ && args._.length > 0 ? args._.join(' ') : null) as
    | string
    | null;
  if (!prompt) {
    console.error('Prompt is required.');
    printHelp();
    process.exit(1);
  }
  if (!args.model) {
    console.error('--model is required.');
    process.exit(1);
  }

  const service = await createAgentService({
    cwd: args.cwd || process.cwd(),
    productName: PRODUCT_NAME,
    version: pkg.version,
    sessionId: args.session,
    configOverrides: {
      model: args.model,
      planModel: args.model,
      language: args.language,
      approvalMode: args['approval-mode'],
    },
  });

  const runner = args.plan ? service.plan : service.send;

  try {
    const result = await runner(prompt, {
      onMessage: async ({ message }) => {
        if (message.role === 'assistant' && typeof message.text === 'string') {
          console.log(message.text);
        }
      },
    });
    if (!result.success) {
      console.error(result.error.message);
      process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await service.destroy();
  }
}

run();
