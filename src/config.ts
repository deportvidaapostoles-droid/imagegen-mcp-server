import { config as loadDotEnvFile } from 'dotenv';

export type TransportMode = 'stdio' | 'sse' | 'http';
export type ProviderType = 'openai' | 'gemini';

export type ConfigKey =
  | 'IMAGEGEN_PROVIDER'
  | 'IMAGEGEN_MODEL'
  | 'IMAGEGEN_TIMEOUT'
  | 'IMAGEGEN_ASYNC_ONLY'
  | 'IMAGEGEN_BLOCKING_POLL'
  | 'IMAGEGEN_BLOCKING_POLL_TIMEOUT'
  | 'IMAGEGEN_MAX_RETRIES'
  | 'OPENAI_API_KEY'
  | 'OPENAI_BASE_URL'
  | 'GEMINI_API_KEY'
  | 'GEMINI_BASE_URL'
  | 'MCP_TRANSPORT'
  | 'MCP_STDIO_LOGS'
  | 'MCP_HOST'
  | 'MCP_PORT'
  | 'OPENAI_IMAGE_MODEL'
  | 'OPENAI_IMAGE_PROMPT';

const CLI_FLAG_TO_CONFIG_KEY: Record<string, ConfigKey> = {
  'provider': 'IMAGEGEN_PROVIDER',
  'model': 'IMAGEGEN_MODEL',
  'openai-api-key': 'OPENAI_API_KEY',
  'openai-base-url': 'OPENAI_BASE_URL',
  'gemini-api-key': 'GEMINI_API_KEY',
  'gemini-base-url': 'GEMINI_BASE_URL',
  'mcp-transport': 'MCP_TRANSPORT',
  'mcp-stdio-logs': 'MCP_STDIO_LOGS',
  'mcp-host': 'MCP_HOST',
  'mcp-port': 'MCP_PORT',
  'timeout': 'IMAGEGEN_TIMEOUT',
  'async-only': 'IMAGEGEN_ASYNC_ONLY',
  'blocking-poll': 'IMAGEGEN_BLOCKING_POLL',
  'blocking-poll-timeout': 'IMAGEGEN_BLOCKING_POLL_TIMEOUT',
  'max-retries': 'IMAGEGEN_MAX_RETRIES',
  'openai-image-model': 'OPENAI_IMAGE_MODEL',
  'openai-image-prompt': 'OPENAI_IMAGE_PROMPT',
};

const BOOLEAN_CONFIG_KEYS = new Set<ConfigKey>(['MCP_STDIO_LOGS', 'IMAGEGEN_ASYNC_ONLY', 'IMAGEGEN_BLOCKING_POLL']);

const PLACEHOLDER_VALUES: Partial<Record<ConfigKey, string[]>> = {
  OPENAI_API_KEY: ['sk-your-openai-api-key', 'your-openai-api-key', 'your-key'],
  GEMINI_API_KEY: ['your-gemini-api-key', 'your-key'],
};

export interface ServerRuntimeConfig {
  provider: ProviderType;
  model: string;
  timeout: number;
  asyncOnly: boolean;
  blockingPoll: boolean;
  blockingPollTimeout: number;
  maxRetries: number;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  transportMode: TransportMode;
  stdioLogsEnabled: boolean;
  host: string;
  port: number;
  helpRequested: boolean;
  warnings: string[];
}

export function loadDotEnv(): void {
  loadDotEnvFile({ quiet: true });
}

function parseCliArgs(argv: string[]): { values: Partial<Record<ConfigKey, string>>; helpRequested: boolean; warnings: string[] } {
  const values: Partial<Record<ConfigKey, string>> = {};
  const warnings: string[] = [];
  let helpRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const raw = arg.slice(2);
    if (!raw) continue;

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
    } else if (BOOLEAN_CONFIG_KEYS.has(mappedKey)) {
      value = 'true';
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

function normalizeConfigValue(key: ConfigKey, value: string | undefined, warnings: string[]): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (PLACEHOLDER_VALUES[key]?.includes(trimmed)) {
    warnings.push(`${key} uses a placeholder value and will be ignored`);
    return undefined;
  }
  return trimmed;
}

function parseBooleanConfig(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value.toLowerCase() !== 'false' && value !== '0';
}

function isTransportMode(value: string): value is TransportMode {
  return value === 'stdio' || value === 'sse' || value === 'http';
}

function isProviderType(value: string): value is ProviderType {
  return value === 'openai' || value === 'gemini';
}

function withWarning<T>(warnings: string[], warning: string, fallback: T): T {
  warnings.push(warning);
  return fallback;
}

function parseTimeout(value: string | undefined, warnings: string[], fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    warnings.push(`Invalid ${label} '${value}', falling back to ${fallback}`);
    return fallback;
  }
  return parsed;
}

