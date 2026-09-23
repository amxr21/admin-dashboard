'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, RotateCcw } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

const STORAGE_KEY = 'admin-dashboard:guide-checklist:v1';

export interface ChecklistItem {
  id: string;
  label: string;
  detail: string;
}

export interface ChecklistGroup {
  id: string;
  title: string;
  description: string;
  items: readonly ChecklistItem[];
}

interface ChecklistCopy {
  completed: string;
  completeGroup: string;
  resetAll: string;
  resetTitle: string;
  resetDescription: string;
  cancel: string;
  confirmReset: string;
  savedLocally: string;
  saveFailed: string;
}

function readCompleted(): Set<string> {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Set();
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

export function ChecklistBoard({
  groups,
  copy,
}: {
  groups: readonly ChecklistGroup[];
  copy: ChecklistCopy;
}) {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const validIds = useMemo(
    () => new Set(groups.flatMap((group) => group.items.map((item) => item.id))),
    [groups],
  );

  useEffect(() => {
    const stored = readCompleted();
    setCompleted(new Set([...stored].filter((id) => validIds.has(id))));
    setReady(true);
  }, [validIds]);

  function persist(next: Set<string>) {
    setCompleted(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }

  function toggle(itemId: string, checked: boolean) {
    const next = new Set(completed);
    if (checked) next.add(itemId);
    else next.delete(itemId);
    persist(next);
  }

  function completeGroup(group: ChecklistGroup) {
    const next = new Set(completed);
    group.items.forEach((item) => next.add(item.id));
    persist(next);
  }

  function resetAll() {
    setCompleted(new Set());
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
    setConfirmingReset(false);
  }

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const completedCount = completed.size;
  const percent = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  return (
    <div className="space-y-6" aria-busy={!ready}>
      <section aria-labelledby="checklist-progress" className="bg-card rounded-lg border p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-4">
              <h2 id="checklist-progress" className="text-sm font-semibold">
                {copy.completed}: {completedCount} / {total}
              </h2>
              <span className="text-muted-foreground text-sm tabular-nums">{percent}%</span>
            </div>
            <div
              className="bg-secondary mt-3 h-2 overflow-hidden rounded-full"
              role="progressbar"
              aria-labelledby="checklist-progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={completedCount}
            >
              <div className="bg-primary h-full rounded-full transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-muted-foreground mt-2 text-xs">{copy.savedLocally}</p>
            {saveFailed ? <p className="text-destructive mt-2 text-sm" role="alert">{copy.saveFailed}</p> : null}
          </div>
          <Button className="min-h-11" type="button" variant="outline" onClick={() => setConfirmingReset(true)}>
            <RotateCcw aria-hidden />
            {copy.resetAll}
          </Button>
        </div>
      </section>

      {groups.map((group) => {
        const groupCompleted = group.items.filter((item) => completed.has(item.id)).length;
        const allCompleted = groupCompleted === group.items.length;

        return (
          <section key={group.id} aria-labelledby={`checklist-${group.id}`} className="bg-card rounded-lg border">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
              <div>
                <h2 id={`checklist-${group.id}`} className="font-semibold">{group.title}</h2>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{group.description}</p>
                <p className="text-muted-foreground mt-2 text-xs tabular-nums">
                  {copy.completed}: {groupCompleted} / {group.items.length}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="min-h-11"
                variant="outline"
                disabled={allCompleted}
                onClick={() => completeGroup(group)}
              >
                <CheckCheck aria-hidden />
                {copy.completeGroup}
              </Button>
            </div>

            <ul className="divide-y">
              {group.items.map((item) => {
                const checked = completed.has(item.id);
                return (
                  <li key={item.id} className="p-4 sm:px-5">
                    <label className="flex min-h-11 cursor-pointer items-start gap-3">
                      <Checkbox
                        className="mt-1 size-5"
                        checked={checked}
                        onCheckedChange={(value) => toggle(item.id, value === true)}
                      />
                      <span className="min-w-0">
                        <span className={checked ? 'text-muted-foreground text-sm font-medium line-through' : 'text-sm font-medium'}>
                          {item.label}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-sm leading-relaxed">{item.detail}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <AlertDialog open={confirmingReset} onOpenChange={setConfirmingReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.resetTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.resetDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={resetAll}>{copy.confirmReset}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
