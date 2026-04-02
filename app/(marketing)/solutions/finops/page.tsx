'use client'

import { DollarSign, TrendingDown, BarChart3, Bell, PieChart, Zap, FileText, Users } from 'lucide-react'

export default function FinOpsPage() {

  const features = [
    { icon: DollarSign, stat: '$2,400', statSub: 'avg monthly savings', title: 'AI Cost Recommendations', desc: 'Machine learning identifies idle resources, right-sizing opportunities, and reserved instance gaps. Every recommendation comes with projected savings before you act.' },
    { icon: BarChart3, stat: '30%', statSub: 'typical cost reduction', title: 'Real-Time Spend Tracking', desc: 'Live cost breakdown by service, team, environment, and tag. Allocate every dollar of AWS spend to the right cost center — automatically, without manual tagging.' },
    { icon: Bell, stat: '< 5min', statSub: 'time to anomaly alert', title: 'Anomaly Detection & Alerts', desc: 'Instant notifications when spend spikes beyond expected thresholds. Catch runaway Lambda costs, accidental data transfer, and forgotten dev environments before month end.' },
    { icon: TrendingDown, stat: '95%', statSub: 'forecast accuracy', title: 'Predictive Budget Forecasting', desc: 'Predict next month\'s AWS bill with 95% accuracy. Set budgets by team, product, or environment and get alerts before you breach them — not after.' },
    { icon: PieChart, stat: '$800+', statSub: 'avg monthly waste found', title: 'Orphaned Resource Detection', desc: 'Find every forgotten EC2 instance, unattached EBS volume, and idle load balancer. DevControl surfaces hidden waste your team didn\'t know existed.' },
    { icon: FileText, stat: '1-click', statSub: 'report generation', title: 'Executive Cost Reports', desc: 'Weekly and monthly cost reports formatted for finance teams, board members, and investors. Export to PDF or CSV and share with stakeholders in seconds.' },
    { icon: Zap, stat: '40%', statSub: 'reserved instance savings', title: 'Reserved Instance Optimizer', desc: 'AI analyzes your workload patterns and recommends exactly which instances to commit to reserved pricing — with projected savings before you commit.' },
    { icon: Users, stat: '100%', statSub: 'team cost visibility', title: 'Team-Based Cost Allocation', desc: 'Automatically attribute AWS costs to engineering teams, squads, or business units. Create accountability for cloud spend without building internal tooling.' },
  ]

  const impacts = [
    { value: '$2,400', label: 'Average monthly savings' },
    { value: '8x', label: 'Average ROI on Pro plan' },
    { value: '30%', label: 'Typical AWS cost reduction' },
    { value: '95%', label: 'Budget forecast accuracy' },
  ]

  const workflow = [
    {
      phase: 'Inform',
      color: '#7c3aed',
      bg: 'rgba(124,58,237,0.06)',
      border: 'rgba(124,58,237,0.2)',
      desc: 'Complete cost visibility across all AWS accounts, teams, and services in real time.',
      items: ['Unified cost dashboard', 'Team cost attribution', 'Service-level breakdown'],
    },
    {
      phase: 'Optimize',
      color: '#0ea5e9',
      bg: 'rgba(14,165,233,0.06)',
      border: 'rgba(14,165,233,0.2)',
      desc: 'AI-powered recommendations that find waste and surface savings opportunities automatically.',
      items: ['Idle resource detection', 'Right-sizing recommendations', 'Reserved instance analysis'],
    },
    {
      phase: 'Operate',
      color: '#16a34a',
      bg: 'rgba(22,163,74,0.06)',
      border: 'rgba(22,163,74,0.2)',
      desc: 'Ongoing governance that keeps costs under control as your infrastructure grows.',
      items: ['Budget alerts & forecasting', 'Anomaly detection', 'Weekly executive reports'],
    },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: '140px 48px 100px',
        borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '80px', alignItems: 'center' }}>

            {/* Left — text */}
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>
                Solutions · FinOps Teams
              </div>

              <h1 style={{
                fontSize: 'clamp(2rem, 4vw, 3rem)',
                fontWeight: 800, color: '#0f172a',
                lineHeight: 1.15, marginBottom: '20px',
                letterSpacing: '-0.02em',
              }}>
                Cut AWS Costs 30%.{' '}
                <span style={{ color: '#7c3aed' }}>Show the ROI. Every Month.</span>
              </h1>

              <p style={{
                fontSize: '1.1rem', color: '#374151',
                lineHeight: 1.75, marginBottom: '36px',
              }}>
                AI-powered cloud cost intelligence for FinOps teams. Get complete spend
                visibility, automated savings recommendations, and executive-ready reports
                — without building a single internal tool.
              </p>

              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '32px' }}>
                <a href="/register" style={{
                  background: '#7c3aed', color: '#fff',
                  padding: '14px 32px', borderRadius: '10px',
                  fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
                  boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
                }}>
                  See My AWS Costs Free
                </a>
                <a href="/tour" style={{
                  background: 'transparent', color: '#7c3aed',
                  padding: '14px 32px', borderRadius: '10px',
                  fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
                  border: '1.5px solid #7c3aed',
                }}>
                  Take a Product Tour
                </a>
              </div>

              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '20px',
                fontSize: '0.875rem', fontWeight: 500, color: '#374151',
              }}>
                {['No credit card required', 'ROI in first week', '15-minute setup'].map(t => (
                  <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#16a34a' }}>✓</span> {t}
                  </span>
                ))}
              </div>

              <p style={{ fontSize: '0.9rem', color: '#374151', marginTop: '24px', fontStyle: 'italic' }}>
                {'A FinOps team reduced their AWS bill by 38% in 30 days — recovering $18,200/month that had been invisible in their cost explorer.'}
              </p>
            </div>

            {/* Right — cost ticker visual */}
            <div style={{
              background: '#fff',
              borderRadius: '20px',
              border: '1.5px solid #e5e7eb',
              padding: '32px',
              boxShadow: '0 8px 40px rgba(0,0,0,0.08)',
            }}>
              <div style={{
                fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
                textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '20px',
              }}>
                Live AWS Cost Dashboard
              </div>

              {/* Cost cards */}
              {[
                { label: 'Monthly Spend', value: '$47,284', change: '+12%', bad: true },
                { label: 'Identified Savings', value: '$8,200', change: 'AI Found', bad: false },
                { label: 'Projected Next Month', value: '$39,084', change: '-17%', bad: false },
              ].map(({ label, value, change, bad }) => (
                <div key={label} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px 0',
                  borderBottom: '1px solid #f3f4f6',
                }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '4px' }}>{label}</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>{value}</div>
                  </div>
                  <div style={{
                    background: bad ? 'rgba(239,68,68,0.08)' : 'rgba(22,163,74,0.08)',
                    color: bad ? '#dc2626' : '#16a34a',
                    padding: '4px 12px', borderRadius: '100px',
                    fontSize: '0.8rem', fontWeight: 700,
                  }}>
                    {change}
                  </div>
                </div>
              ))}

              {/* Top services */}
              <div style={{ marginTop: '20px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280', marginBottom: '12px' }}>
                  TOP COST DRIVERS
                </div>
                {[
                  { service: 'EC2', pct: 68, amount: '$32,153' },
                  { service: 'RDS', pct: 18, amount: '$8,511' },
                  { service: 'S3', pct: 8, amount: '$3,782' },
                ].map(({ service, pct, amount }) => (
                  <div key={service} style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>{service}</span>
                      <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{amount}</span>
                    </div>
                    <div style={{ height: '6px', background: '#f3f4f6', borderRadius: '100px' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`,
                        background: '#7c3aed', borderRadius: '100px',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BUSINESS IMPACT BAR — 4 metrics */}
      <section style={{ padding: '48px', background: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '32px', textAlign: 'center',
        }}>
          {impacts.map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
                {value}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#374151', fontWeight: 500, marginTop: '8px' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES — Cards with embedded stats */}
      <section style={{ padding: '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              FinOps Capabilities
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Every Dollar. Every Team. Every Month.
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Eight AI-powered tools that give FinOps teams complete control over cloud spend.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
            {features.map(({ icon: Icon, stat, statSub, title, desc }) => (
              <div key={title} style={{
                background: '#fff', border: '1.5px solid #e5e7eb',
                borderRadius: '16px', padding: '28px',
                transition: 'all 0.2s ease',
                display: 'flex', flexDirection: 'column',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#7c3aed'
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(124,58,237,0.12)'
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#e5e7eb'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
              >
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px',
                  background: 'rgba(124,58,237,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '16px',
                }}>
                  <Icon size={18} style={{ color: '#7c3aed' }} />
                </div>

                {/* Embedded stat */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
                    {stat}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 500, marginTop: '2px' }}>
                    {statSub}
                  </div>
                </div>

                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.7, flex: 1 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINOPS WORKFLOW */}
      <section style={{ padding: '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              FinOps Framework
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              DevControl Across the FinOps Lifecycle
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Built around the Inform → Optimize → Operate FinOps cycle used by leading cloud finance teams.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {workflow.map(({ phase, color, bg, border, desc, items }) => (
              <div key={phase} style={{
                background: bg, border: `1.5px solid ${border}`,
                borderRadius: '20px', padding: '36px',
              }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: color, color: '#fff',
                  borderRadius: '100px', padding: '6px 20px',
                  fontSize: '0.85rem', fontWeight: 700,
                  marginBottom: '20px',
                }}>
                  {phase}
                </div>
                <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.7, marginBottom: '24px' }}>
                  {desc}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {items.map(item => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ color, fontWeight: 700 }}>✓</span>
                      <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section style={{ padding: '64px 48px', background: '#fff' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '280px 1fr',
            gap: '64px',
            alignItems: 'start',
          }}>
            {/* Left — big number */}
            <div style={{ textAlign: 'center', paddingTop: '16px' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '16px' }}>
                Avg. First Month
              </p>
              <p style={{ fontSize: '4rem', fontWeight: 900, color: '#7c3aed', lineHeight: 1, margin: '0 0 8px', letterSpacing: '-0.04em' }}>
                $2,400
              </p>
              <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', margin: '0 0 8px' }}>
                in savings found
              </p>
              <p style={{ fontSize: '0.82rem', color: '#64748B', margin: '0 0 24px' }}>
                Average across all DevControl customers in their first 30 days
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { value: '8x', label: 'Average ROI on Pro plan' },
                  { value: '30%', label: 'Typical AWS cost reduction' },
                  { value: '15 min', label: 'Time to first savings report' },
                ].map(({ value, label }) => (
                  <div key={label} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', color: '#64748B' }}>{label}</span>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: '#7c3aed' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — stacked quotes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '4px' }}>
                FinOps Team Results
              </p>
              {[
                {
                  quote: 'We had no idea EC2 was running at 12% utilization across 40 instances. DevControl found $8,400/month we could cut immediately — without touching a single production workload.',
                  name: 'Linda C.',
                  title: 'Head of FinOps · Series C SaaS',
                  outcome: 'Saved $8,400/month',
                  initials: 'LC',
                },
                {
                  quote: 'The reserved instance optimizer alone paid for 6 months of DevControl in the first recommendation. The ROI math was embarrassingly obvious.',
                  name: 'Ryan M.',
                  title: 'Cloud Finance Lead · Enterprise B2B',
                  outcome: '12x ROI in month 1',
                  initials: 'RM',
                },
                {
                  quote: 'Finance used to ask me for cost reports every month. Now I just send them a link to the DevControl dashboard. That alone saved me 4 hours a week.',
                  name: 'Priya K.',
                  title: 'VP Engineering · Growth Startup',
                  outcome: 'Eliminated 4hrs/week',
                  initials: 'PK',
                },
              ].map(({ quote, name, title, outcome, initials }) => (
                <div key={name} style={{
                  background: '#F9FAFB',
                  border: '1px solid #E2E8F0',
                  borderRadius: '14px',
                  padding: '24px',
                }}>
                  <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.7, fontStyle: 'italic', margin: '0 0 16px' }}>
                    {'\u201C'}{quote}{'\u201D'}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '50%',
                      background: '#EDE9FE', color: '#7C3AED',
                      fontWeight: 700, fontSize: '11px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {initials}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A', margin: 0 }}>{name}</p>
                      <p style={{ fontSize: '11px', color: '#64748B', margin: 0 }}>{title}</p>
                    </div>
                    <div style={{
                      background: '#ECFDF5', color: '#059669',
                      padding: '3px 10px', borderRadius: '999px',
                      fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                      {outcome}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section style={{ padding: '80px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Built For Your Team
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Who It&apos;s For
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px' }}>
            <div style={{
              background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: '20px', padding: '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: 'rgba(124,58,237,0.08)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For FinOps &amp; Finance Teams
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Complete Cloud Cost Control
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Real-time spend visibility across all AWS accounts',
                  'Automated cost allocation to teams and cost centers',
                  'Budget forecasting with 95% accuracy',
                  'One-click reports for finance and board reviews',
                ].map(point => (
                  <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ color: '#7c3aed', fontWeight: 700, marginTop: '1px' }}>✓</span>
                    <span style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>{point}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
              border: '1.5px solid rgba(124,58,237,0.2)',
              borderRadius: '20px', padding: '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: '#7c3aed',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For CTOs &amp; Engineering Leaders
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Engineering Accountability for Cloud Spend
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Team-level cost attribution drives ownership',
                  'AI savings recommendations ready to act on',
                  'Anomaly alerts before bills spiral out of control',
                  'Reserved instance strategy optimized automatically',
                ].map(point => (
                  <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ color: '#7c3aed', fontWeight: 700, marginTop: '1px' }}>✓</span>
                    <span style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>{point}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BOTTOM CTA — with ROI teaser */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
        padding: '80px 48px', textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

          {/* ROI teaser box */}
          <div style={{
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '16px', padding: '24px 32px',
            display: 'inline-flex', gap: '48px',
            marginBottom: '40px', flexWrap: 'wrap', justifyContent: 'center',
          }}>
            {[
              { label: 'DevControl Pro Cost', value: '$299/mo' },
              { label: 'Average Savings Found', value: '$2,400/mo' },
              { label: 'Your ROI', value: '8x' },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>{label}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>{value}</div>
              </div>
            ))}
          </div>

          <h2 style={{
            fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800,
            color: '#fff', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Stop Overpaying for AWS. Start Today.
          </h2>
          <p style={{
            fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Get your first AWS cost report in 15 minutes. See exactly where you&apos;re
            overspending and how much you can save.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/register" style={{
              background: '#fff', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
            }}>
              Start Free Trial
            </a>
            <a href="/pricing" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
            }}>
              View Pricing
            </a>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginTop: '16px' }}>
            No credit card required · Read-only AWS access · Cancel anytime
          </div>
        </div>
      </section>

    </div>
  )
}
