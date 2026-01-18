'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  Linkedin,
  Twitter,
  Github,
  Youtube,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FooterLink {
  label: string;
  href: string;
}

interface FooterSection {
  title: string;
  links: FooterLink[];
}

interface FooterColumn {
  heading: string;
  sections: FooterSection[];
}

const footerData: FooterColumn[] = [
  {
    heading: 'Product',
    sections: [
      {
        title: '',
        links: [
          { label: 'Overview', href: '/product/overview' },
          { label: 'Infrastructure Management', href: '/product/infrastructure' },
          { label: 'Service Catalog', href: '/product/services' },
          { label: 'Deployment Automation', href: '/product/deployments' },
          { label: 'Cost Optimization', href: '/product/cost-optimization' },
          { label: 'Security & Compliance', href: '/product/security' },
          { label: 'Monitoring & Alerts', href: '/product/monitoring' },
          { label: 'DORA Metrics', href: '/product/dora-metrics' },
          { label: 'AWS Integration', href: '/product/aws-integration' },
          { label: "What's New", href: '/changelog' },
          { label: 'Roadmap', href: '/product/roadmap' },
        ],
      },
    ],
  },
  {
    heading: 'Solutions',
    sections: [
      {
        title: 'By Company Size',
        links: [
          { label: 'For Startups', href: '/solutions/startups' },
          { label: 'For Mid-Market', href: '/solutions/mid-market' },
          { label: 'For Enterprise', href: '/solutions/enterprise' },
        ],
      },
      {
        title: 'By Use Case',
        links: [
          { label: 'Platform Engineering', href: '/solutions/platform-engineering' },
          { label: 'FinOps', href: '/solutions/cost-optimization' },
          { label: 'DevOps Acceleration', href: '/solutions/devops' },
          { label: 'Cloud Migration', href: '/solutions/cloud-migration' },
          { label: 'Compliance Automation', href: '/solutions/compliance' },
        ],
      },
      {
        title: 'By Role',
        links: [
          { label: 'For Platform Engineers', href: '/solutions/platform-engineers' },
          { label: 'For DevOps Teams', href: '/solutions/devops-teams' },
          { label: 'For Engineering Leaders', href: '/solutions/engineering-leaders' },
        ],
      },
    ],
  },
  {
    heading: 'Developers',
    sections: [
      {
        title: '',
        links: [
          { label: 'Documentation', href: '/docs' },
          { label: 'Getting Started', href: '/docs/getting-started' },
          { label: 'API Reference', href: '/docs/api' },
          { label: 'CLI Tool', href: '/developers/cli' },
          { label: 'Integration Guides', href: '/developers/integrations' },
          { label: 'Code Examples', href: '/developers/examples' },
          { label: 'GitHub', href: 'https://github.com/devcontrol' },
          { label: 'Developer Blog', href: '/developers/blog' },
          { label: 'API Status', href: '/status' },
          { label: 'Community', href: '/developers/community' },
        ],
      },
    ],
  },
  {
    heading: 'Resources',
    sections: [
      {
        title: 'Learn',
        links: [
          { label: 'Blog', href: '/blog' },
          { label: 'Case Studies', href: '/resources/case-studies' },
          { label: 'Whitepapers', href: '/resources/whitepapers' },
          { label: 'Webinars', href: '/resources/webinars' },
          { label: 'Best Practices', href: '/resources/best-practices' },
          { label: 'Platform Engineering Guide', href: '/resources/guides' },
        ],
      },
      {
        title: 'Support',
        links: [
          { label: 'Help Center', href: '/support' },
          { label: 'Contact Support', href: '/support/contact' },
          { label: 'System Status', href: '/status' },
          { label: 'SLA', href: '/legal/sla' },
          { label: 'Professional Services', href: '/services/professional' },
          { label: 'Community Forum', href: '/community' },
        ],
      },
    ],
  },
  {
    heading: 'Company',
    sections: [
      {
        title: 'About',
        links: [
          { label: 'About Us', href: '/company/about' },
          { label: 'Careers', href: '/company/careers' },
          { label: 'Team', href: '/company/team' },
          { label: 'Partners', href: '/company/partners' },
          { label: 'Contact Us', href: '/company/contact' },
        ],
      },
      {
        title: 'Legal & Trust',
        links: [
          { label: 'Security & Compliance', href: '/company/security' },
          { label: 'Privacy Policy', href: '/legal/privacy' },
          { label: 'Terms of Service', href: '/legal/terms' },
          { label: 'Trust Center', href: '/company/trust' },
          { label: 'Accessibility', href: '/legal/accessibility' },
        ],
      },
    ],
  },
];

