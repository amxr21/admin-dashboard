/**
 * Developer view: a DEVELOPER can switch off the setup wizard's effect on
 * what is VISIBLE, to see every page whatever the owner chose. Per browser,
 * like the dashboard mode: it is a way of looking at the app, not a store
 * setting, so it never changes what the owner or staff see.
 *
 * Visibility only. The features.*.enabled flags hide pages and menu entries;
 * the API never enforced them, so nothing extra is unlocked server-side.
 */

const STORAGE_KEY = 'developer.showEverything';

export function readDeveloperView(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDeveloperView(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A blocked store just means the choice lasts for this visit only.
  }
}
