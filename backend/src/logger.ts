import pino from 'pino';
import { env, isDevelopment } from './config/env.js';

/**
 * Structured logger.
 *
 * Every log call emits a JSON object with these guaranteed fields:
 *   - level     (info / warn / error / etc.)
 *   - time      (ISO timestamp)
 *   - service   (this project's name — searchable in aggregators)
 *   - env       (development / preview / production)
 *   - requestId (added per-request via middleware/requestContext.ts)
 *
 * Field naming convention (do NOT deviate — logs must be queryable):
 *   - camelCase for all field names
 *   - `userId` not `user_id` / `uid` / `user`
 *   - `event` field uses dot-notation: 'user.login.succeeded', 'payment.charge.failed'
 *   - Durations always `durationMs`, integer milliseconds
 *   - Amounts always in smallest unit (cents), never dollars — floats are lossy
 *
 * Never log: passwords (even hashed), full card numbers, API keys, JWTs,
 * session cookies, or full request bodies. The `redact` list below catches the
 * common cases but it is a safety net, not a substitute for thinking.
 *
 * In development: pretty-printed with colors for readability.
 * In production: raw JSON, one line per log, for ingestion into whatever
 * aggregator the host feeds (Better Stack, Datadog, Loki, …).
 */

export const logger = pino({
  level: env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info'),
  base: {
    service: 'admin-dashboard',
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Redact anything that looks like a secret. Extend this list per project.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.apiKey',
      '*.creditCard',
    ],
    censor: '[REDACTED]',
  },
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export type Logger = typeof logger;
