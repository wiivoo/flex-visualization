'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface TutorialStep {
  targetId: string       // empty string = concept step (centered modal, no spotlight)
  title: string
  description: string
  bullets?: string[]     // optional bullet points for dense steps
  position: 'right' | 'left' | 'bottom' | 'top' | 'center'
  icon?: string          // emoji for concept steps
}

const CONCEPT_STEPS: TutorialStep[] = [
  {
    targetId: '',
    title: 'Welcome to FlexMon',
    description: 'This guide walks you through how smart EV charging creates real value — and how this dashboard lets you explore it with actual market data.',
    position: 'center',
    icon: '⚡',
  },
  {
    targetId: '',
    title: 'The Shape Problem',
    description: 'Electricity is traditionally bought as flat "baseload" blocks — the same price for every hour. But EV charging only needs power for 3–4 hours. You\'re paying for a shape you don\'t need. Smart charging exploits this mismatch.',
    position: 'center',
    icon: '📊',
  },
  {
    targetId: '',
    title: 'Day-Ahead Optimization',
    description: 'Every day at noon, hourly prices for the next day are published on EPEX Spot. Smart charging shifts your load to the cheapest hours within your availability window. This is the primary source of savings you see in this dashboard. (Data via SMARD/ENTSO-E.)',
    position: 'center',
    icon: '📈',
  },
  {
    targetId: '',
    title: 'Intraday Fine-Tuning',
    description: 'After day-ahead, prices are updated continuously on the intraday market — up to 5 minutes before delivery. This allows further optimization, especially when wind or solar forecasts change.',
    position: 'center',
    icon: '🔄',
  },
  {
    targetId: '',
    title: 'Portfolio Effect',
    description: 'With more cars, individual forecast errors cancel out (√N effect). A fleet of 100 cars has 10× lower relative uncertainty than a single car. This makes optimization more reliable and unlocks larger trading volumes.',
    position: 'center',
    icon: '🚗',
  },
  {
    targetId: '',
    title: 'The Flex Band',
    description: 'Between "charge immediately" (greedy) and "charge as late as possible" (lazy) lies the flex band — your optimization playground. A wider band means more hours to choose from and higher potential savings.',
    position: 'center',
    icon: '📐',
  },
  {
    targetId: '',
    title: 'Fleet Mode',
    description: 'Switch from "Single" to "Fleet" in the EV Charging Profile to model 1,000 EVs with distributed arrival times, departure times, and charging needs. The orange flex band shows the aggregate flexibility envelope — red fill is the "charge ASAP" baseline, blue fill is the price-optimized schedule. All savings are shown per EV.',
    position: 'center',
    icon: '🏢',
  },
]

const TOUR_STEPS: TutorialStep[] = [
  {
    targetId: 'tour-customer-profile',
    title: 'EV Charging Profile',
    description: 'Toggle between Single (one car) and Fleet (1,000 EVs) mode.',
    bullets: [
      'Single: set mileage, plug-in frequency, arrival/departure time',
      'Fleet: set per-EV mileage & frequency, plus arrival/departure distributions with min/max range markers',
      'Fleet Spread: off (identical cars), narrow, normal, or wide distribution',
      'All charts update instantly as you adjust parameters',
    ],
    position: 'bottom',
  },
  {
    targetId: 'tour-day-selector',
    title: 'Pick a Day',
    description: 'Each day has different electricity prices. The color bars indicate how much prices varied — more variation means more savings potential.',
    position: 'bottom',
  },
  {
    targetId: 'tour-price-chart',
    title: 'Price Curve & Charging Overlay',
    description: 'Real EPEX Spot day-ahead prices (via SMARD/ENTSO-E).',
    bullets: [
      'Single: red dots = charge now, blue dots = smart charging',
      'Fleet: orange band = flexibility envelope, red fill = charge ASAP, blue fill = optimized',
      'Blue dots on price curve show where fleet charges (size = intensity)',
      'Drag arrival/departure pills to shift the window',
      'Savings pill at top shows ct/kWh difference',
    ],
    position: 'bottom',
  },
  {
    targetId: 'tour-scenario-cards',
    title: 'Compare Charging Windows',
    description: 'See how 12h, 24h, and 72h windows affect your savings — works for both single and fleet.',
    bullets: [
      'Each card independently computes savings for its window',
      'Fleet: savings shown per EV in ct/kWh + EUR',
      '4-week and 52-week rolling averages for each window',
      'Click a card to switch the chart view',
    ],
    position: 'top',
  },
  {
    targetId: 'tour-monthly-savings',
    title: 'Track Savings Over Time',
    description: 'Monthly and yearly savings trends. Fleet mode shows per-EV values.',
    bullets: [
      'Monthly chart: savings per month with cumulative trend line',
      'Yearly card: year-over-year comparison',
      'Daily heatmap: calendar view with per-day savings',
      'Winter months typically have higher price swings',
    ],
    position: 'top',
  },
]

