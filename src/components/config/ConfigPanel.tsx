'use client'

import { useState, useEffect } from 'react'
import { Settings, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { VehicleSelector } from './VehicleSelector'
import { PriceInputs } from './PriceInputs'
import { ChargingSettings } from './ChargingSettings'
import { ConfigState, loadConfig, saveConfig, resetConfig } from '@/lib/config'

interface ConfigPanelProps {
  onConfigChange?: (config: ConfigState) => void
  trigger?: React.ReactNode
}

export function ConfigPanel({ onConfigChange, trigger }: ConfigPanelProps) {
  const [config, setConfig] = useState<ConfigState>(loadConfig())
  const [errors, setErrors] = useState<string[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setConfig(loadConfig())
  }, [open])

  const handleChange = (key: keyof ConfigState, value: string | number) => {
    setConfig((prev) => ({
      ...prev,
      [key]: value
    }))
  }

  const validateConfig = (cfg: ConfigState): string[] => {
    const errs: string[] = []

    if (cfg.base_price_ct_kwh < 10 || cfg.base_price_ct_kwh > 100) {
      errs.push('Basispreis muss 10-100 ct/kWh sein')
    }
    if (cfg.margin_ct_kwh < 0 || cfg.margin_ct_kwh > 20) {
      errs.push('Marge muss 0-20 ct/kWh sein')
    }
    if (cfg.customer_discount_ct_kwh < 0 || cfg.customer_discount_ct_kwh > 50) {
      errs.push('Rabatt muss 0-50 ct/kWh sein')
    }
    if (cfg.margin_ct_kwh > cfg.base_price_ct_kwh) {
      errs.push('Marge darf nicht höher als Basispreis sein')
    }

    return errs
  }

  const handleApply = () => {
    const validationErrors = validateConfig(config)
    setErrors(validationErrors)

    if (validationErrors.length === 0) {
      saveConfig(config)
      onConfigChange?.(config)
      setOpen(false)
    }
  }

  const handleReset = () => {
    const defaultConfig = resetConfig()
    setConfig(defaultConfig)
    setErrors([])
    onConfigChange?.(defaultConfig)
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || (
          <Button variant="outline" size="icon">
            <Settings className="h-4 w-4" />
            <span className="sr-only">Einstellungen</span>
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Konfiguration</SheetTitle>
          <SheetDescription>
            Passe die Fahrzeug- und Preisparameter an
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <VehicleSelector value={config.vehicle} onChange={(v) => handleChange('vehicle', v)} />

          <Separator />

          <PriceInputs config={config} onChange={handleChange} errors={errors} />

          <Separator />

          <ChargingSettings config={config} onChange={handleChange} />

          <Separator />

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReset} className="flex-1">
              Zurücksetzen
            </Button>
            <Button onClick={handleApply} className="flex-1">
              Anwenden
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
