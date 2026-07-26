'use client';

/**
 * Central GSAP setup. Import `gsap` and `useGSAP` FROM HERE — never register
 * plugins in individual components, or registration order becomes dependent on
 * which component happens to mount first.
 *
 * All GSAP plugins have been free since April 2025 (Webflow released the
 * formerly Club-only ones). No licence key, no auth token, commercial use fine.
 */

import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Flip } from 'gsap/Flip';

/**
 * Registered once, on the client only.
 *
 * The `typeof window` guard is not optional: these plugins touch `document` at
 * registration time, so importing this module during SSR or in a Node test
 * environment throws without it.
 *
 * Only ScrollTrigger and Flip are registered — the two the dashboard will
 * actually use (scroll reveals, and animating table/grid layout changes).
 * Register others here as they're genuinely needed; each one is bundle weight.
 */
if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP, ScrollTrigger, Flip);
}

export { gsap, useGSAP, ScrollTrigger, Flip };
