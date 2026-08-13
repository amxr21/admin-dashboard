import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { useUnsavedChangesGuard } from '../useUnsavedChangesGuard';

/**
 * The one guard against losing a dirty form to a tab close / reload / typed
 * URL — the paths `beforeunload` is the only platform hook that can still
 * intervene on, since none of them are a Next.js navigation.
 */

function Probe({ isDirty }: { isDirty: boolean }) {
  useUnsavedChangesGuard(isDirty);
  return null;
}

function fireBeforeUnload(): BeforeUnloadEvent {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('while dirty', () => {
  it('calls preventDefault on beforeunload, the mechanism that actually triggers the browser prompt', () => {
    render(<Probe isDirty={true} />);

    const event = fireBeforeUnload();

    expect(event.defaultPrevented).toBe(true);
  });

  it('sets the legacy returnValue too, for the browsers that still key off it', () => {
    // jsdom's Event.returnValue reflects defaultPrevented rather than
    // honouring an assignment the way a real BeforeUnloadEvent does, so the
    // property can't be asserted by reading it back post-dispatch here —
    // spying on the setter is what actually proves the handler assigns it.
    render(<Probe isDirty={true} />);

    let assignedValue: string | undefined;
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, 'returnValue', {
      set(value: string) {
        assignedValue = value;
      },
      get() {
        return assignedValue;
      },
    });

    window.dispatchEvent(event);

    expect(assignedValue).toBe('');
  });
});

describe('while clean', () => {
  it('does not intervene on beforeunload at all', () => {
    render(<Probe isDirty={false} />);

    const event = fireBeforeUnload();

    expect(event.defaultPrevented).toBe(false);
  });
});

describe('reacting to isDirty changing', () => {
  it('starts warning the moment isDirty flips true, without remounting', () => {
    const { rerender } = render(<Probe isDirty={false} />);
    expect(fireBeforeUnload().defaultPrevented).toBe(false);

    rerender(<Probe isDirty={true} />);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('stops warning once isDirty flips back to false — e.g. after a save', () => {
    const { rerender } = render(<Probe isDirty={true} />);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);

    rerender(<Probe isDirty={false} />);
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});

describe('cleanup', () => {
  it('removes its listener on unmount — a closed form must not keep prompting', () => {
    const { unmount } = render(<Probe isDirty={true} />);
    unmount();

    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});
