'use client'

import { useState } from 'react'
import { Check, Copy, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

const curlExample = `curl -X POST https://api.getdevcontrol.com/deployments \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "service": "payment-api",
    "environment": "production",
    "version": "v2.1.0",
    "deployed_by": "sarah@company.com",
    "commit_hash": "abc123",
    "commit_message": "Fix payment timeout"
  }'`

const responseExample = `{
  "status": "success",
  "deployment_id": "dep_abc123xyz",
  "message": "Deployment tracked successfully",
  "dora_metrics_unlocked": false,
  "deployments_count": 1
}`

export function DeploymentAPIExample() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(curlExample)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <div id="api-example" className="border rounded-lg bg-white">
      {/* Header */}
      <div
        className="flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Track Deployments via REST API
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Use our API endpoint to track deployments from any CI/CD platform
          </p>
        </div>
        <Button variant="ghost" size="sm">
          {isExpanded ? (
            <ChevronUp className="h-5 w-5" />
          ) : (
            <ChevronDown className="h-5 w-5" />
          )}
        </Button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-6 pb-6 space-y-6 border-t">
          {/* cURL Example */}
          <div>
            <div className="flex items-center justify-between mb-2 mt-4">
              <h4 className="text-sm font-semibold text-gray-700">
                Example Request
              </h4>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                className="h-8"
              >
                {isCopied ? (
                  <>
                    <Check className="h-3 w-3 mr-1" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </>
                )}
              </Button>
            </div>

            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs font-mono">
              <code>{curlExample}</code>
            </pre>
          </div>

          {/* Response Example */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">
              Response: 201 Created ✓
            </h4>

            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs font-mono">
              <code>{responseExample}</code>
            </pre>
          </div>

          {/* Common Use Cases */}
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <h4 className="text-sm font-semibold text-blue-900 mb-3">
              Common Use Cases
            </h4>
            <ul className="space-y-2 text-sm text-blue-800">
              <li className="flex items-start gap-2">
                <span className="text-blue-600">•</span>
                <span>Jenkins, CircleCI, or custom CI/CD pipelines</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600">•</span>
                <span>Kubernetes deployment hooks</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600">•</span>
                <span>Manual deployments via CLI scripts</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600">•</span>
                <span>Serverless framework deploy hooks</span>
              </li>
            </ul>
          </div>

          {/* Links */}
          <div className="flex items-center gap-4 pt-4 border-t">
            <Link
              href="/settings"
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              Get API Key
              <ExternalLink className="h-3 w-3" />
            </Link>
            <Link
              href="https://docs.example.com/api"
              target="_blank"
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              Full API Documentation
              <ExternalLink className="h-3 w-3" />
            </Link>
            <Link
              href="https://www.postman.com/example"
              target="_blank"
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              Postman Collection
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
