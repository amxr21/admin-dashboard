'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A plain modal: portal + fixed overlay + native focus trap, via Radix.
 *
 * Distinct from AlertDialog (ui/alert-dialog.tsx), which exists specifically
 * for a destructive yes/no gate and deliberately does NOT close on outside
 * click or Escape. This DOES — a command palette or any other "just browsing
 * content" modal should dismiss the moment the user clicks away, the same
 * way closing a menu works everywhere else in the app.
 *
 * Same fade + zoom "pop" as AlertDialogContent/Sheet's modal variant, so
 * every centered surface in the app shares one motion system.
 */

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'bg-card fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
          'flex flex-col gap-4 rounded-lg border p-4 shadow-lg',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          'motion-safe:data-[state=open]:zoom-in-95',
          'motion-safe:data-[state=closed]:zoom-out-95',
          'duration-300',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription };
