'use client'
import { Layers, Plus, Rocket, GitBranch, Activity, ArrowRight, CheckCircle, AlertCircle } from 'lucide-react'
import Link from 'next/link'

export default function ServicesPage() {
  const quickLinks = [
    { icon: Plus, label: 'Add Service', href: '/services/new', desc: 'Register a new service', color: '#7c3aed' },
    { icon: Rocket, label: 'Deployments', href: '/deployments', desc: 'View deployment history', color: '#0ea5e9' },
    { icon: GitBranch, label: 'Dependencies', href: '/dependencies', desc: 'Service dependency map', color: '#16a34a' },
    { icon: Activity, label: 'Status Page', href: '/status', desc: 'Live system status', color: '#f59e0b' },
  ]

  const mockServices = [
    { name: 'api-gateway', env: 'production', status: 'Healthy', region: 'us-east-1', deployments: 12, uptime: '99.9%' },
    { name: 'auth-service', env: 'production', status: 'Healthy', region: 'us-east-1', deployments: 8, uptime: '99.7%' },
    { name: 'payment-processor', env: 'staging', status: 'Warning', region: 'us-west-2', deployments: 5, uptime: '98.2%' },
    { name: 'notification-service', env: 'production', status: 'Healthy', region: 'us-east-1', deployments: 15, uptime: '99.9%' },
    { name: 'analytics-worker', env: 'production', status: 'Healthy', region: 'eu-west-1', deployments: 3, uptime: '99.5%' },
  ]

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1400px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(124,58,237,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={20} style={{ color: '#7c3aed' }} />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Services</h1>
        </div>
        <p style={{ color: '#6b7280', fontSize: '0.95rem', margin: 0 }}>
          Manage and monitor all your services, deployments, and dependencies.
        </p>
      </div>

      {/* Quick Links */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
        {quickLinks.map(({ icon: Icon, label, href, desc, color }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '20px', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(124,58,237,0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                <Icon size={18} style={{ color }} />
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>{label}</div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Services Table */}
      <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '16px', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>All Services</h2>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '2px 0 0' }}>{mockServices.length} services registered</p>
          </div>
          <Link href="/services/new" style={{ background: '#7c3aed', color: '#fff', padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={14} /> Add Service
          </Link>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              {['Service', 'Environment', 'Region', 'Status', 'Deployments', 'Uptime', ''].map(h => (
                <th key={h} style={{ padding: '10px 24px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockServices.map((s) => (
              <tr key={s.name} style={{ borderTop: '1px solid #f3f4f6' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                <td style={{ padding: '14px 24px' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', fontFamily: 'monospace' }}>{s.name}</span>
                </td>
                <td style={{ padding: '14px 24px' }}>
                  <span style={{ fontSize: '0.8rem', background: s.env === 'production' ? '#f0fdf4' : '#fef9c3', color: s.env === 'production' ? '#16a34a' : '#d97706', padding: '2px 8px', borderRadius: '100px', fontWeight: 600 }}>{s.env}</span>
                </td>
                <td style={{ padding: '14px 24px', fontSize: '0.85rem', color: '#374151', fontFamily: 'monospace' }}>{s.region}</td>
                <td style={{ padding: '14px 24px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, color: s.status === 'Healthy' ? '#16a34a' : '#d97706' }}>
                    {s.status === 'Healthy' ? <CheckCircle size={14} /> : <AlertCircle size={14} />} {s.status}
                  </span>
                </td>
                <td style={{ padding: '14px 24px', fontSize: '0.85rem', color: '#374151' }}>{s.deployments}</td>
                <td style={{ padding: '14px 24px', fontSize: '0.85rem', fontWeight: 600, color: '#0f172a' }}>{s.uptime}</td>
                <td style={{ padding: '14px 24px' }}>
                  <Link href="/deployments" style={{ fontSize: '0.8rem', color: '#7c3aed', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    View <ArrowRight size={12} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
