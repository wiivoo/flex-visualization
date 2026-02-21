'use client'

import { ConfigState, VEHICLE_PROFILES, saveConfig } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { X, Car, Battery, Clock } from 'lucide-react'

interface QuickConfigPanelProps {
  config: ConfigState
  onConfigChange: (config: ConfigState) => void
  onClose: () => void
}

export function QuickConfigPanel({ config, onConfigChange, onClose }: QuickConfigPanelProps) {
  const updateVehicle = (vehicle: ConfigState['vehicle']) => {
    const newConfig = { ...config, vehicle }
    onConfigChange(newConfig)
    saveConfig(newConfig)
  }

  const updateStartLevel = (level: number) => {
    const newConfig = { ...config, start_level_percent: level }
    onConfigChange(newConfig)
    saveConfig(newConfig)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Schnellkonfiguration</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Vehicle Selection */}
      <div>
        <label className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Car className="h-4 w-4" />
          Fahrzeugtyp
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(VEHICLE_PROFILES) as Array<keyof typeof VEHICLE_PROFILES>).map((type) => (
            <button
              key={type}
              onClick={() => updateVehicle(type)}
              className={`rounded-lg border p-3 text-center transition-colors ${
                config.vehicle === type
                  ? 'border-primary bg-primary/10 font-medium'
                  : 'border-border bg-background hover:bg-muted'
              }`}
            >
              <div className="mb-1 text-lg">{type === 'klein' ? '🚗' : type === 'medium' ? '🚙' : '🚚'}</div>
              <div className="text-xs">{VEHICLE_PROFILES[type].name}</div>
              <div className="text-xs text-muted-foreground">{VEHICLE_PROFILES[type].battery_kwh} kWh</div>
            </button>
          ))}
        </div>
      </div>

      {/* Start Level */}
      <div>
        <label className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Battery className="h-4 w-4" />
          Start-Batterielevel: {config.start_level_percent}%
        </label>
        <input
          type="range"
          min="0"
          max="90"
          step="10"
          value={config.start_level_percent}
          onChange={(e) => updateStartLevel(parseInt(e.target.value))}
          className="w-full"
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>0%</span>
          <span>50%</span>
          <span>90%</span>
        </div>
      </div>

      {/* Ladefenster */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span>Ladefenster</span>
        </div>
        <span className="font-medium">
          {config.window_start} - {config.window_end}
        </span>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => {
            const newConfig = { ...config, start_level_percent: 20 }
            onConfigChange(newConfig)
            saveConfig(newConfig)
          }}
        >
          Auf Standard zurücksetzen
        </Button>
      </div>
    </div>
  )
}
