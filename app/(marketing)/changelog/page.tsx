'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import {
  Sparkles, Zap, Bug, Calendar, Search, Mail, ArrowRight,
  ExternalLink, BookOpen, Star, Shield, Rocket, Filter,
  AlertCircle, Package, Trash2,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

function useWindowWidth() {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    setWidth(window.innerWidth);
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

type ChangeType = 'feature' | 'improvement' | 'fix' | 'security' | 'breaking' | 'deprecation';

export default function ChangelogPage() {
  const [selectedFilter, setSelectedFilter] = useState<ChangeType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [emailSubscribe, setEmailSubscribe] = useState('');
  const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'duplicate'>('idle');

  const width = useWindowWidth();
  const isMobile = width > 0 && width < 640;
  const isTablet = width >= 640 && width < 1024;

  const handleSubscribe = async () => {
    if (!emailSubscribe || !emailSubscribe.includes('@')) return;
    setSubscribeStatus('loading');
    try {
      const res = await api.post('/api/newsletter/subscribe', { email: emailSubscribe, source: 'changelog' });
      if (res.data?.message === 'Already subscribed') {
        setSubscribeStatus('duplicate');
        setEmailSubscribe('');
      } else {
        setSubscribeStatus('success');
        setEmailSubscribe('');
      }
    } catch (err: any) {
      if (err.response?.status === 200) setSubscribeStatus('duplicate');
      else setSubscribeStatus('error');
    }
  };

  const releases = [
    {
      version: '3.2.0',
      date: '2026-03-28',
      title: 'AI-Powered Cost Recommendations',
      featured: true,
      image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80',
      summary: 'Introducing machine learning-based cost optimization recommendations that can save you up to 40% on AWS bills.',
      blogPost: '/blog/ai-cost-recommendations',
      changes: [
        { type: 'feature' as ChangeType, text: 'AI-powered cost optimization recommendations based on usage patterns', category: 'Cost Management' },
        { type: 'feature' as ChangeType, text: 'Automated rightsizing suggestions for EC2 and RDS instances', category: 'Cost Management' },
        { type: 'feature' as ChangeType, text: 'Predictive cost forecasting with 95% accuracy', category: 'Cost Management' },
        { type: 'improvement' as ChangeType, text: 'Enhanced cost allocation tags support', category: 'Cost Management' },
        { type: 'improvement' as ChangeType, text: '3x faster dashboard load times', category: 'Performance' },
      ],
      stats: { newFeatures: 3, improvements: 2, bugFixes: 0 },
    },
    {
      version: '3.1.0',
      date: '2026-03-14',
      title: 'DORA Metrics Dashboard',
      featured: true,
      image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
      summary: 'Comprehensive DORA metrics tracking to measure and improve your software delivery performance.',
      blogPost: '/blog/dora-metrics',
      changes: [
        { type: 'feature' as ChangeType, text: 'New DORA metrics dashboard with deployment frequency, lead time, change failure rate, and MTTR', category: 'Platform Engineering' },
        { type: 'feature' as ChangeType, text: 'Team-level DORA metrics comparison and benchmarking', category: 'Platform Engineering' },
        { type: 'feature' as ChangeType, text: 'Historical trend analysis for DORA metrics', category: 'Platform Engineering' },
        { type: 'improvement' as ChangeType, text: 'Improved service dependency visualization with interactive graph', category: 'Services' },
        { type: 'fix' as ChangeType, text: 'Fixed timezone issues in deployment tracking', category: 'Deployments' },
        { type: 'fix' as ChangeType, text: 'Resolved memory leak in real-time metrics updates', category: 'Performance' },
      ],
      stats: { newFeatures: 3, improvements: 1, bugFixes: 2 },
    },
    {
      version: '3.0.0',
      date: '2026-02-28',
      title: 'Enhanced AWS Resource Discovery',
      featured: false,
      image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=80',
      summary: 'Expanded support for AWS resources with faster discovery and better cost allocation.',
      changes: [
        { type: 'feature' as ChangeType, text: 'Automatic discovery of RDS, ElastiCache, and Lambda resources', category: 'AWS Integration' },
        { type: 'feature' as ChangeType, text: 'Support for S3 bucket analysis and cost breakdown', category: 'AWS Integration' },
        { type: 'feature' as ChangeType, text: 'Cost allocation by resource tag with custom grouping', category: 'Cost Management' },
        { type: 'improvement' as ChangeType, text: 'Faster initial sync for large AWS accounts (50% reduction)', category: 'Performance' },
        { type: 'improvement' as ChangeType, text: 'Better error handling for AWS API rate limits', category: 'AWS Integration' },
        { type: 'fix' as ChangeType, text: 'Fixed pagination in resource listing for accounts with 10,000+ resources', category: 'AWS Integration' },
        { type: 'security' as ChangeType, text: 'Enhanced IAM role validation and security checks', category: 'Security' },
      ],
      stats: { newFeatures: 3, improvements: 2, bugFixes: 1 },
    },
    {
      version: '2.9.0',
      date: '2026-02-14',
      title: 'Team Management & RBAC',
      featured: false,
      image: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80',
      summary: 'Powerful team management features with role-based access control for enterprise customers.',
      changes: [
        { type: 'feature' as ChangeType, text: 'Create and manage engineering teams with custom hierarchies', category: 'Teams' },
        { type: 'feature' as ChangeType, text: 'Assign service ownership to teams with notifications', category: 'Teams' },
        { type: 'feature' as ChangeType, text: 'Team-based access control with granular permissions', category: 'Security' },
        { type: 'feature' as ChangeType, text: 'Team dashboards with aggregated metrics', category: 'Teams' },
        { type: 'improvement' as ChangeType, text: 'Improved onboarding flow for new users', category: 'Onboarding' },
        { type: 'improvement' as ChangeType, text: 'Bulk user import via CSV', category: 'Teams' },
      ],
      stats: { newFeatures: 4, improvements: 2, bugFixes: 0 },
    },
    {
      version: '2.8.0',
      date: '2026-01-31',
      title: 'Security & Compliance Updates',
      featured: false,
      changes: [
        { type: 'security' as ChangeType, text: 'SOC 2 Type II audit initiated — continuous compliance monitoring enabled', category: 'Security' },
        { type: 'security' as ChangeType, text: 'GDPR compliance enhancements with data export tools', category: 'Security' },
        { type: 'feature' as ChangeType, text: 'Security scanning dashboard with vulnerability tracking', category: 'Security' },
        { type: 'feature' as ChangeType, text: 'Compliance framework templates (CIS, NIST, PCI-DSS)', category: 'Security' },
        { type: 'improvement' as ChangeType, text: 'Audit log retention increased to 2 years', category: 'Security' },
        { type: 'fix' as ChangeType, text: 'Fixed false positives in security checks', category: 'Security' },
      ],
      stats: { newFeatures: 2, improvements: 1, bugFixes: 1 },
    },
    {
      version: '2.7.0',
      date: '2026-01-17',
      title: 'Webhooks & API Enhancements',
      featured: false,
      changes: [
        { type: 'feature' as ChangeType, text: 'Webhooks for real-time event notifications', category: 'API' },
        { type: 'feature' as ChangeType, text: 'GraphQL API beta release', category: 'API' },
        { type: 'improvement' as ChangeType, text: 'REST API rate limits increased to 10,000 requests/hour', category: 'API' },
        { type: 'improvement' as ChangeType, text: 'API response times reduced by 40%', category: 'Performance' },
        { type: 'breaking' as ChangeType, text: 'Deprecated v2 endpoints (use v3 by June 2026)', category: 'API' },
        { type: 'fix' as ChangeType, text: 'Fixed inconsistent API error responses', category: 'API' },
      ],
      stats: { newFeatures: 2, improvements: 2, bugFixes: 1 },
    },
  ];

  const changeTypeConfig: Record<ChangeType, { icon: React.ElementType; label: string; color: string; bg: string }> = {
    feature:     { icon: Sparkles,     label: 'New',        color: '#2563eb', bg: '#dbeafe' },
    improvement: { icon: Zap,          label: 'Improved',   color: '#16a34a', bg: '#dcfce7' },
    fix:         { icon: Bug,          label: 'Fixed',      color: '#ea580c', bg: '#fed7aa' },
    security:    { icon: Shield,       label: 'Security',   color: '#7c3aed', bg: '#ede9fe' },
    breaking:    { icon: AlertCircle,  label: 'Breaking',   color: '#dc2626', bg: '#fee2e2' },
    deprecation: { icon: Trash2,       label: 'Deprecated', color: '#d97706', bg: '#fef3c7' },
  };

  const filters: { value: ChangeType | 'all'; label: string; icon: React.ElementType }[] = [
    { value: 'all',         label: 'All Updates',   icon: Package },
    { value: 'feature',     label: 'New Features',  icon: Sparkles },
    { value: 'improvement', label: 'Improvements',  icon: Zap },
    { value: 'fix',         label: 'Bug Fixes',     icon: Bug },
    { value: 'security',    label: 'Security',      icon: Shield },
  ];

  const filteredReleases = releases.filter((release) => {
    const matchesFilter =
      selectedFilter === 'all' ||
      release.changes.some((change) => change.type === selectedFilter);
    const matchesSearch =
      searchQuery === '' ||
      release.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      release.summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      release.changes.some((change) => change.text.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  const featuredReleases = releases.filter((r) => r.featured);

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* Hero */}
      <section style={{
        background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
        padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '80px 48px',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'rgba(124,58,237,0.1)', borderRadius: '20px',
            padding: '4px 14px', marginBottom: '20px',
          }}>
            <Sparkles style={{ width: '14px', height: '14px', color: '#7c3aed' }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#7c3aed', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Changelog
            </span>
          </div>
          <h1 style={{
            color: '#0f172a', fontWeight: 800,
            fontSize: isMobile ? 'clamp(1.8rem,5vw,2.4rem)' : 'clamp(2rem, 4vw, 2.8rem)',
            marginBottom: '16px', letterSpacing: '-0.02em', lineHeight: 1.2,
          }}>
            What&apos;s New in DevControl
          </h1>
          <p style={{
            color: '#374151', fontSize: isMobile ? '0.95rem' : '1.1rem',
            maxWidth: '600px', margin: '0 auto 32px', lineHeight: 1.6,
          }}>
            All the latest updates, improvements, and fixes. We ship new features every week to help you build better.
          </p>
          <div style={{ position: 'relative', maxWidth: '480px', margin: '0 auto 24px' }}>
            <Search style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', width: '18px', height: '18px', color: '#9ca3af' }} />
            <input
              type="text"
              placeholder="Search updates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%', height: '48px', paddingLeft: '44px', paddingRight: '16px',
                borderRadius: '10px', border: '1px solid #e5e7eb', background: '#fff',
                fontSize: '0.9rem', outline: 'none', color: '#0f172a', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
            flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row',
          }}>
            <Link href="/blog" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '9px 18px', borderRadius: '8px', border: '1px solid #e5e7eb',
              background: '#fff', color: '#374151', fontWeight: 500,
              fontSize: '0.875rem', textDecoration: 'none',
              width: isMobile ? '100%' : undefined, boxSizing: 'border-box',
            }}>
              <BookOpen style={{ width: '15px', height: '15px' }} /> Read Blog
            </Link>
            <a href="#subscribe" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '9px 18px', borderRadius: '8px',
              background: '#7c3aed', color: '#fff', fontWeight: 600,
              fontSize: '0.875rem', textDecoration: 'none',
              width: isMobile ? '100%' : undefined, boxSizing: 'border-box',
            }}>
              <Mail style={{ width: '15px', height: '15px' }} /> Subscribe to Updates
            </a>
          </div>
        </div>
      </section>

      {/* Content */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: isMobile ? '0 16px' : isTablet ? '0 24px' : '0 48px' }}>

        {/* Filters */}
        <div style={{ padding: '40px 0 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Filter style={{ width: '15px', height: '15px', color: '#9ca3af' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#6b7280' }}>Filter by type</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? '8px' : '10px' }}>
            {filters.map((filter) => {
              const Icon = filter.icon;
              const active = selectedFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  onClick={() => setSelectedFilter(filter.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '7px 14px', borderRadius: '8px', cursor: 'pointer',
                    border: active ? 'none' : '1px solid #e5e7eb',
                    background: active ? '#7c3aed' : '#fff',
                    color: active ? '#fff' : '#374151',
                    fontSize: '0.875rem', fontWeight: 500,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Icon style={{ width: '14px', height: '14px' }} />
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Featured Releases */}
        {selectedFilter === 'all' && searchQuery === '' && featuredReleases.length > 0 && (
          <div style={{ marginBottom: '48px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <Star style={{ width: '18px', height: '18px', color: '#f59e0b' }} />
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>Featured Releases</h2>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
              gap: '24px',
            }}>
              {featuredReleases.map((release) => (
                <div
                  key={release.version}
                  style={{
                    border: '1px solid #e5e7eb', borderRadius: '16px', overflow: 'hidden',
                    background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    cursor: 'pointer', transition: 'box-shadow 0.2s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)')}
                >
                  <div style={{ position: 'relative', height: '200px', overflow: 'hidden', background: '#f3f4f6' }}>
                    <Image src={release.image!} alt={release.title} fill style={{ objectFit: 'cover' }} unoptimized />
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }} />
                    <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
                      <span style={{
                        background: '#f59e0b', color: '#fff', fontSize: '0.72rem', fontWeight: 700,
                        padding: '3px 10px', borderRadius: '6px',
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                      }}>
                        <Star style={{ width: '10px', height: '10px' }} /> Featured
                      </span>
                    </div>
                    <div style={{ position: 'absolute', bottom: '12px', left: '12px' }}>
                      <span style={{
                        background: '#7c3aed', color: '#fff', fontSize: '0.82rem',
                        fontWeight: 700, padding: '3px 12px', borderRadius: '6px',
                      }}>
                        v{release.version}
                      </span>
                    </div>
                  </div>
                  <div style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#6b7280', fontSize: '0.78rem' }}>
                      <Calendar style={{ width: '12px', height: '12px' }} />
                      {new Date(release.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>{release.title}</h3>
                    <p style={{ fontSize: '0.875rem', color: '#4b5563', lineHeight: 1.6, marginBottom: '20px' }}>{release.summary}</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.78rem', color: '#6b7280', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Sparkles style={{ width: '12px', height: '12px' }} /> {release.stats.newFeatures} new
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Zap style={{ width: '12px', height: '12px' }} /> {release.stats.improvements} improved
                        </span>
                        {release.stats.bugFixes > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Bug style={{ width: '12px', height: '12px' }} /> {release.stats.bugFixes} fixed
                          </span>
                        )}
                      </div>
                      {release.blogPost && (
                        <Link href={release.blogPost} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          fontSize: '0.82rem', fontWeight: 600, color: '#7c3aed', textDecoration: 'none',
                        }}>
                          Read more <ArrowRight style={{ width: '12px', height: '12px' }} />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Releases */}
        <div style={{ marginBottom: '48px' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', marginBottom: '24px' }}>
            {selectedFilter !== 'all' || searchQuery !== ''
              ? `${filteredReleases.length} ${filteredReleases.length === 1 ? 'Release' : 'Releases'}${searchQuery ? ` matching "${searchQuery}"` : ''}`
              : 'All Releases'}
          </h2>

          {filteredReleases.length === 0 ? (
            <div style={{ padding: '64px 24px', textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: '16px' }}>
              <Package style={{ width: '48px', height: '48px', color: '#9ca3af', margin: '0 auto 16px' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0f172a', marginBottom: '8px' }}>No releases found</h3>
              <p style={{ color: '#6b7280', marginBottom: '20px' }}>Try adjusting your search or filter criteria</p>
              <button
                onClick={() => { setSearchQuery(''); setSelectedFilter('all'); }}
                style={{
                  padding: '8px 20px', borderRadius: '8px', border: '1px solid #e5e7eb',
                  background: '#fff', color: '#374151', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer',
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {filteredReleases.map((release) => (
                <div
                  key={release.version}
                  style={{
                    border: '1px solid #e5e7eb', borderRadius: '16px', background: '#fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden',
                    transition: 'box-shadow 0.15s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)')}
                >
                  <div style={{ padding: isMobile ? '20px 20px 16px' : '28px 28px 20px' }}>
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                      marginBottom: '16px', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: '12px',
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
                          <span style={{
                            background: '#7c3aed', color: '#fff', fontSize: '0.82rem',
                            fontWeight: 700, padding: '3px 12px', borderRadius: '6px',
                          }}>
                            v{release.version}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.82rem', color: '#6b7280' }}>
                            <Calendar style={{ width: '12px', height: '12px' }} />
                            {new Date(release.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                        <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>{release.title}</h3>
                        {release.summary && (
                          <p style={{ fontSize: '0.9rem', color: '#4b5563', lineHeight: 1.6, margin: 0 }}>{release.summary}</p>
                        )}
                      </div>
                      {release.blogPost && (
                        <Link href={release.blogPost} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          padding: '7px 14px', borderRadius: '8px', border: '1px solid #e5e7eb',
                          background: '#fff', color: '#374151', fontSize: '0.82rem',
                          fontWeight: 500, textDecoration: 'none', flexShrink: 0,
                        }}>
                          <BookOpen style={{ width: '13px', height: '13px' }} />
                          Read more
                          <ExternalLink style={{ width: '11px', height: '11px' }} />
                        </Link>
                      )}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '20px',
                      fontSize: '0.78rem', color: '#6b7280',
                      borderTop: '1px solid #f3f4f6', paddingTop: '16px',
                      flexWrap: 'wrap',
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Sparkles style={{ width: '12px', height: '12px' }} /> {release.stats.newFeatures} new features
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Zap style={{ width: '12px', height: '12px' }} /> {release.stats.improvements} improvements
                      </span>
                      {release.stats.bugFixes > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Bug style={{ width: '12px', height: '12px' }} /> {release.stats.bugFixes} bug fixes
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ padding: isMobile ? '0 20px 20px' : '0 28px 28px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {release.changes
                        .filter((change) => selectedFilter === 'all' || change.type === selectedFilter)
                        .map((change, idx) => {
                          const config = changeTypeConfig[change.type];
                          const Icon = config.icon;
                          return (
                            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                              <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '5px',
                                padding: '3px 8px', borderRadius: '6px',
                                background: config.bg, flexShrink: 0, marginTop: '1px',
                              }}>
                                <Icon style={{ width: '11px', height: '11px', color: config.color }} />
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: config.color }}>
                                  {config.label}
                                </span>
                              </div>
                              <div>
                                <p style={{ fontSize: '0.875rem', color: '#0f172a', margin: 0 }}>{change.text}</p>
                                {change.category && (
                                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{change.category}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Subscribe */}
        <div
          id="subscribe"
          style={{
            background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(124,58,237,0.03))',
            border: '1px solid rgba(124,58,237,0.15)',
            borderRadius: '20px', padding: isMobile ? '32px 20px' : '48px 32px',
            textAlign: 'center', marginBottom: '48px',
          }}
        >
          <div style={{
            width: '48px', height: '48px', borderRadius: '50%',
            background: 'rgba(124,58,237,0.12)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
          }}>
            <Mail style={{ width: '22px', height: '22px', color: '#7c3aed' }} />
          </div>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
            Never Miss an Update
          </h3>
          <p style={{ color: '#4b5563', maxWidth: '480px', margin: '0 auto 24px', lineHeight: 1.6 }}>
            Get notified about new features, improvements, and important updates delivered to your inbox every week.
          </p>
          <div style={{
            display: 'flex', gap: '12px', maxWidth: '400px', margin: '0 auto',
            flexDirection: isMobile ? 'column' : 'row',
          }}>
            <input
              type="email"
              placeholder="Enter your email"
              value={emailSubscribe}
              onChange={(e) => setEmailSubscribe(e.target.value)}
              style={{
                flex: 1, height: '44px', paddingLeft: '14px', paddingRight: '14px',
                borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff',
                fontSize: '0.875rem', outline: 'none', color: '#0f172a', boxSizing: 'border-box',
                width: isMobile ? '100%' : undefined,
              }}
            />
            <button
              onClick={handleSubscribe}
              disabled={subscribeStatus === 'loading' || subscribeStatus === 'success'}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                height: '44px', padding: '0 20px', borderRadius: '8px',
                background: subscribeStatus === 'success' ? '#059669' : '#7c3aed',
                color: '#fff', fontWeight: 600,
                fontSize: '0.875rem', border: 'none', cursor: subscribeStatus === 'loading' || subscribeStatus === 'success' ? 'default' : 'pointer',
                whiteSpace: 'nowrap', opacity: subscribeStatus === 'loading' ? 0.7 : 1,
                width: isMobile ? '100%' : undefined, boxSizing: 'border-box',
              }}
            >
              {subscribeStatus === 'loading' ? 'Subscribing...' : subscribeStatus === 'success' ? 'Subscribed!' : <>Subscribe <ArrowRight style={{ width: '14px', height: '14px' }} /></>}
            </button>
          </div>
          {subscribeStatus === 'success' && (
            <p style={{ fontSize: '0.8rem', color: '#059669', marginTop: '10px' }}>
              You&apos;re subscribed! We&apos;ll notify you of new updates.
            </p>
          )}
          {subscribeStatus === 'duplicate' && (
            <p style={{ fontSize: '0.8rem', color: '#7c3aed', marginTop: '10px' }}>
              You&apos;re already subscribed.
            </p>
          )}
          {subscribeStatus === 'error' && (
            <p style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: '10px' }}>
              Something went wrong. Try again.
            </p>
          )}
          {subscribeStatus === 'idle' && (
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '12px' }}>
              Join 500+ engineering teams. Unsubscribe anytime.
            </p>
          )}
        </div>

        {/* Footer Links */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: '20px', paddingBottom: '64px',
        }}>
          {[
            { href: '/docs', icon: BookOpen, title: 'Documentation', desc: 'Learn how to use all the new features', external: false },
            { href: '/blog', icon: Rocket, title: 'Blog', desc: 'Read in-depth articles about new releases', external: false },
            { href: 'mailto:hello@getdevcontrol.com', icon: Sparkles, title: 'Request a Feature', desc: "Have an idea? We'd love to hear it", external: true },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.title}
                href={item.href}
                style={{ textDecoration: 'none' }}
              >
                <div
                  style={{
                    border: '1px solid #e5e7eb', borderRadius: '14px', padding: '20px 24px',
                    background: '#fff', cursor: 'pointer',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.05)', transition: 'box-shadow 0.15s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <Icon style={{ width: '16px', height: '16px', color: '#7c3aed' }} />
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>{item.title}</span>
                    <ArrowRight style={{ width: '13px', height: '13px', color: '#7c3aed', marginLeft: 'auto' }} />
                  </div>
                  <p style={{ fontSize: '0.82rem', color: '#6b7280', margin: 0 }}>{item.desc}</p>
                </div>
              </a>
            );
          })}
        </div>

      </div>
    </div>
  );
}
