import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/render';
import { WidgetSection } from '../widget-section';

describe('WidgetSection surface hierarchy', () => {
  it('keeps compact widgets plain by default', () => {
    render(
      <WidgetSection title="Compact summary" icon="orders">
        <p>Summary</p>
      </WidgetSection>,
    );

    const section = screen.getByRole('region', { name: 'Compact summary' });
    expect(section).not.toHaveClass('bg-card', 'rounded-lg', 'border', 'p-4');
  });

  it('gives dense widgets a semantic card surface when requested', () => {
    render(
      <WidgetSection title="Dense data" icon="revenue" surface="card">
        <p>Chart</p>
      </WidgetSection>,
    );

    expect(screen.getByRole('region', { name: 'Dense data' })).toHaveClass(
      'bg-card',
      'rounded-lg',
      'border',
      'p-4',
    );
  });
});
