import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/render';
import { WidgetSection } from '../widget-section';

describe('WidgetSection surface hierarchy', () => {
  it('gives compact widgets a bounded card surface by default', () => {
    render(
      <WidgetSection title="Compact summary" icon="orders">
        <p>Summary</p>
      </WidgetSection>,
    );

    const section = screen.getByRole('region', { name: 'Compact summary' });
    expect(section).toHaveClass('bg-card', 'rounded-lg', 'border', 'p-4');
  });

  it('allows an intentionally unbounded section to opt out', () => {
    render(
      <WidgetSection title="Unbounded data" icon="revenue" surface="plain">
        <p>Summary</p>
      </WidgetSection>,
    );

    expect(screen.getByRole('region', { name: 'Unbounded data' })).not.toHaveClass(
      'bg-card', 'rounded-lg', 'border', 'p-4',
    );
  });
});
