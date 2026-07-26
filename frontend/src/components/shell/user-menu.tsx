'use client';

import { useTranslations } from 'next-intl';
import { LogOut, UserRound } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isReadOnlyRole, type StaffRole } from '@/config/areas';

interface UserMenuProps {
  name: string;
  email: string;
  role: StaffRole;
  onSignOut?: () => void;
}

export function UserMenu({ name, email, role, onSignOut }: UserMenuProps) {
  const t = useTranslations('common');
  const tRoles = useTranslations('roles');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <UserRound className="size-4" aria-hidden />
          {/* Hidden on small screens — the avatar alone is enough there, and a
              long name would push the topbar controls off-screen. */}
          <span className="hidden max-w-32 truncate sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>

      {/* `align="end"` is LOGICAL — Radix anchors it to the reading-end edge,
          so it flips correctly in Arabic with no manual positioning. */}
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            <span className="truncate text-sm font-medium">{name}</span>
            {/* force-ltr: an email must never visually reorder inside an
                Arabic UI — it becomes genuinely unreadable, not just
                misaligned. */}
            <span className="text-muted-foreground force-ltr truncate text-xs">
              {email}
            </span>
            <div className="pt-1">
              <Badge variant={isReadOnlyRole(role) ? 'warning' : 'secondary'}>
                {tRoles(role)}
              </Badge>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
          {/* Directional: an exit arrow points along the reading direction, so
              it must mirror in RTL. */}
          <LogOut className="icon-directional" aria-hidden />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
