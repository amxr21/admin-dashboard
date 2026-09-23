/**
 * Force import-time application guards into their deterministic test mode.
 * This must not be a fallback: local .env files commonly declare development.
 */
export function setTestNodeEnvironment(environment: NodeJS.ProcessEnv): void {
  environment.NODE_ENV = 'test';
}
