'use client';

import {
  Network,
  FileCode,
  BookOpen,
  AlertTriangle,
  Download,
  Users,
  Shield,
  Target,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface EnhancedEmptyStateProps {
  /** Owners and admins can add dependencies (the backend's requireAdmin). */
  canManage: boolean;
  /** Whether the organization has registered services; null while loading or unavailable. */
  hasServices: boolean | null;
  onAddDependency: () => void;
  onAddService: () => void;
}

/**
 * Shown when the organization has recorded no dependencies. Describes only
 * what this page does with dependencies once they are recorded. The diagram is
 * a labelled example, not the organization's data.
 */
export function EnhancedEmptyState({
  canManage,
  hasServices,
  onAddDependency,
  onAddService,
}: EnhancedEmptyStateProps) {
  return (
    <div className="relative">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-gradient-to-b from-blue-50/30 via-purple-50/20 to-transparent dark:from-blue-950/20 dark:via-purple-950/10 pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center py-4 px-4">

        {/* Example diagram */}
        <div className="mb-8 relative max-w-4xl mx-auto w-full">
          <div className="relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-lg bg-white dark:bg-gray-900">
            <div className="p-6 sm:p-8 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30">
              <div className="flex items-center justify-center gap-3 sm:gap-8">
                <ExampleNode label="API" caption="Gateway" className="bg-blue-600" />
                <ExampleArrow className="text-blue-600" />
                <ExampleNode label="Auth" caption="Service" className="bg-purple-600" />
                <ExampleArrow className="text-purple-600" />
                <ExampleNode label="DB" caption="PostgreSQL" className="bg-green-600" />
              </div>

              <div className="absolute top-3 right-3 bg-white/90 dark:bg-gray-900/90 px-3 py-1 rounded-full text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                Example
              </div>
            </div>
          </div>
        </div>

        {/* Headline */}
        <div className="text-center mb-8 max-w-3xl">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4 leading-tight">
            Map Your Service Architecture
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 leading-relaxed">
            Record which services depend on each other to see them as a graph, find circular
            dependencies, and check what a failure would affect.
          </p>
        </div>

        {/* What you can do once dependencies are recorded */}
        <div className="mb-10 w-full px-4">
          <h3 className="text-xl font-bold text-center mb-6 text-gray-900 dark:text-white">
            What You Can Do
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard icon={Network} title="Visual Mapping" description="Interactive dependency graph" />
            <FeatureCard icon={Target} title="Impact Analysis" description="See which services depend on a service" />
            <FeatureCard icon={AlertTriangle} title="Circular Dependencies" description="Detect dependency cycles" />
            <FeatureCard icon={Shield} title="Critical Dependencies" description="Mark and filter the dependencies you consider critical" />
            <FeatureCard icon={Download} title="Export Options" description="CSV, PNG, PDF reports" />
            <FeatureCard icon={Search} title="Search and Filters" description="Find dependencies by service, type or priority" />
          </div>
        </div>

        {/* How It Works */}
        <div className="mb-10 w-full px-4">
          <h3 className="text-xl font-bold text-center mb-6 text-gray-900 dark:text-white">
            Get Started in 3 Steps
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <StepCard number="1" icon={FileCode} title="Add Dependencies" description="Define service relationships one by one" />
            <StepCard number="2" icon={Network} title="Visualize Graph" description="See your services and their relationships as a graph" />
            <StepCard number="3" icon={Shield} title="Analyze Impact" description="See which services are affected if one fails" />
          </div>
        </div>

        {/* Action */}
        <div className="w-full max-w-md px-4 mb-10">
          <Card className="border-2">
            <CardHeader>
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-xl flex items-center justify-center mb-3">
                <FileCode className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-lg">Manual Entry</CardTitle>
              <CardDescription>
                Add service dependencies one by one between your registered services
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!canManage ? (
                <p className="text-sm text-muted-foreground">
                  Dependencies are added by an organization owner or admin. Ask one to record which
                  services depend on each other.
                </p>
              ) : hasServices === false ? (
                <>
                  <Button onClick={onAddService} className="w-full" size="lg">
                    Add a service
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    Add a service first, then record which services depend on each other.
                  </p>
                </>
              ) : (
                <Button onClick={onAddDependency} className="w-full" size="lg" disabled={hasServices === null} aria-haspopup="dialog">
                  <FileCode className="w-4 h-4 mr-2" />
                  Add First Dependency
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Use Cases */}
        <div className="w-full px-4">
          <h3 className="text-lg font-semibold text-center mb-6 text-gray-900 dark:text-white">
            Common Use Cases
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <UseCaseCard
              icon={Shield}
              title="Before Deployments"
              scenario="Planning a change? See which services depend on the one you are changing."
            />
            <UseCaseCard
              icon={BookOpen}
              title="Architecture Reviews"
              scenario="Onboarding new engineers? Export the dependency graph as documentation."
            />
            <UseCaseCard
              icon={Users}
              title="Team Coordination"
              scenario="Multiple teams? See each service's owner next to its dependencies."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ExampleNode({ label, caption, className }: { label: string; caption: string; className: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className={`w-14 h-14 sm:w-20 sm:h-20 ${className} rounded-xl shadow flex items-center justify-center`}>
        <span className="text-white font-semibold text-xs sm:text-sm">{label}</span>
      </div>
      <span className="text-xs text-gray-600 dark:text-gray-400 mt-2">{caption}</span>
    </div>
  );
}

function ExampleArrow({ className }: { className: string }) {
  return (
    <div className="flex flex-col items-center">
      <svg width="48" height="4" viewBox="0 0 60 4" className={className} aria-hidden="true">
        <line x1="0" y1="2" x2="50" y2="2" stroke="currentColor" strokeWidth="3" />
        <polygon points="50,0 60,2 50,4" fill="currentColor" />
      </svg>
      <span className={`text-xs mt-1 ${className}`}>depends on</span>
    </div>
  );
}

// Feature Card Component
function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60">
      <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950">
        <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
      </div>
      <div>
        <h4 className="font-semibold text-sm text-gray-900 dark:text-white">{title}</h4>
        <p className="text-xs text-gray-600 dark:text-gray-400">{description}</p>
      </div>
    </div>
  );
}

// Step Card Component
function StepCard({
  number,
  icon: Icon,
  title,
  description,
}: {
  number: string;
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-3">
        <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
          <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
          {number}
        </span>
      </div>
      <h4 className="font-semibold text-gray-900 dark:text-white mb-1">{title}</h4>
      <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
    </div>
  );
}

// Use Case Card Component
function UseCaseCard({
  icon: Icon,
  title,
  scenario,
}: {
  icon: React.ElementType;
  title: string;
  scenario: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-gray-200 dark:border-gray-800">
      <Icon className="w-5 h-5 text-gray-600 dark:text-gray-400 shrink-0 mt-0.5" />
      <div>
        <h4 className="font-semibold text-sm text-gray-900 dark:text-white mb-1">{title}</h4>
        <p className="text-sm text-gray-600 dark:text-gray-400">{scenario}</p>
      </div>
    </div>
  );
}
