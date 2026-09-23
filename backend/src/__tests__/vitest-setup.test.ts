import { describe, expect, it } from 'vitest';
import { setTestNodeEnvironment } from '../../vitest.environment.js';

describe('Vitest environment setup', () => {
  it('overrides an inherited development NODE_ENV before application imports', () => {
    const inheritedEnvironment: NodeJS.ProcessEnv = {
      NODE_ENV: 'development',
    };

    setTestNodeEnvironment(inheritedEnvironment);

    expect(inheritedEnvironment.NODE_ENV).toBe('test');
  });
});