const STEPS: TutorialStep[] = [...TOUR_STEPS]

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
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<SpotlightRect | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [visible, setVisible] = useState(false)
  const rafRef = useRef<number>(0)
  const nextBtnRef = useRef<HTMLButtonElement>(null)

  const currentStep = STEPS[step]

  // Fade-in on step change
  useEffect(() => {
    if (!active) return
    setVisible(false)
    const t = setTimeout(() => setVisible(true), 60)
    return () => clearTimeout(t)
  }, [active, step])

  // Focus the Next button on step change
  useEffect(() => {
    if (!active || !visible) return
    const t = setTimeout(() => nextBtnRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [active, step, visible])

  const handleClose = useCallback(() => {
    setStep(0)
    onClose()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [onClose])

  const measureTarget = useCallback(() => {
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
  }, [currentStep.targetId])

  // Scroll to target and measure (skip for concept steps)
  useEffect(() => {
    if (!active) return
    setIsTransitioning(true)
    const el = document.getElementById(currentStep.targetId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    const timeout = setTimeout(() => {
      measureTarget()
      setIsTransitioning(false)
    }, 500)
    return () => clearTimeout(timeout)
  }, [active, step, currentStep.targetId, measureTarget])

  // Re-measure on resize/scroll
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

  // Keyboard navigation
  useEffect(() => {
    if (!active) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (step < STEPS.length - 1) setStep(s => s + 1)
        else handleClose()
      }
      if (e.key === 'ArrowLeft' && step > 0) setStep(s => s - 1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [active, step, handleClose])

  if (!active) return null

  // Compute card position relative to viewport
  const viewportRect = rect ? {
    top: rect.top - window.scrollY,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  } : null

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640

  const cardStyle = isMobile
    ? { bottom: 16, left: 16, right: 16 } as React.CSSProperties
    : getCardPosition(viewportRect, currentStep.position as 'right' | 'left' | 'bottom' | 'top')

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Tutorial guide" aria-describedby="tutorial-desc">
      {/* Backdrop with spotlight cutout */}
      <div
        className="absolute inset-0 transition-all duration-300"
        style={{
          background: 'rgba(0,0,0,0.45)',
          clipPath: viewportRect && !isTransitioning
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
        onClick={() => {
          // Do nothing — user must use Exit or Finish
        }}
      />

      {/* Spotlight border highlight */}
      {viewportRect && !isTransitioning && (
        <div
          className="absolute rounded-lg border-2 border-white/60 pointer-events-none transition-all duration-300"
          style={{
            top: viewportRect.top,
            left: viewportRect.left,
            width: viewportRect.width,
            height: viewportRect.height,
          }}
        />
      )}

      {/* Explanation card */}
      <div
        className={`fixed bg-white rounded-xl shadow-2xl border border-gray-200 p-5 z-[101] transition-all duration-200 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        } ${isMobile ? 'max-h-[45vh] overflow-y-auto' : 'w-[360px]'}`}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mb-3" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length} aria-label={`Tour step ${step + 1} of ${STEPS.length}`}>
          <span className="text-[11px] font-medium text-[#313131]">Tour</span>
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === step
                  ? 'w-5 bg-[#313131]'
                  : `w-2 ${i < step ? 'bg-[#313131]/30' : 'bg-gray-300'}`
              }`}
            />
          ))}
          <span className="text-[11px] text-gray-500 ml-auto">{step + 1}/{STEPS.length}</span>
        </div>

        {/* Content */}
        <h3 id="tutorial-title" className="font-bold text-[#313131] mb-1.5 text-base">
          {currentStep.title}
        </h3>
        <p id="tutorial-desc" className="text-gray-600 leading-relaxed text-[13px]">
          {currentStep.description}
        </p>
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

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <button
            onClick={handleClose}
            className="text-xs text-gray-500 hover:text-gray-700 py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors"
            aria-label="Exit guide"
          >
            Exit
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                aria-label="Previous step"
              >
                Back
              </button>
            )}
            <button
              ref={nextBtnRef}
              onClick={() => {
                if (step < STEPS.length - 1) setStep(s => s + 1)
                else handleClose()
              }}
              className="text-xs font-semibold text-white px-5 py-2 rounded-lg transition-colors bg-[#313131] hover:bg-[#1a1a1a]"
              aria-label={step < STEPS.length - 1 ? 'Next step' : 'Finish guide'}
            >
              {step < STEPS.length - 1 ? 'Next' : 'Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Compute the position of the explanation card relative to the spotlight */
function getCardPosition(
  rect: { top: number; left: number; width: number; height: number } | null,
  preferred: 'right' | 'left' | 'bottom' | 'top',
): React.CSSProperties {
  if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

  const cardW = 360
  const cardH = 240
  const gap = 16
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900

  // Try preferred position, then fallback
  const positions = [preferred, 'bottom', 'right', 'left', 'top']

  for (const pos of positions) {
    if (pos === 'right' && rect.left + rect.width + gap + cardW < vw) {
      return { top: Math.max(gap, Math.min(rect.top, vh - cardH - gap)), left: rect.left + rect.width + gap }
    }
    if (pos === 'left' && rect.left - gap - cardW > 0) {
      return { top: Math.max(gap, Math.min(rect.top, vh - cardH - gap)), left: rect.left - gap - cardW }
    }
    if (pos === 'bottom' && rect.top + rect.height + gap + cardH < vh) {
      return { top: rect.top + rect.height + gap, left: Math.max(gap, Math.min(rect.left, vw - cardW - gap)) }
    }
    if (pos === 'top' && rect.top - gap - cardH > 0) {
      return { top: rect.top - gap - cardH, left: Math.max(gap, Math.min(rect.left, vw - cardW - gap)) }
    }
  }

  // Fallback: center
  return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
}
