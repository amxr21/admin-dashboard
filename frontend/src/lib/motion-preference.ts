export const MOTION_STORAGE_KEY = 'admin-dashboard:motion-enabled';

/**
 * Applies the saved/OS motion preference before React hydrates so CSS-driven
 * dialogs, drawers and loading feedback never animate for one frame first.
 */
export function getBlockingMotionScript(): string {
  return `(function(){try{var k='${MOTION_STORAGE_KEY}';var s=localStorage.getItem(k);var e=s===null?!window.matchMedia('(prefers-reduced-motion: reduce)').matches:s==='true';document.documentElement.dataset.motion=e?'full':'reduced'}catch(e){}})();`;
}
