/**
 * ResourceLinks Component
 * Quick links to helpful resources
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { BookOpen, Video, Code, MessageCircle } from 'lucide-react';

interface Resource {
  icon: React.ReactNode;
  label: string;
  href: string;
}

const resources: Resource[] = [
  {
    icon: <BookOpen className="h-4 w-4" />,
    label: 'Documentation',
    href: '#',
  },
  {
    icon: <Video className="h-4 w-4" />,
    label: 'Video Tutorial (2 min)',
    href: '#',
  },
  {
    icon: <Code className="h-4 w-4" />,
    label: 'API Reference',
    href: '#',
  },
  {
    icon: <MessageCircle className="h-4 w-4" />,
    label: 'Join Community',
    href: '#',
  },
];

export function ResourceLinks() {
  return (
    <div className="py-6">
      {/* Section Header */}
      <div className="mb-6 text-center">
        <h3 className="mb-1 text-lg font-semibold text-gray-900">
          Need Help Getting Started?
        </h3>
        <p className="text-sm text-gray-600">
          Check out these helpful resources
        </p>
      </div>

      {/* Resource Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {resources.map((resource, index) => (
          <Button
            key={index}
            variant="outline"
            className="border-gray-300 text-gray-700 hover:border-[#7c3aed] hover:bg-[#7c3aed] hover:text-white"
            onClick={() => {
              // In a real app, these would link to actual resources
              console.log(`Navigate to: ${resource.label}`);
            }}
          >
            {resource.icon}
            <span className="ml-2">{resource.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
