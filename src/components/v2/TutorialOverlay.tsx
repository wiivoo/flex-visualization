'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface TutorialStep {
  targetId: string
  title: string
  description: string
  position: 'right' | 'left' | 'bottom' | 'top'
}

const STEPS: TutorialStep[] = [
  {
    targetId: 'tour-customer-profile',
    title: 'Your Charging Profile',
    description: 'Adjust yearly mileage, plug-in frequency (weekday vs weekend), arrival time, and wallbox power. Every chart below updates instantly as you move the sliders.',
    position: 'bottom',
  },
  {
    targetId: 'tour-savings-potential',
    title: 'Annual Savings',
    description: 'Your estimated yearly savings from smart charging — calculated from a rolling 12-month average of real SMARD market prices. The monetizable spread shows the average price difference you can capture per kWh.',
    position: 'left',
  },
  {
    targetId: 'tour-price-chart',
    title: 'The Price Curve',
    description: 'Real day-ahead electricity prices from SMARD.de. Red dots = unmanaged charging (starts immediately at plug-in). Green dots = optimized (shifted to the cheapest hours). Drag the red/blue lines to change arrival and departure times directly on the chart.',
    position: 'bottom',
  },
  {
    targetId: 'tour-day-selector',
    title: 'Pick a Day',
    description: 'Every day has different price spreads. The color bars show savings opportunity — red means high spread (more savings), green means low spread. Click any day to see its price curve.',
    position: 'left',
  },
  {
    targetId: 'tour-monthly-savings',
    title: 'Savings Over Time',
    description: 'Monthly bar chart shows seasonal patterns — winter months typically have higher price volatility and more savings potential. The yearly trend line reveals the long-term picture.',
    position: 'top',
  },
  {
    targetId: 'tour-fleet-portfolio',
    title: 'Fleet Portfolio',
    description: 'Scale from 10 to 10,000 EVs. In a fleet, cars arrive at different times and drive different distances — this natural diversity creates a portfolio effect where larger fleets save more per EV through better load distribution.',
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
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<SpotlightRect | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const rafRef = useRef<number>(0)

  const currentStep = STEPS[step]

  // Wrap close: reset step and scroll back to top
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

  // Scroll to target and measure
  useEffect(() => {
    if (!active) return
    setIsTransitioning(true)
    const el = document.getElementById(currentStep.targetId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    // Wait for scroll to settle, then measure
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

  const cardStyle = getCardPosition(viewportRect, currentStep.position)

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Tutorial">
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
        onClick={handleClose}
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
      {!isTransitioning && (
        <div
          className="fixed bg-white rounded-xl shadow-2xl border border-gray-200 p-5 max-w-sm w-[340px] transition-all duration-300 z-[101]"
          style={cardStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Step indicator */}
          <div className="flex items-center gap-1.5 mb-3">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-4 bg-[#313131]' : 'w-1.5 bg-gray-200'
                }`}
              />
            ))}
            <span className="text-[10px] text-gray-400 ml-auto">{step + 1} / {STEPS.length}</span>
          </div>

          {/* Content */}
          <h3 className="text-sm font-bold text-[#313131] mb-1.5">{currentStep.title}</h3>
          <p className="text-[12px] text-gray-500 leading-relaxed">{currentStep.description}</p>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
            <button
              onClick={handleClose}
              className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              Skip
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  onClick={() => setStep(s => s - 1)}
                  className="text-[11px] font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
              )}
              <button
                onClick={() => {
                  if (step < STEPS.length - 1) setStep(s => s + 1)
                  else handleClose()
                }}
                className="text-[11px] font-semibold text-white bg-[#313131] hover:bg-[#1a1a1a] px-4 py-1.5 rounded-lg transition-colors"
              >
                {step < STEPS.length - 1 ? 'Next' : 'Finish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Compute the position of the explanation card relative to the spotlight */
function getCardPosition(
  rect: { top: number; left: number; width: number; height: number } | null,
  preferred: 'right' | 'left' | 'bottom' | 'top',
): React.CSSProperties {
  if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

  const cardW = 340
  const cardH = 220
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
