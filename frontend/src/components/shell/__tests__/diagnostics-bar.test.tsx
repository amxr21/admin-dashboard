import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { DiagnosticsBar } from '../diagnostics-bar';

/**
 * The DEVELOPER-only diagnostics strip.
 *
 * Nothing here should ever be a secret — the endpoint itself already decided
 * that (see diagnostics.route.ts) — so these tests are about the widget being
 * honest about STATE (reachable vs not, configured vs not) rather than about
 * hiding anything.
 */

const fetchDiagnostics = vi.hoisted(() => vi.fn());

vi.mock('@/lib/diagnostics-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/diagnostics-api')>();
  return { ...actual, fetchDiagnostics };
});

function baseDiagnostics(overrides: Partial<Awaited<ReturnType<typeof fetchDiagnostics>>> = {}) {
  return {
    environment: 'production',
    isProduction: true,
    uptimeSeconds: 7325, // 2h 2m 5s
    node: 'v22.10.0',
    database: { reachable: true, latencyMs: 12 },
    migrations: [
      { name: '20260731124618_add_password_reset_tokens', appliedAt: '2026-07-31T12:00:00.000Z' },
    ],
    observability: {
      sentry: { configured: false, dashboard: null },
      logs: { dashboard: null },
    },
    ...overrides,
  };
}

beforeEach(() => {
  fetchDiagnostics.mockReset();
});

describe('collapsed by default', () => {
  it('shows environment, uptime and a reachable database at a glance', async () => {
    fetchDiagnostics.mockResolvedValue(baseDiagnostics());

    render(<DiagnosticsBar />);

    expect(await screen.findByText('production')).toBeInTheDocument();
    expect(screen.getByText(/2h 2m/)).toBeInTheDocument();
    expect(screen.getByText(/reachable/i)).toBeInTheDocument();
    // Details are not shown until expanded.
    expect(screen.queryByText(/v22\.10\.0/)).not.toBeInTheDocument();
  });

  it('flags an unreachable database', async () => {
    fetchDiagnostics.mockResolvedValue(
      baseDiagnostics({ database: { reachable: false, latencyMs: 5000, kind: 'TimeoutError' } }),
    );

    render(<DiagnosticsBar />);

    expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
  });
});

describe('expanded', () => {
  it('reveals node version, migrations and observability links', async () => {
    fetchDiagnostics.mockResolvedValue(
      baseDiagnostics({
        observability: {
          sentry: { configured: true, dashboard: 'https://sentry.example.test/org/project' },
          logs: { dashboard: 'https://logs.example.test' },
        },
      }),
    );
    const user = userEvent.setup();

    render(<DiagnosticsBar />);
    await screen.findByText('production');

    await user.click(screen.getByRole('button', { name: /developer diagnostics/i }));

    expect(screen.getByText('v22.10.0')).toBeInTheDocument();
    expect(screen.getByText('20260731124618_add_password_reset_tokens')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /view dashboard/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://sentry.example.test/org/project');
  });

  it('says so honestly when observability is not configured, without a broken link', async () => {
    fetchDiagnostics.mockResolvedValue(baseDiagnostics());
    const user = userEvent.setup();

    render(<DiagnosticsBar />);
    await screen.findByText('production');
    await user.click(screen.getByRole('button', { name: /developer diagnostics/i }));

    expect(screen.queryByRole('link', { name: /view dashboard/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/not configured/i).length).toBeGreaterThan(0);
  });

  it('never renders anything resembling a connection string or DSN', async () => {
    // A diagnostics page is the most tempting place for a secret to leak.
    fetchDiagnostics.mockResolvedValue(baseDiagnostics());
    const user = userEvent.setup();

    const { container } = render(<DiagnosticsBar />);
    await screen.findByText('production');
    await user.click(screen.getByRole('button', { name: /developer diagnostics/i }));

    expect(container.textContent).not.toMatch(/mysql:\/\/|:\/\/.*:.*@/);
  });
});

describe('when the endpoint fails', () => {
  it('shows a quiet inline message rather than breaking the shell', async () => {
    fetchDiagnostics.mockRejectedValue(new Error('network down'));

    render(<DiagnosticsBar />);

    expect(await screen.findByText(/developer diagnostics/i)).toBeInTheDocument();
  });
});
