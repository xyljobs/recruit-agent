import { spawn } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';

const envFile = resolve(process.cwd(), '.env.local');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const secretVariables = [
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LLM_API_KEY',
  'ENCRYPTION_KEY',
  'HMAC_KEY',
  'JWT_SECRET',
  'SUPABASE_JWT_SECRET',
];

for (const name of secretVariables) {
  const configuredPath = process.env[`${name}_FILE`]?.trim();
  const dockerSecretPath = resolve('/run/secrets', name);
  const secretPath = configuredPath || (existsSync(dockerSecretPath) ? dockerSecretPath : '');
  if (!secretPath) {
    continue;
  }
  if (process.env[name]?.trim()) {
    throw new Error(`${name} and ${name}_FILE cannot both be set`);
  }
  const value = readFileSync(secretPath, 'utf8').trim();
  if (!value) {
    throw new Error(`${name}_FILE points to an empty secret`);
  }
  process.env[name] = value;
}

const requiresModelCredentials =
  (process.env.AI_EXECUTION_MODE ?? 'rules_only').trim() !== 'rules_only';

const requiredVariables = {
  SUPABASE_URL: ['SUPABASE_URL'],
  SUPABASE_ANON_KEY: ['SUPABASE_ANON_KEY'],
  SUPABASE_SERVICE_ROLE_KEY: ['SUPABASE_SERVICE_ROLE_KEY'],
  ...(requiresModelCredentials ? { LLM_API_KEY: ['LLM_API_KEY'] } : {}),
  ENCRYPTION_KEY: ['ENCRYPTION_KEY'],
  HMAC_KEY: ['HMAC_KEY'],
  JWT_SECRET: ['JWT_SECRET'],
  SUPABASE_JWT_SECRET: ['SUPABASE_JWT_SECRET'],
};
const missingVariables = Object.entries(requiredVariables)
  .filter(([, aliases]) => aliases.every(name => !process.env[name]?.trim()))
  .map(([name]) => name);

if (missingVariables.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVariables.join(', ')}`);
}

for (const name of ['ENCRYPTION_KEY', 'HMAC_KEY']) {
  if (!/^[a-f0-9]{64}$/i.test(process.env[name])) {
    throw new Error(`${name} must be a 64-character hexadecimal string`);
  }
}

for (const name of ['JWT_SECRET', 'SUPABASE_JWT_SECRET']) {
  if (Buffer.byteLength(process.env[name], 'utf8') < 32) {
    throw new Error(`${name} must be at least 32 bytes`);
  }
}

const standaloneServer = [
  resolve(process.cwd(), 'server.js'),
  resolve(process.cwd(), '.next', 'standalone', 'server.js'),
].find(candidate => existsSync(candidate));

if (standaloneServer) {
  const standaloneDirectory = dirname(standaloneServer);
  if (standaloneDirectory !== process.cwd()) {
    const standaloneNextDirectory = resolve(standaloneDirectory, '.next');
    mkdirSync(standaloneNextDirectory, { recursive: true });
    cpSync(resolve(process.cwd(), '.next', 'static'), resolve(standaloneNextDirectory, 'static'), {
      recursive: true,
      force: true,
    });

    const publicDirectory = resolve(process.cwd(), 'public');
    if (existsSync(publicDirectory)) {
      cpSync(publicDirectory, resolve(standaloneDirectory, 'public'), {
        recursive: true,
        force: true,
      });
    }
  }
  await import(pathToFileURL(standaloneServer).href);
} else {
  const nextBin = resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(
    process.execPath,
    [
      nextBin,
      'start',
      '-p',
      process.env.PORT ?? '5000',
      '-H',
      process.env.HOSTNAME ?? '0.0.0.0',
    ],
    {
      stdio: 'inherit',
      env: process.env,
    }
  );

  child.once('exit', code => process.exit(code ?? 1));
  child.once('error', error => {
    throw error;
  });
}
