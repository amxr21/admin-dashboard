import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/render';
import { Field, fieldMessageIds } from '../field';
import { Input } from '../input';

/**
 * The shared field wrapper.
 *
 * What's pinned here is the pair of behaviours the component exists FOR, both
 * of which fail quietly if they regress:
 *
 *   1. The error REPLACES the description rather than stacking under it. Two
 *      messages describing one control is how a form ends up telling someone
 *      what a field means while it is busy telling them the value is wrong.
 *   2. The required marker carries real text. Four files rendered a bare
 *      `<span aria-hidden>*</span>`, which shows a sighted user an asterisk and
 *      tells a screen-reader user nothing at all — a gap no visual check finds.
 */

describe('the message slot', () => {
  it('shows the description when there is no error', () => {
    render(
      <Field id="cost" label="Cost" description="Blank is not zero.">
        <Input id="cost" />
      </Field>,
    );

    expect(screen.getByText('Blank is not zero.')).toBeInTheDocument();
  });

  it('replaces the description with the error rather than showing both', () => {
    render(
      <Field
        id="cost"
        label="Cost"
        description="Blank is not zero."
        error="Enter a number."
      >
        <Input id="cost" />
      </Field>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number.');
    // The whole point: one slot, one message. A description still on screen
    // beside an error competes with it for the reader's attention.
    expect(screen.queryByText('Blank is not zero.')).not.toBeInTheDocument();
  });

  it('gives each message a stable id a caller can point aria-describedby at', () => {
    const { errorId, hintId } = fieldMessageIds('cost');

    const { rerender } = render(
      <Field id="cost" label="Cost" description="Blank is not zero.">
        <Input id="cost" aria-describedby={hintId} />
      </Field>,
    );

    expect(screen.getByLabelText('Cost')).toHaveAccessibleDescription('Blank is not zero.');

    rerender(
      <Field id="cost" label="Cost" description="Blank is not zero." error="Enter a number.">
        <Input id="cost" aria-describedby={errorId} />
      </Field>,
    );

    expect(screen.getByLabelText('Cost')).toHaveAccessibleDescription('Enter a number.');
  });

  it('renders nothing at all when there is neither', () => {
    render(
      <Field id="name" label="Name">
        <Input id="name" />
      </Field>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).not.toHaveAccessibleDescription();
  });
});

describe('the required marker', () => {
  it('announces "required" rather than only drawing an asterisk', () => {
    render(
      <Field id="name" label="Name" required>
        <Input id="name" />
      </Field>,
    );

    // The asterisk stays — it is the convention people scan for — but it is
    // decorative, and the accessible name is what carries the fact.
    expect(screen.getByText('Name', { exact: false }).textContent).toContain('*');
    expect(screen.getByLabelText(/required/i)).toBeInTheDocument();
  });

  it('translates that text rather than hardcoding English', () => {
    render(
      <Field id="name" label="الاسم" required>
        <Input id="name" />
      </Field>,
      { locale: 'ar' },
    );

    expect(screen.getByLabelText(/مطلوب/)).toBeInTheDocument();
  });

  it('adds no marker when the field is optional', () => {
    render(
      <Field id="name" label="Name">
        <Input id="name" />
      </Field>,
    );

    expect(screen.queryByText(/required/i)).not.toBeInTheDocument();
  });
});

describe('the label', () => {
  it('associates with the control it wraps', () => {
    render(
      <Field id="email" label="Email">
        <Input id="email" type="email" />
      </Field>,
    );

    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
  });

  it('is omitted entirely when a control labels itself', () => {
    // `product-gallery-panel` mounts an upload control with no label at all;
    // forcing one there would invent a heading for a button.
    render(
      <Field id="gallery">
        <Input id="gallery" aria-label="Add an image" />
      </Field>,
    );

    expect(screen.getByLabelText('Add an image')).toBeInTheDocument();
    expect(document.querySelector('label')).toBeNull();
  });
});
