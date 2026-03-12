'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      const data = await response.json()

      if (response.ok) {
        const params = new URLSearchParams(window.location.search)
        const redirect = params.get('redirect') || '/v2'
        // Only allow relative paths to prevent open redirect attacks
        const isRelative = redirect.startsWith('/') && !redirect.startsWith('//')
        window.location.href = isRelative ? redirect : '/v2'
      } else {
        setError(data.error || 'Wrong password')
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 via-white to-white dark:from-neutral-950 dark:to-neutral-900 p-4">
      <Card className="w-full max-w-md border-gray-200/60 shadow-[var(--shadow-lg)] dark:border-neutral-800/60">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-[#EA1B0A]">
            <Lock className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-foreground">EV Flex Charging — Load Shifting Visualization</CardTitle>
          <CardDescription className="text-sm">
            Enter password to access the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoFocus
                className="text-lg"
                aria-describedby={error ? 'error-message' : undefined}
              />
            </div>

            {error && (
              <Alert variant="destructive" id="error-message">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full cursor-pointer font-semibold transition-all duration-200 hover:shadow-md"
              size="lg"
              disabled={isLoading || !password.trim()}
            >
              {isLoading ? 'Loading...' : 'Login'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Session valid for 24 hours.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
