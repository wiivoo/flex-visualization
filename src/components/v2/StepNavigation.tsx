'use client'

import { cn } from '@/lib/utils'

interface Step {
  id: number
  title: string
  subtitle: string
}

interface StepNavigationProps {
  steps: Step[]
  currentStep: number
  onStepClick: (step: number) => void
}

export function StepNavigation({ steps, currentStep, onStepClick }: StepNavigationProps) {
  return (
    <nav className="flex items-center gap-1">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center">
          <button
            onClick={() => onStepClick(step.id)}
            aria-label={`Step ${step.id}: ${step.title} — ${step.subtitle}`}
            aria-current={currentStep === step.id ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all',
              currentStep === step.id
                ? 'bg-[#EA1C0A] text-white font-semibold'
                : currentStep > step.id
                ? 'bg-[#EA1C0A]/10 text-[#EA1C0A] hover:bg-[#EA1C0A]/20'
                : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
            )}
          >
            <span className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold',
              currentStep === step.id
                ? 'bg-white text-[#EA1C0A]'
                : currentStep > step.id
                ? 'bg-[#EA1C0A] text-white'
                : 'bg-gray-300 text-white'
            )}>
              {currentStep > step.id ? '✓' : step.id}
            </span>
            <span className="hidden lg:inline">{step.title}</span>
          </button>
          {i < steps.length - 1 && (
            <div className={cn(
              'w-8 h-0.5 mx-1',
              currentStep > step.id ? 'bg-[#EA1C0A]' : 'bg-gray-200'
            )} />
          )}
        </div>
      ))}
    </nav>
  )
}
