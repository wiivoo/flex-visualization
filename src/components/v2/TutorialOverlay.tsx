'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface TutorialStep {
  targetId: string
  title: string
  description: string
  bullets?: string[]
  position: 'right' | 'left' | 'bottom' | 'top' | 'center'
  icon?: string
}

const SINGLE_STEPS: TutorialStep[] = [
  {
    targetId: '',
    title: 'Smart EV Charging',
    description: 'This guide shows how load shifting creates real value using actual day-ahead electricity market data.',
    position: 'center',
  },
  {
    targetId: '',
    title: 'Day-Ahead Optimization',
    description: 'Every day at noon, hourly prices for the next day are published on EPEX Spot. Smart charging shifts your load to the cheapest hours within your availability window.',
    position: 'center',
  },
  {
    targetId: 'tour-customer-profile',
    title: 'EV Charging Profile',
    description: 'Set your driving pattern. Toggle "Single / Fleet" at the top.',
    bullets: [
      'Yearly mileage and plug-in frequency determine energy per session',
      'Plug-in time sets when you arrive home',
      'Charge power: 7 kW or 11 kW wallbox',
    ],
    position: 'right',
  },
  {
    targetId: 'tour-day-selector',
    title: 'Pick a Day',
    description: 'Each day has different electricity prices. Color bars show price variation — more variation = more savings potential.',
    position: 'bottom',
  },
  {
    targetId: 'tour-price-chart',
    title: 'Find the Cheapest Hours',
    description: 'Real EPEX Spot day-ahead prices.',
    bullets: [
      'Red dots = immediate charging ("charge now")',
      'Blue dots = cheapest hours (smart charging)',
      'Drag the arrival/departure pills to adjust your window',
      'Green pill at top shows savings in ct/kWh',
    ],
    position: 'bottom',
  },
  {
    targetId: 'tour-scenario-cards',
    title: 'Compare Charging Windows',
    description: 'See how 12h, 24h, and 72h windows affect your savings. Click a card to switch the chart view.',
    position: 'top',
  },
  {
    targetId: 'tour-monthly-savings',
    title: 'Track Savings Over Time',
    description: 'Monthly and yearly savings with smart charging. Winter months typically show higher savings due to larger price swings.',
    position: 'top',
  },
]

const FLEET_STEPS: TutorialStep[] = [
  {
    targetId: '',
    title: 'Fleet Charging Optimization',
    description: 'Fleet mode models 1,000 EVs with distributed arrival/departure times and charging needs. All savings are shown per EV.',
    position: 'center',
  },
  {
    targetId: '',
    title: 'The Flex Band',
    description: 'The orange envelope on the chart shows the fleet\'s aggregate flexibility. Between "charge ASAP" and "defer to latest" lies the optimization playground — a wider band means more value.',
    position: 'center',
  },
  {
    targetId: 'tour-customer-profile',
    title: 'Fleet Configuration',
    description: 'Configure the fleet\'s average behavior with per-EV settings.',
    bullets: [
      'Yearly mileage + weekly plug-ins per EV',
      'Arrival/departure time with min/max triangle markers for fleet spread',
      'Fleet Spread: off (identical), narrow, normal, or wide distribution',
      'Charge power: 7 kW or 11 kW',
    ],
    position: 'right',
  },
  {
    targetId: 'tour-price-chart',
    title: 'Fleet on the Price Curve',
    description: 'The chart shows three layers of fleet charging.',
    bullets: [
      'Orange band = flexibility envelope (where fleet CAN charge)',
      'Red fill + dots = charge ASAP baseline (front-loaded)',
      'Blue fill + dots = price-optimized schedule (cheapest hours)',
      'Dot size = charge intensity at that hour',
      'Drag avg arrival/departure pills to shift the window',
    ],
    position: 'bottom',
  },
  {
    targetId: 'tour-scenario-cards',
    title: 'Fleet Savings per Window',
    description: 'Each card independently computes fleet optimization for its window.',
    bullets: [
      'Savings in ct/kWh per EV — same metric as single car',
      '12h = overnight, 24h = workplace, 72h = long-stay',
      '4-week and 52-week rolling averages',
    ],
    position: 'top',
  },
  {
    targetId: 'tour-monthly-savings',
    title: 'Fleet Savings Over Time',
    description: 'Monthly and yearly per-EV savings. All values normalized for the fleet.',
    bullets: [
      'Projected annual savings per EV',
      'Monthly chart shows per-EV trend',
      'Daily heatmap for day-by-day analysis',
    ],
    position: 'top',
  },
]

interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}

interface Props {
  active: boolean
  onClose: () => void
}

export function TutorialOverlay({ active, onClose }: Props) {
  const [mode, setMode] = useState<'select' | 'single' | 'fleet'>('select')
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<SpotlightRect | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [visible, setVisible] = useState(false)
  const rafRef = useRef<number>(0)

  const steps = mode === 'fleet' ? FLEET_STEPS : SINGLE_STEPS
  const currentStep = steps[step]

  useEffect(() => {
    if (!active) { setMode('select'); setStep(0) }
  }, [active])

  useEffect(() => {
    if (!active) return
    setVisible(false)
    const t = setTimeout(() => setVisible(true), 60)
    return () => clearTimeout(t)
  }, [active, step, mode])

  const handleClose = useCallback(() => {
    setStep(0)
    setMode('select')
    onClose()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [onClose])

  const measureTarget = useCallback(() => {
    if (!currentStep?.targetId) return
    const el = document.getElementById(currentStep.targetId)
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 8
    setRect({
      top: r.top - pad + window.scrollY,
      left: r.left - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    })
  }, [currentStep?.targetId])

  useEffect(() => {
    if (!active || mode === 'select') return
    setIsTransitioning(true)
    const el = currentStep?.targetId ? document.getElementById(currentStep.targetId) : null
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    else setRect(null)
    const timeout = setTimeout(() => {
      measureTarget()
      setIsTransitioning(false)
    }, 500)
    return () => clearTimeout(timeout)
  }, [active, step, mode, currentStep?.targetId, measureTarget])

  useEffect(() => {
    if (!active) return
    const handleUpdate = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(measureTarget)
    }
    window.addEventListener('resize', handleUpdate)
    window.addEventListener('scroll', handleUpdate, true)
    return () => {
      window.removeEventListener('resize', handleUpdate)
      window.removeEventListener('scroll', handleUpdate, true)
      cancelAnimationFrame(rafRef.current)
    }
  }, [active, measureTarget])

  useEffect(() => {
    if (!active) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
      if (mode === 'select') return
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (step < steps.length - 1) setStep(s => s + 1)
        else handleClose()
      }
      if (e.key === 'ArrowLeft' && step > 0) setStep(s => s - 1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [active, step, mode, steps.length, handleClose])

  if (!active) return null

  // Mode selection screen
  if (mode === 'select') {
    return (
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-2xl border border-gray-200 p-6 w-[360px]">
          <h3 className="font-bold text-[#313131] text-lg mb-1">Choose Guide</h3>
          <p className="text-[13px] text-gray-500 mb-5">Select which tutorial to walk through.</p>
          <div className="space-y-3">
            <button
              onClick={() => { setMode('single'); setStep(0) }}
              className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
            >
              <span className="font-semibold text-[#313131]">Single EV Guide</span>
              <p className="text-[12px] text-gray-500 mt-0.5">How smart charging saves money for one car</p>
            </button>
            <button
              onClick={() => { setMode('fleet'); setStep(0) }}
              className="w-full text-left px-4 py-3 rounded-lg border border-blue-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
            >
              <span className="font-semibold text-blue-700">Fleet Guide</span>
              <p className="text-[12px] text-gray-500 mt-0.5">Fleet optimization with flex band and per-EV savings</p>
            </button>
          </div>
          <button onClick={handleClose} className="mt-4 text-xs text-gray-400 hover:text-gray-600">
            Skip
          </button>
        </div>
      </div>
    )
  }

  const viewportRect = rect ? {
    top: rect.top - window.scrollY,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  } : null

  const isConceptStep = !currentStep.targetId
  const cardStyle = isConceptStep
    ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } as React.CSSProperties
    : getCardPosition(viewportRect, currentStep.position as 'right' | 'left' | 'bottom' | 'top')

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop with spotlight cutout */}
      <div
        className="absolute inset-0 transition-all duration-300"
        style={{
          background: 'rgba(0,0,0,0.45)',
          clipPath: viewportRect && !isTransitioning && !isConceptStep
            ? `polygon(
                0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                ${viewportRect.left}px ${viewportRect.top}px,
                ${viewportRect.left}px ${viewportRect.top + viewportRect.height}px,
                ${viewportRect.left + viewportRect.width}px ${viewportRect.top + viewportRect.height}px,
                ${viewportRect.left + viewportRect.width}px ${viewportRect.top}px,
                ${viewportRect.left}px ${viewportRect.top}px
              )`
            : undefined,
        }}
      />

      {/* Spotlight border */}
      {viewportRect && !isTransitioning && !isConceptStep && (
        <div className="absolute rounded-lg border-2 border-white/60 pointer-events-none transition-all duration-300"
          style={{ top: viewportRect.top, left: viewportRect.left, width: viewportRect.width, height: viewportRect.height }} />
      )}

      {/* Explanation card */}
      <div
        className={`fixed bg-white rounded-xl shadow-2xl border border-gray-200 p-5 z-[101] transition-all duration-200 w-[360px] max-h-[70vh] overflow-y-auto ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[11px] font-medium text-[#313131]">{mode === 'fleet' ? 'Fleet' : 'Single'}</span>
          {steps.map((_, i) => (
            <div key={i} className={`h-2 rounded-full transition-all ${i === step ? 'w-5 bg-[#313131]' : `w-2 ${i < step ? 'bg-[#313131]/30' : 'bg-gray-300'}`}`} />
          ))}
          <span className="text-[11px] text-gray-500 ml-auto">{step + 1}/{steps.length}</span>
        </div>

        <h3 className="font-bold text-[#313131] mb-1.5 text-base">{currentStep.title}</h3>
        <p className="text-gray-600 leading-relaxed text-[13px]">{currentStep.description}</p>
        {currentStep.bullets && (
          <ul className="mt-2 space-y-1">
            {currentStep.bullets.map((b, i) => (
              <li key={i} className="text-[13px] text-gray-600 flex items-start gap-1.5">
                <span className="text-gray-400 mt-0.5 shrink-0">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Navigation — on the card itself */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <button onClick={handleClose} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50">
            Exit
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} className="text-xs font-medium text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50">
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (step < steps.length - 1) setStep(s => s + 1)
                else handleClose()
              }}
              className="text-xs font-semibold text-white px-5 py-2 rounded-lg bg-[#313131] hover:bg-[#1a1a1a]"
            >
              {step < steps.length - 1 ? 'Next' : 'Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function getCardPosition(
  rect: { top: number; left: number; width: number; height: number } | null,
  preferred: 'right' | 'left' | 'bottom' | 'top',
): React.CSSProperties {
  if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

  const cardW = 360
  const cardH = 300
  const gap = 16
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const bottomBar = 56 // fixed nav bar height

  const positions = [preferred, 'bottom', 'right', 'left', 'top']

  for (const pos of positions) {
    if (pos === 'right' && rect.left + rect.width + gap + cardW < vw) {
      return { top: Math.max(gap, Math.min(rect.top, vh - cardH - gap - bottomBar)), left: rect.left + rect.width + gap }
    }
    if (pos === 'left' && rect.left - gap - cardW > 0) {
      return { top: Math.max(gap, Math.min(rect.top, vh - cardH - gap - bottomBar)), left: rect.left - gap - cardW }
    }
    if (pos === 'bottom' && rect.top + rect.height + gap + cardH < vh - bottomBar) {
      return { top: rect.top + rect.height + gap, left: Math.max(gap, Math.min(rect.left, vw - cardW - gap)) }
    }
    if (pos === 'top' && rect.top - gap - cardH > 0) {
      return { top: rect.top - gap - cardH, left: Math.max(gap, Math.min(rect.left, vw - cardW - gap)) }
    }
  }

  return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
}
