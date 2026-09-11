'use client';

const dirtySources = new Set<symbol>();
let navigationBypass = false;

export function registerDirtySource(source: symbol): () => void {
  dirtySources.add(source);
  return () => dirtySources.delete(source);
}

export function hasDirtySources(): boolean {
  return dirtySources.size > 0;
}

export function isUnsavedNavigationBypassed(): boolean {
  return navigationBypass;
}

export function runWithUnsavedNavigationBypass(action: () => void): void {
  navigationBypass = true;
  try {
    action();
  } finally {
    window.setTimeout(() => { navigationBypass = false; }, 0);
  }
}
