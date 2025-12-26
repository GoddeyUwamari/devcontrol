'use client'

import React, { Component, ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 space-y-4">
          <AlertCircle className="h-12 w-12 text-red-600" />
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-red-900">Something went wrong</h2>
            <p className="text-sm text-red-700 max-w-md">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
          </div>
          <Button onClick={this.handleReset} variant="outline">
            Try again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
