'use client';

/**
 * SettingsDrawer — light scenario overrides for the Management Dashboard (PROJ-40).
 *
 * Opens a right-side shadcn Sheet with the five scenario fields (battery kWh,
 * charge kW, plug-in time, departure time, sessions/week). Persists the user's
 * choices to localStorage under MANAGEMENT_STORAGE_KEY — intentionally NOT to
 * URL so the shareable dashboard view remains anchored to the fixed scenario.
 *
 * Exposes `loadScenarioFromStorage()` for the page to hydrate on mount.
 *
 * Requirement covered: MGMT-07.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DEFAULT_MANAGEMENT_SCENARIO,
  MANAGEMENT_STORAGE_KEY,
  type ManagementScenario,
} from '@/lib/management-config';

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenario: ManagementScenario;
  onChange: (next: ManagementScenario) => void;
}

/**
 * Hydrate scenario from localStorage, falling back to defaults on SSR, missing
 * key, or malformed JSON. Kept resilient per threat T-09-D-02.
 */
export function loadScenarioFromStorage(): ManagementScenario {
  if (typeof window === 'undefined') return DEFAULT_MANAGEMENT_SCENARIO;
  try {
    const raw = window.localStorage.getItem(MANAGEMENT_STORAGE_KEY);
    if (!raw) return DEFAULT_MANAGEMENT_SCENARIO;
    const parsed = JSON.parse(raw) as Partial<ManagementScenario>;
    return { ...DEFAULT_MANAGEMENT_SCENARIO, ...parsed };
  } catch {
    return DEFAULT_MANAGEMENT_SCENARIO;
  }
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  open,
  onOpenChange,
  scenario,
  onChange,
}) => {
  // Local working copy of the scenario — edits stay local until Apply.
  const [local, setLocal] = React.useState<ManagementScenario>(scenario);

  // Re-sync the local form when the upstream scenario changes (e.g. reset
  // from outside, or parent hydrates from storage after mount).
  React.useEffect(() => {
    setLocal(scenario);
  }, [scenario]);

  const handleNumber = React.useCallback(
    (field: keyof ManagementScenario) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        const v = Number(raw);
        if (!Number.isFinite(v)) return;
        setLocal((prev) => ({ ...prev, [field]: v }));
      },
    [],
  );

  const handleTime = React.useCallback(
    (field: 'plugInTime' | 'departureTime') =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        if (!/^\d{2}:\d{2}$/.test(v)) return;
        setLocal((prev) => ({ ...prev, [field]: v }));
      },
    [],
  );

  const handleApply = React.useCallback(() => {
    onChange(local);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          MANAGEMENT_STORAGE_KEY,
          JSON.stringify(local),
        );
      } catch {
        // localStorage may be disabled (private mode, quota). Apply still
        // propagates in-memory — persistence is best-effort only.
      }
    }
    onOpenChange(false);
  }, [local, onChange, onOpenChange]);

  const handleReset = React.useCallback(() => {
    setLocal(DEFAULT_MANAGEMENT_SCENARIO);
    onChange(DEFAULT_MANAGEMENT_SCENARIO);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(MANAGEMENT_STORAGE_KEY);
      } catch {
        // Ignore — removal is best-effort.
      }
    }
  }, [onChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:max-w-[380px] flex flex-col gap-5">
        <SheetHeader>
          <SheetTitle>Scenario settings</SheetTitle>
          <SheetDescription className="text-[12px]">
            Adjusts sessions × kWh locally only. The shareable dashboard view
            always uses the fixed default scenario — these changes are saved to
            your browser.
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleApply();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mgmt-battery">Battery capacity (kWh)</Label>
            <Input
              id="mgmt-battery"
              type="number"
              min={10}
              max={200}
              step={1}
              value={local.batteryCapacityKwh}
              onChange={handleNumber('batteryCapacityKwh')}
              className="tabular-nums font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mgmt-power">Charge power (kW)</Label>
            <Input
              id="mgmt-power"
              type="number"
              min={1.4}
              max={22}
              step={0.1}
              value={local.chargePowerKw}
              onChange={handleNumber('chargePowerKw')}
              className="tabular-nums font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mgmt-plugin">Plug-in time</Label>
            <Input
              id="mgmt-plugin"
              type="time"
              value={local.plugInTime}
              onChange={handleTime('plugInTime')}
              className="tabular-nums font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mgmt-departure">Departure time</Label>
            <Input
              id="mgmt-departure"
              type="time"
              value={local.departureTime}
              onChange={handleTime('departureTime')}
              className="tabular-nums font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mgmt-sessions">Sessions per week</Label>
            <Input
              id="mgmt-sessions"
              type="number"
              min={1}
              max={14}
              step={0.5}
              value={local.sessionsPerWeek}
              onChange={handleNumber('sessionsPerWeek')}
              className="tabular-nums font-mono"
            />
          </div>

          <SheetFooter className="flex-col gap-2 sm:flex-row sm:justify-between sm:space-x-0 mt-2">
            <Button type="button" variant="ghost" onClick={handleReset}>
              Reset to defaults
            </Button>
            <Button type="submit" variant="default">
              Apply
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
};
