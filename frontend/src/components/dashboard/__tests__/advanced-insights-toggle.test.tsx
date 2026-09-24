import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ADVANCED_INSIGHTS_REGION_ID, AdvancedInsightsToggle } from '../advanced-insights-toggle';

describe('AdvancedInsightsToggle', () => {
  it('starts as an accessible closed disclosure', () => {
    render(<AdvancedInsightsToggle open={false} onToggle={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: /Advanced insights/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', ADVANCED_INSIGHTS_REGION_ID);
    expect(toggle).toHaveClass('bg-card', 'border');
  });

  it('announces the open state and requests a toggle', async () => {
    const onToggle = vi.fn();
    render(<AdvancedInsightsToggle open onToggle={onToggle} />);

    const toggle = screen.getByRole('button', { name: /Advanced insights/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hide insights')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('uses the Arabic label and keeps the same disclosure contract', () => {
    render(<AdvancedInsightsToggle open={false} onToggle={vi.fn()} />, { locale: 'ar' });

    const toggle = screen.getByRole('button', { name: /تحليلات متقدمة/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', ADVANCED_INSIGHTS_REGION_ID);
  });
});
