import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { ConfigurationView } from '../configuration-view';

const fetchConfigurationStatus = vi.hoisted(() => vi.fn());

vi.mock('@/lib/diagnostics-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/diagnostics-api')>();
  return { ...actual, fetchConfigurationStatus };
});

function configuration() {
  return {
    mode: {
      appMode: 'local',
      nodeEnv: 'test',
      isProduction: false,
      corsOriginCount: 1,
    },
    integrations: [
      {
        key: 'email',
        configured: false,
        partial: false,
        readinessCode: 'disabled',
        impactCode: 'emailDeliveryUnavailable',
      },
      {
        key: 'logs',
        configured: false,
        partial: false,
        readinessCode: 'missing',
        impactCode: 'logAggregationUnavailable',
        dashboard: 'https://logs.example.test',
      },
    ],
  } as const;
}

beforeEach(() => {
  fetchConfigurationStatus.mockReset();
  fetchConfigurationStatus.mockResolvedValue(configuration());
});

describe('ConfigurationView', () => {
  it('renders stable API codes as English readiness and impact copy', async () => {
    render(<ConfigurationView />);

    expect(await screen.findByText('Disabled in settings')).toBeInTheDocument();
    expect(screen.getByText(/Password reset codes.*are not delivered/)).toBeInTheDocument();
    expect(screen.queryByText('emailDeliveryUnavailable')).not.toBeInTheDocument();
  });

  it('renders the same response in Arabic without leaking English backend prose', async () => {
    const { container } = render(<ConfigurationView />, { locale: 'ar' });

    expect(await screen.findByText('معطل من الإعدادات')).toBeInTheDocument();
    expect(screen.getByText(/لن تصل رموز إعادة تعيين كلمة المرور/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('Password reset codes');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('marks the external-link icon as directional for RTL mirroring', async () => {
    const { container } = render(<ConfigurationView />, { locale: 'ar' });

    expect(await screen.findByRole('link', { name: 'فتح لوحة التحكم' })).toHaveAttribute(
      'href',
      'https://logs.example.test',
    );
    expect(container.querySelector('.icon-directional')).not.toBeNull();
  });
});
