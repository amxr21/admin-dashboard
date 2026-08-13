import { apiFetch } from '@/lib/api';
import type { Area, StaffRole } from '@/config/areas';

/**
 * Reads the LIVE permission model from `GET /roles` — deliberately NOT the
 * hardcoded copy in `config/areas.ts`. That copy exists so the sidebar can
 * render before any network round trip, and is explicitly documented there
 * as advisory ("a stale copy here can never grant access, only mislabel a
 * menu"). A permissions MATRIX is the one screen whose entire purpose is to
 * be trustworthy about what each role can actually reach, so it reads from
 * the same source `roles.route.ts` itself reads — `config/roles.ts` on the
 * server — rather than adding a third copy that could disagree with both.
 */

export interface RoleGrant {
  role: StaffRole;
  label: string;
  areas: Area[];
  readOnly: boolean;
}

export interface RolesModel {
  roles: RoleGrant[];
  areas: Area[];
}

export async function fetchRolesModel(): Promise<RolesModel> {
  return apiFetch<RolesModel>('/roles');
}
