'use client'

import { Battery } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type ConfigState } from '@/lib/config'

interface ChargingSettingsProps {
  config: Pick<ConfigState, 'start_level_percent' | 'window_start' | 'window_end'>
  onChange: (key: keyof ConfigState, value: string | number) => void
}

export function ChargingSettings({ config, onChange }: ChargingSettingsProps) {
  const startLevels = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Battery className="h-4 w-4" />
          Lade-Einstellungen
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="start-level">Start-Level</Label>
            <Select
              value={config.start_level_percent.toString()}
              onValueChange={(v) => onChange('start_level_percent', parseInt(v))}
            >
              <SelectTrigger id="start-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {startLevels.map((level) => (
                  <SelectItem key={level} value={level.toString()}>
                    {level}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="window-start">Zeitfenster Von</Label>
            <Select
              value={config.window_start}
              onValueChange={(v) => onChange('window_start', v)}
            >
              <SelectTrigger id="window-start">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hours.map((hour) => (
                  <SelectItem key={hour} value={`${hour}:00`}>
                    {hour}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="window-end">Zeitfenster Bis</Label>
            <Select
              value={config.window_end}
              onValueChange={(v) => onChange('window_end', v)}
            >
              <SelectTrigger id="window-end">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hours.map((hour) => (
                  <SelectItem key={hour} value={`${hour}:00`}>
                    {hour}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-md bg-muted p-3">
          <p className="text-sm">
            Das Fahrzeug wird zwischen{' '}
            <span className="font-semibold">{config.window_start}</span> und{' '}
            <span className="font-semibold">{config.window_end}</span> Uhr geladen.
            Start-Level: <span className="font-semibold">{config.start_level_percent}%</span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
