import { config as loadDotEnvFile } from 'dotenv';

export type TransportMode = 'stdio' | 'sse' | 'http';

export type ConfigKey =
  | 'DEFAULT_MODEL'
  | 'OPENAI_API_KEY'
  | 'OPENAI_BASE_URL'
  | 'GEMINI_API_KEY'
  | 'GEMINI_BASE_URL'
  | 'MCP_TRANSPORT'
  | 'MCP_HOST'
  | 'MCP_PORT'
  | 'OPENAI_IMAGE_MODEL'
  | 'OPENAI_IMAGE_PROMPT';

const CLI_FLAG_TO_CONFIG_KEY: Record<string, ConfigKey> = {
  'default-model': 'DEFAULT_MODEL',
  'openai-api-key': 'OPENAI_API_KEY',
  'openai-base-url': 'OPENAI_BASE_URL',
  'gemini-api-key': 'GEMINI_API_KEY',
  'gemini-base-url': 'GEMINI_BASE_URL',
  'mcp-transport': 'MCP_TRANSPORT',
  'mcp-host': 'MCP_HOST',
  'mcp-port': 'MCP_PORT',
  'openai-image-model': 'OPENAI_IMAGE_MODEL',
  'openai-image-prompt': 'OPENAI_IMAGE_PROMPT',
};

const PLACEHOLDER_VALUES: Partial<Record<ConfigKey, string[]>> = {
  OPENAI_API_KEY: ['sk-your-openai-api-key', 'your-openai-api-key', 'your-key'],
  GEMINI_API_KEY: ['your-gemini-api-key', 'your-key'],
};

export interface ParsedCliArgs {
  values: Partial<Record<ConfigKey, string>>;
  helpRequested: boolean;
  warnings: string[];
}

export interface ResolvedConfig {
  values: Partial<Record<ConfigKey, string>>;
  helpRequested: boolean;
  warnings: string[];
}

export interface ServerRuntimeConfig {
  defaultModel: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  transportMode: TransportMode;
  host: string;
  port: number;
  helpRequested: boolean;
  warnings: string[];
}

export function loadDotEnv(): void {
  loadDotEnvFile();
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): ParsedCliArgs {
  const values: Partial<Record<ConfigKey, string>> = {};
  const warnings: string[] = [];
  let helpRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const raw = arg.slice(2);
    if (!raw) {
      continue;
    }

    if (raw === 'help') {
      helpRequested = true;
      continue;
    }

    const equalsIndex = raw.indexOf('=');
    const flag = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw;
    const mappedKey = CLI_FLAG_TO_CONFIG_KEY[flag];

    if (!mappedKey) {
      warnings.push(`Unknown CLI option ignored: --${flag}`);
      if (equalsIndex < 0 && index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
        index += 1;
      }
      continue;
    }

    let value: string | undefined;
    if (equalsIndex >= 0) {
      value = raw.slice(equalsIndex + 1);
    } else if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      value = argv[index + 1];
      index += 1;
    }

    if (value === undefined) {
      warnings.push(`Missing value for CLI option: --${flag}`);
      continue;
    }

    values[mappedKey] = value;
  }

  return { values, helpRequested, warnings };
}

export function resolveConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const parsed = parseCliArgs(argv);
  const warnings = [...parsed.warnings];
  const values: Partial<Record<ConfigKey, string>> = {};

  const configKeys = new Set<ConfigKey>([
    ...Object.values(CLI_FLAG_TO_CONFIG_KEY),
  ]);

  for (const key of configKeys) {
    const rawValue = parsed.values[key] ?? env[key];
    const normalizedValue = normalizeConfigValue(key, rawValue, warnings);
    if (normalizedValue !== undefined) {
      values[key] = normalizedValue;
    }
  }

  return {
    values,
    helpRequested: parsed.helpRequested,
    warnings,
  };
}

export function getServerRuntimeConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ServerRuntimeConfig {
  const resolved = resolveConfig(argv, env);
  const warnings = [...resolved.warnings];

  const transportCandidate = resolved.values.MCP_TRANSPORT ?? 'stdio';
  const transportMode = isTransportMode(transportCandidate)
    ? transportCandidate
    : withWarning(warnings, `Invalid MCP_TRANSPORT '${transportCandidate}', falling back to 'stdio'`, 'stdio');

  const portCandidate = resolved.values.MCP_PORT ?? '3000';
  const parsedPort = Number.parseInt(portCandidate, 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0
    ? parsedPort
    : withWarning(warnings, `Invalid MCP_PORT '${portCandidate}', falling back to 3000`, 3000);

  return {
    defaultModel: resolved.values.DEFAULT_MODEL ?? 'gemini-2.5-flash-image',
    openaiApiKey: resolved.values.OPENAI_API_KEY,
    openaiBaseUrl: resolved.values.OPENAI_BASE_URL,
    geminiApiKey: resolved.values.GEMINI_API_KEY,
    geminiBaseUrl: resolved.values.GEMINI_BASE_URL,
    transportMode,
    host: resolved.values.MCP_HOST ?? 'localhost',
    port,
    helpRequested: resolved.helpRequested,
    warnings,
  };
}

export function getCliHelpText(): string {
  return [
    'Assets Generation MCP Server',
    '',
    'Supported CLI options (CLI > environment > defaults):',
    '  --openai-api-key <value>',
    '  --openai-base-url <value>',
    '  --gemini-api-key <value>',
    '  --gemini-base-url <value>',
    '  --default-model <value>',
    '  --mcp-transport <stdio|sse|http>',
    '  --mcp-host <value>',
    '  --mcp-port <number>',
    '  --openai-image-model <value>',
    '  --openai-image-prompt <value>',
    '  --help',
    '',
    'Examples:',
    '  node dist/index.js --openai-api-key sk-... --openai-base-url https://example.com/v1 --default-model gpt-image-2',
    '  npx -y @ayaka209/assets-gen-mcp --openai-api-key sk-... --openai-base-url https://example.com/v1',
  ].join('\n');
}

function normalizeConfigValue(
  key: ConfigKey,
  value: string | undefined,
  warnings: string[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (PLACEHOLDER_VALUES[key]?.includes(trimmed)) {
    warnings.push(`${key} uses a placeholder value and will be ignored`);
    return undefined;
  }

  return trimmed;
}

function isTransportMode(value: string): value is TransportMode {
  return value === 'stdio' || value === 'sse' || value === 'http';
}

function withWarning<T>(warnings: string[], warning: string, fallback: T): T {
  warnings.push(warning);
  return fallback;
}