export function getServerRuntimeConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ServerRuntimeConfig {
  const parsed = parseCliArgs(argv);
  const warnings = [...parsed.warnings];
  const values: Partial<Record<ConfigKey, string>> = {};

  for (const key of Object.values(CLI_FLAG_TO_CONFIG_KEY)) {
    const rawValue = parsed.values[key] ?? env[key];
    const normalizedValue = normalizeConfigValue(key, rawValue, warnings);
    if (normalizedValue !== undefined) {
      values[key] = normalizedValue;
    }
  }

  const providerRaw = values.IMAGEGEN_PROVIDER ?? 'openai';
  const provider: ProviderType = isProviderType(providerRaw)
    ? providerRaw
    : withWarning(warnings, `Invalid IMAGEGEN_PROVIDER '${providerRaw}', falling back to 'openai'`, 'openai' as ProviderType);

  const model = values.IMAGEGEN_MODEL ?? 'gpt-image-1';

  const transportCandidate = values.MCP_TRANSPORT ?? 'stdio';
  const transportMode = isTransportMode(transportCandidate)
    ? transportCandidate
    : withWarning(warnings, `Invalid MCP_TRANSPORT '${transportCandidate}', falling back to 'stdio'`, 'stdio');

  const portCandidate = values.MCP_PORT ?? '3000';
  const parsedPort = Number.parseInt(portCandidate, 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0
    ? parsedPort
    : withWarning(warnings, `Invalid MCP_PORT '${portCandidate}', falling back to 3000`, 3000);

  return {
    provider,
    model,
    timeout: parseTimeout(values.IMAGEGEN_TIMEOUT, warnings, 300, 'IMAGEGEN_TIMEOUT'),
    asyncOnly: parseBooleanConfig(values.IMAGEGEN_ASYNC_ONLY),
    blockingPoll: parseBooleanConfig(values.IMAGEGEN_BLOCKING_POLL),
    blockingPollTimeout: parseTimeout(values.IMAGEGEN_BLOCKING_POLL_TIMEOUT, warnings, 120, 'IMAGEGEN_BLOCKING_POLL_TIMEOUT'),
    maxRetries: parseTimeout(values.IMAGEGEN_MAX_RETRIES, warnings, 3, 'IMAGEGEN_MAX_RETRIES'),
    openaiApiKey: values.OPENAI_API_KEY,
    openaiBaseUrl: values.OPENAI_BASE_URL,
    geminiApiKey: values.GEMINI_API_KEY,
    geminiBaseUrl: values.GEMINI_BASE_URL,
    transportMode,
    stdioLogsEnabled: parseBooleanConfig(values.MCP_STDIO_LOGS),
    host: values.MCP_HOST ?? 'localhost',
    port,
    helpRequested: parsed.helpRequested,
    warnings,
  };
}

export function getCliHelpText(): string {
  return [
    'ImageGen MCP Server',
    '',
    'Environment variables / CLI options (CLI > environment > defaults):',
    '  IMAGEGEN_PROVIDER    Provider: openai | gemini (default: openai)',
    '  IMAGEGEN_MODEL       Model name (default: gpt-image-1)',
    '  IMAGEGEN_TIMEOUT     Default tool timeout in seconds (default: 300)',
    '  IMAGEGEN_ASYNC_ONLY   Only expose async task tools (default: false)',
    '  IMAGEGEN_BLOCKING_POLL         Block get_task to prevent rapid polling (default: false)',
    '  IMAGEGEN_BLOCKING_POLL_TIMEOUT Blocking poll timeout in seconds (default: 120)',
    '  IMAGEGEN_MAX_RETRIES    Max retries on task failure (default: 3)',
    '  OPENAI_API_KEY       OpenAI API key',
    '  OPENAI_BASE_URL      OpenAI API base URL (proxy)',
    '  GEMINI_API_KEY       Gemini API key',
    '  GEMINI_BASE_URL      Gemini API base URL (proxy)',
    '  MCP_TRANSPORT        stdio | sse | http (default: stdio)',
    '  MCP_STDIO_LOGS       Enable logs on stderr in stdio mode',
    '  MCP_HOST             SSE/HTTP bind host (default: localhost)',
    '  MCP_PORT             SSE/HTTP bind port (default: 3000)',
    '',
    'CLI flags:',
    '  --provider <openai|gemini>',
    '  --model <model-name>',
    '  --timeout <seconds>',
    '  --async-only',
    '  --openai-api-key <value>',
    '  --openai-base-url <value>',
    '  --gemini-api-key <value>',
    '  --gemini-base-url <value>',
    '  --mcp-transport <stdio|sse|http>',
    '  --mcp-stdio-logs',
    '  --mcp-host <value>',
    '  --mcp-port <number>',
    '  --help',
    '',
    'Examples:',
    '  npx -y imagegen-mcp-server --provider openai --model gpt-image-1',
    '  npx -y imagegen-mcp-server --provider gemini --model gemini-2.5-flash-image',
    '  IMAGEGEN_ASYNC_ONLY=true npx -y imagegen-mcp-server',
  ].join('\n');
}
