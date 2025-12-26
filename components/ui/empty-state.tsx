import { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReactNode } from 'react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  children?: ReactNode
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  children,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg bg-muted/20">
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="text-center space-y-2 max-w-md">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
      {children || (
        <div className="flex items-center gap-2">
          {action && (
            <Button onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