const socialLinks = [
  {
    name: 'LinkedIn',
    href: 'https://linkedin.com/company/devcontrol',
    icon: Linkedin,
  },
  {
    name: 'Twitter',
    href: 'https://twitter.com/devcontrol',
    icon: Twitter,
  },
  {
    name: 'GitHub',
    href: 'https://github.com/devcontrol',
    icon: Github,
  },
  {
    name: 'YouTube',
    href: 'https://youtube.com/@devcontrol',
    icon: Youtube,
  },
];

function FooterColumn({ column, isMobile }: { column: FooterColumn; isMobile?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);

  if (isMobile) {
    return (
      <div className="border-b border-gray-800">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center justify-between py-4 text-left"
          aria-expanded={isOpen}
        >
          <span className="text-sm font-semibold uppercase tracking-wider text-gray-200">
            {column.heading}
          </span>
          <ChevronDown
            className={cn(
              'h-5 w-5 text-gray-400 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>
        {isOpen && (
          <div className="pb-4 space-y-4">
            {column.sections.map((section, sectionIdx) => (
              <div key={sectionIdx}>
                {section.title && (
                  <h4 className="text-xs font-semibold text-gray-400 mb-2">
                    {section.title}
                  </h4>
                )}
                <ul className="space-y-2">
                  {section.links.map((link, linkIdx) => (
                    <li key={linkIdx}>
                      <Link
                        href={link.href}
                        className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-200">
        {column.heading}
      </h3>
      {column.sections.map((section, sectionIdx) => (
        <div key={sectionIdx} className="space-y-3">
          {section.title && (
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {section.title}
            </h4>
          )}
          <ul className="space-y-2">
            {section.links.map((link, linkIdx) => (
              <li key={linkIdx}>
                <Link
                  href={link.href}
                  className="text-sm text-gray-400 hover:text-white transition-colors duration-200 inline-block"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="bg-gray-950 text-gray-400 border-t border-gray-800">
      {/* Utility Row */}
      <div className="border-b border-gray-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Left side - Status and CTAs */}
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              {/* System Status */}
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-gray-300">All Systems Operational</span>
              </div>

              {/* CTAs */}
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-initial"
                >
                  <Link href="/contact/demo">Book a Demo</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="flex-1 sm:flex-initial"
                >
                  <Link href="/signup">Start Free Trial</Link>
                </Button>
              </div>
            </div>

            {/* Right side - Future: Language/Region selector */}
            <div className="hidden lg:block">
              {/* Placeholder for language/region selector */}
            </div>
          </div>
        </div>
      </div>

      {/* Main Footer Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Desktop Grid */}
        <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-5 gap-8 lg:gap-12">
          {footerData.map((column, idx) => (
            <FooterColumn key={idx} column={column} />
          ))}
        </div>

        {/* Mobile Accordion */}
        <div className="md:hidden">
          {footerData.map((column, idx) => (
            <FooterColumn key={idx} column={column} isMobile />
          ))}
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-gray-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            {/* Left - Logo and Copyright */}
            <div className="flex flex-col items-center lg:items-start gap-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">DC</span>
                </div>
                <div className="text-left">
                  <div className="text-white font-semibold text-sm">DevControl</div>
                  <div className="text-xs text-gray-500">AWS Infrastructure Command Center</div>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                © {new Date().getFullYear()} DevControl. All rights reserved.
              </p>
            </div>

            {/* Center - Legal Links */}
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              <Link
                href="/legal/privacy"
                className="text-gray-400 hover:text-white transition-colors duration-200"
              >
                Privacy
              </Link>
              <span className="text-gray-600">·</span>
              <Link
                href="/legal/terms"
                className="text-gray-400 hover:text-white transition-colors duration-200"
              >
                Terms
              </Link>
              <span className="text-gray-600">·</span>
              <Link
                href="/company/security"
                className="text-gray-400 hover:text-white transition-colors duration-200"
              >
                Security
              </Link>
              <span className="text-gray-600">·</span>
              <Link
                href="/legal/cookies"
                className="text-gray-400 hover:text-white transition-colors duration-200"
              >
                Cookies
              </Link>
            </div>

            {/* Right - Social Links */}
            <div className="flex items-center gap-4">
              {socialLinks.map((social) => {
                const Icon = social.icon;
                return (
                  <a
                    key={social.name}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={social.name}
                    className="text-gray-400 hover:text-white transition-colors duration-200"
                  >
                    <Icon className="h-5 w-5" />
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
