import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ImageUploadField } from '../image-upload-field';

/**
 * "Upload from your computer" for an image-URL field, with a "paste a URL
 * instead" fallback for a deployment that hasn't configured Cloudinary (see
 * upload.service.ts — CLOUDINARY_* env vars are checked TOGETHER, so a
 * partial set reads as "not configured", same as the message this surfaces).
 */

const uploadImage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/upload-api', () => ({ uploadImage }));

function selectFile(input: HTMLElement, file: File) {
  return userEvent.upload(input, file);
}

beforeEach(() => {
  uploadImage.mockReset();
});

describe('no image set', () => {
  it('shows the placeholder and an "Upload" button, no "Remove"', () => {
    render(
      <ImageUploadField id="logo" value="" onChange={vi.fn()} folder="logo" />,
    );

    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

describe('uploading a file', () => {
  it('uploads the selected file and reports the URL back', async () => {
    const onChange = vi.fn();
    uploadImage.mockResolvedValue({ url: 'https://cdn.example.com/logo.png' });

    const { container } = render(
      <ImageUploadField id="logo" value="" onChange={onChange} folder="logo" />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake-bytes'], 'logo.png', { type: 'image/png' });
    await selectFile(input, file);

    expect(uploadImage).toHaveBeenCalledWith(file, 'logo');
    expect(onChange).toHaveBeenCalledWith('https://cdn.example.com/logo.png');
  });

  it('shows "Replace" and "Remove" once a value exists', () => {
    render(
      <ImageUploadField
        id="logo"
        value="https://cdn.example.com/logo.png"
        onChange={vi.fn()}
        folder="logo"
      />,
    );

    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('clears the value when Remove is clicked', async () => {
    const onChange = vi.fn();
    render(
      <ImageUploadField
        id="logo"
        value="https://cdn.example.com/logo.png"
        onChange={onChange}
        folder="logo"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('a rejected upload', () => {
  it('surfaces the API-supplied reason, not a raw error', async () => {
    uploadImage.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Uploads are not configured for this deployment'),
    );

    const { container } = render(
      <ImageUploadField id="logo" value="" onChange={vi.fn()} folder="logo" />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake-bytes'], 'logo.png', { type: 'image/png' });
    await selectFile(input, file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/not configured/i);
  });

  it('falls back to a generic message for a non-API failure', async () => {
    uploadImage.mockRejectedValue(new TypeError('Failed to fetch'));

    const { container } = render(
      <ImageUploadField id="logo" value="" onChange={vi.fn()} folder="logo" />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake-bytes'], 'logo.png', { type: 'image/png' });
    await selectFile(input, file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/upload failed/i);
  });

  it('lets the same file be re-selected immediately after a failure', async () => {
    uploadImage.mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'File too large'));

    const { container } = render(
      <ImageUploadField id="logo" value="" onChange={vi.fn()} folder="logo" />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake-bytes'], 'logo.png', { type: 'image/png' });
    await selectFile(input, file);

    await screen.findByRole('alert');
    expect(input.value).toBe('');
  });
});

describe('the URL fallback', () => {
  it('is hidden until "Paste a URL instead" is toggled', () => {
    render(
      <ImageUploadField id="logo" value="" onChange={vi.fn()} folder="logo" />,
    );

    expect(screen.queryByPlaceholderText('https://…')).not.toBeInTheDocument();
  });

  it('reveals a URL input that reports typed values back', async () => {
    const onChange = vi.fn();
    render(
      <ImageUploadField id="logo" value="" onChange={onChange} folder="logo" />,
    );

    await userEvent.click(screen.getByText(/paste a url instead/i));
    await userEvent.type(screen.getByPlaceholderText('https://…'), 'x');

    expect(onChange).toHaveBeenCalledWith('x');
  });
});

describe('not choosing a file', () => {
  it('does not crash or call uploadImage when the file dialog is dismissed', async () => {
    const { container } = render(
      <ImageUploadField id="logo" value="" onChange={vi.fn()} folder="logo" />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // Simulate the dialog closing with nothing chosen — an empty FileList.
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(uploadImage).not.toHaveBeenCalled();
  });
});
