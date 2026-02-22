'use client'

import { Car, Van, Truck } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { VEHICLE_PROFILES, type ConfigState } from '@/lib/config'

interface VehicleSelectorProps {
  value: ConfigState['vehicle']
  onChange: (value: ConfigState['vehicle']) => void
}

export function VehicleSelector({ value, onChange }: VehicleSelectorProps) {
  return (
    <div className="space-y-3">
      <Label className="text-base font-medium">Vehicle Type</Label>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as ConfigState['vehicle'])}>
        <div className="space-y-2">
          {Object.entries(VEHICLE_PROFILES).map(([id, profile]) => {
            const Icon = id === 'klein' ? Car : id === 'medium' ? Car : Van
            return (
              <Card
                key={id}
                className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                  value === id ? 'border-primary bg-primary/5' : ''
                }`}
                onClick={() => onChange(id as ConfigState['vehicle'])}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <RadioGroupItem value={id} id={`vehicle-${id}`} className="sr-only" />
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      value === id ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor={`vehicle-${id}`} className="cursor-pointer font-medium">
                      {profile.name}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {profile.battery_kwh} kWh · {profile.charge_power_kw} kW · {profile.range_km} km
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">e.g.</p>
                    <p className="text-sm">{profile.examples.slice(0, 2).join(', ')}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </RadioGroup>
    </div>
  )
}
