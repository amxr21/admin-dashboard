import 'dotenv/config';
import { z } from 'zod';

/**
 * Validated environment.
 *
 * Why this file exists:
 * Under `strict: true`, `process.env.PORT` is `string | undefined` at every
 * call site, so you either sprinkle `?? '4000'` everywhere or lie to the
 * compiler with `!`. Worse, a missing DATABASE_URL wouldn't surface until the
 * first query — minutes or hours after deploy.
 *
 * Instead: parse once, at boot, and crash immediately with a readable message.
 * Everything downstream imports `env` and gets fully-typed, guaranteed values.
 *
 * Adding a variable: add it here AND to .env.example. Those two stay in sync.
 */

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'preview', 'production', 'test'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(4000),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .optional(),

  // Prisma reads DATABASE_URL itself, but we validate it here so a typo fails
  // at boot rather than on the first query.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Optional: Sentry is disabled outside production, so local dev needs no DSN.
  SENTRY_DSN: z.string().url().optional().or(z.literal('')),

  // Comma-separated origin list → string[].
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  // ─── Auth ────────────────────────────────────────────────────────
  // No default and no fallback: a JWT secret that ships with the code signs
  // tokens anyone who has read the repo can forge. 32 chars is the floor for
  // HS256 to be meaningfully resistant to offline brute-forcing.
  // Generate with: openssl rand -base64 32
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters — generate with `openssl rand -base64 32`'),

  // Short-lived by design. Without a revocation list (see PROJECT_STATUS.md),
  // expiry is the ONLY thing that invalidates a stolen token, so this is the
  // real blast radius of a leak. Shorten it, don't lengthen it.
  JWT_EXPIRES_IN: z.string().default('7d'),

  // ─── Brute-force protection ──────────────────────────────────────
  // Failed attempts before an account locks. Counted per-account, so a
  // distributed attack on one email still trips it.
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // How long the lock lasts, in minutes.
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // This is the one place console is correct: the logger itself depends on
  // env, so it does not exist yet. Nothing has booted — fail loud and exit.
  // eslint-disable-next-line no-console
  console.error(
    'Invalid environment configuration:\n' +
      parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n') +
      '\n\nCheck .env against .env.example.',
  );
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
