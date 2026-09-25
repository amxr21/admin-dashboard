'use client';

import { useEffect, useState } from 'react';

import { useCanAccessArea } from '@/components/providers/role-permissions-provider';
import type { StaffRole } from '@/config/areas';
import { fetchCampaignReadiness } from '@/lib/campaigns-api';

/** One readiness request per page load, shared by every caller. */
let cached: Promise<boolean> | null = null;

/**
 * Whether campaign tools should be offered at all: the role can reach
 * customers AND at least one channel (email or SMS) can actually send.
 * Until a provider is configured the tools stay out of the way.
 */
export function useCampaignsAvailable(role: StaffRole | null): boolean {
  const canAccessArea = useCanAccessArea();
  const allowed = role !== null && canAccessArea(role, 'customers');
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!allowed) {
      setAvailable(false);
      return;
    }
    let active = true;
    cached ??= fetchCampaignReadiness()
      .then((readiness) => readiness.EMAIL.ready || readiness.SMS.ready)
      .catch(() => {
        cached = null;
        return false;
      });
    void cached.then((value) => {
      if (active) setAvailable(value);
    });
    return () => {
      active = false;
    };
  }, [allowed]);

  return available;
}