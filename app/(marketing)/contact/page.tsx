
'use client'

import { useState } from 'react'
import { Calendar, Mail, MessageCircle, Building2, User, Phone, CheckCircle, Clock, Users, Zap } from 'lucide-react'

export default function ContactPage() {
  const [formState, setFormState] = useState({
    name: '', email: '', company: '', role: '', message: '', reason: 'demo',
  })
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = () => {
    if (!formState.name || !formState.email) return
    const subject = formState.reason === 'demo'
      ? `Demo Request from ${formState.company || formState.name}`
      : `Contact from ${formState.company || formState.name}`
    const body = `Name: ${formState.name}%0AEmail: ${formState.email}%0ACompany: ${formState.company}%0ARole: ${formState.role}%0A%0AMessage:%0A${formState.message}`
    window.location.href = `mailto:hello@devcontrol.io?subject=${subject}&body=${body}`
    setSubmitted(true)
  }

  const reasons = [
    { value: 'demo', label: 'Schedule a Demo' },
    { value: 'enterprise', label: 'Enterprise Pricing' },
    { value: 'support', label: 'Technical Support' },
    { value: 'partnership', label: 'Partnership' },
    { value: 'other', label: 'Other' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: '80px 48px',
        borderBottom: '1px solid #f3f4f6',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Get in Touch
          </div>
          <h1 style={{
            fontSize: 'clamp(2.2rem, 5vw, 3.2rem)',
            fontWeight: 800, color: '#0f172a',
            lineHeight: 1.15, marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}>
            Let&apos;s Talk About Your{' '}
            <span style={{ color: '#7c3aed' }}>AWS Infrastructure</span>
          </h1>
          <p style={{
            fontSize: '1.1rem', color: '#374151',
            lineHeight: 1.75, maxWidth: '520px',
            margin: '0 auto',
          }}>
            Book a 30-minute demo or send us a message.
            Our team typically responds within 2 hours on business days.
          </p>
        </div>
      </section>

      {/* MAIN CONTENT */}
      <section style={{ padding: '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '64px', alignItems: 'start' }}>

            {/* LEFT — Book a Demo */}
            <div>
              <div style={{ marginBottom: '40px' }}>
                <div style={{
                  fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
                  textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
                }}>
                  Book a Demo
                </div>
                <h2 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a', marginBottom: '12px', letterSpacing: '-0.02em' }}>
                  See DevControl in 30 Minutes
                </h2>
                <p style={{ fontSize: '0.95rem', color: '#374151', lineHeight: 1.75 }}>
                  We&apos;ll walk you through a live demo tailored to your infrastructure,
                  show you exactly how much you could save, and answer every question you have.
                </p>
              </div>

              {/* What to expect */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '36px' }}>
                {[
                  { icon: Clock, title: '30-minute call', desc: 'No pressure, no sales pitch — just a live walkthrough of your specific AWS setup' },
                  { icon: Zap, title: 'Live savings analysis', desc: 'We\'ll show you estimated savings based on your actual AWS spend and infrastructure' },
                  { icon: Users, title: 'Meet the team', desc: 'Talk directly with the engineers who built DevControl — not a sales rep' },
                  { icon: CheckCircle, title: 'Custom deployment plan', desc: 'Leave with a clear plan for getting your team set up in under 15 minutes' },
                ].map(({ icon: Icon, title, desc }) => (
                  <div key={title} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '10px',
                      background: 'rgba(124,58,237,0.08)', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={18} style={{ color: '#7c3aed' }} />
                    </div>
                    <div>
                      <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>{title}</p>
                      <p style={{ fontSize: '0.82rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Calendly placeholder */}
              <div style={{
                background: '#faf5ff',
                border: '2px dashed rgba(124,58,237,0.3)',
                borderRadius: '16px',
                padding: '40px 32px',
                textAlign: 'center',
              }}>
                <Calendar size={32} style={{ color: '#7c3aed', margin: '0 auto 16px' }} />
                <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                  Schedule via Calendly
                </p>
                <p style={{ fontSize: '0.85rem', color: '#64748B', marginBottom: '20px' }}>
                  Pick a time that works for you — no back-and-forth email needed.
                </p>
                <a
                  href="https://calendly.com/uwamarigoddey/30min"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    background: '#7c3aed', color: '#fff',
                    padding: '12px 28px', borderRadius: '10px',
                    fontWeight: 700, fontSize: '0.9rem', textDecoration: 'none',
                    boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
                  }}
                >
                  <Calendar size={16} />
                  Book a 30-Min Demo
                </a>
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '12px' }}>
                  Usually available within 24 hours
                </p>
              </div>
            </div>

            {/* RIGHT — Contact Form */}
            <div>
              <div style={{ marginBottom: '32px' }}>
                <div style={{
                  fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
                  textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
                }}>
                  Send a Message
                </div>
                <h2 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a', marginBottom: '12px', letterSpacing: '-0.02em' }}>
                  Get in Touch Directly
                </h2>
                <p style={{ fontSize: '0.95rem', color: '#374151', lineHeight: 1.75 }}>
                  Prefer to reach out by email? Fill in the form below and
                  we&apos;ll get back to you within 2 hours on business days.
                </p>
              </div>

              {submitted ? (
                <div style={{
                  background: '#f0fdf4', border: '1.5px solid #86efac',
                  borderRadius: '16px', padding: '40px', textAlign: 'center',
                }}>
                  <CheckCircle size={40} style={{ color: '#16a34a', margin: '0 auto 16px' }} />
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                    Message Sent
                  </h3>
                  <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.7 }}>
                    Your email client should have opened. If not, email us directly at{' '}
                    <a href="mailto:hello@devcontrol.io" style={{ color: '#7c3aed', fontWeight: 600 }}>
                      hello@devcontrol.io
                    </a>
                  </p>
                  <button
                    onClick={() => setSubmitted(false)}
                    style={{
                      marginTop: '20px', background: 'transparent', color: '#7c3aed',
                      border: '1.5px solid #7c3aed', padding: '10px 24px',
                      borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
                    }}
                  >
                    Send Another Message
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                  {/* Reason */}
                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '8px' }}>
                      What can we help you with?
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {reasons.map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => setFormState(s => ({ ...s, reason: value }))}
                          style={{
                            padding: '7px 14px', borderRadius: '8px', cursor: 'pointer',
                            border: formState.reason === value ? 'none' : '1px solid #e5e7eb',
                            background: formState.reason === value ? '#7c3aed' : '#fff',
                            color: formState.reason === value ? '#fff' : '#374151',
                            fontSize: '0.82rem', fontWeight: 500,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Name + Email */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>
                        Name *
                      </label>
                      <div style={{ position: 'relative' }}>
                        <User size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                        <input
                          type="text"
                          placeholder="Your name"
                          value={formState.name}
                          onChange={e => setFormState(s => ({ ...s, name: e.target.value }))}
                          style={{
                            width: '100%', height: '42px', paddingLeft: '36px', paddingRight: '12px',
                            borderRadius: '8px', border: '1.5px solid #e5e7eb', background: '#fff',
                            fontSize: '0.875rem', outline: 'none', color: '#0f172a', boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>
                        Work Email *
                      </label>
                      <div style={{ position: 'relative' }}>
                        <Mail size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                        <input
                          type="email"
                          placeholder="you@company.com"
                          value={formState.email}
                          onChange={e => setFormState(s => ({ ...s, email: e.target.value }))}
                          style={{
                            width: '100%', height: '42px', paddingLeft: '36px', paddingRight: '12px',
                            borderRadius: '8px', border: '1.5px solid #e5e7eb', background: '#fff',
                            fontSize: '0.875rem', outline: 'none', color: '#0f172a', boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Company + Role */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>
                        Company
                      </label>
                      <div style={{ position: 'relative' }}>
                        <Building2 size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                        <input
                          type="text"
                          placeholder="Company name"
                          value={formState.company}
                          onChange={e => setFormState(s => ({ ...s, company: e.target.value }))}
                          style={{
                            width: '100%', height: '42px', paddingLeft: '36px', paddingRight: '12px',
                            borderRadius: '8px', border: '1.5px solid #e5e7eb', background: '#fff',
                            fontSize: '0.875rem', outline: 'none', color: '#0f172a', boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>
                        Your Role
                      </label>
                      <div style={{ position: 'relative' }}>
                        <Phone size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                        <input
                          type="text"
                          placeholder="e.g. CTO, VP Engineering"
                          value={formState.role}
                          onChange={e => setFormState(s => ({ ...s, role: e.target.value }))}
                          style={{
                            width: '100%', height: '42px', paddingLeft: '36px', paddingRight: '12px',
                            borderRadius: '8px', border: '1.5px solid #e5e7eb', background: '#fff',
                            fontSize: '0.875rem', outline: 'none', color: '#0f172a', boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Message */}
                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>
                      Message
                    </label>
                    <div style={{ position: 'relative' }}>
                      <MessageCircle size={14} style={{ position: 'absolute', left: '12px', top: '14px', color: '#9ca3af' }} />
                      <textarea
                        placeholder="Tell us about your AWS setup, team size, or what you're trying to solve..."
                        value={formState.message}
                        onChange={e => setFormState(s => ({ ...s, message: e.target.value }))}
                        rows={4}
                        style={{
                          width: '100%', paddingLeft: '36px', paddingRight: '12px', paddingTop: '12px',
                          borderRadius: '8px', border: '1.5px solid #e5e7eb', background: '#fff',
                          fontSize: '0.875rem', outline: 'none', color: '#0f172a',
                          boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.6,
                          fontFamily: 'inherit',
                        }}
                      />
                    </div>
                  </div>

                  {/* Submit */}
                  <button
                    onClick={handleSubmit}
                    style={{
                      background: '#7c3aed', color: '#fff',
                      padding: '14px 28px', borderRadius: '10px',
                      fontWeight: 700, fontSize: '1rem', border: 'none',
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: '8px',
                      boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
                    }}
                  >
                    <Mail size={16} />
                    Send Message
                  </button>

                  <p style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>
                    Or email us directly at{' '}
                    <a href="mailto:hello@devcontrol.io" style={{ color: '#7c3aed', fontWeight: 600 }}>
                      hello@devcontrol.io
                    </a>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF STRIP */}
      <section style={{ padding: '48px', background: '#fafafa', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '32px', textAlign: 'center' }}>
            {[
              { value: '500+', label: 'Engineering teams onboarded' },
              { value: '$2,400', label: 'Average monthly savings found' },
              { value: '2 hrs', label: 'Typical response time' },
            ].map(({ value, label }) => (
              <div key={label}>
                <p style={{ fontSize: '2rem', fontWeight: 800, color: '#7c3aed', margin: '0 0 4px', lineHeight: 1 }}>{value}</p>
                <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0 }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
        padding: '64px 48px', textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', fontWeight: 800,
            color: '#fff', marginBottom: '12px', letterSpacing: '-0.02em',
          }}>
            Not Ready to Talk Yet?
          </h2>
          <p style={{
            fontSize: '1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '400px', margin: '0 auto 24px', lineHeight: 1.7,
          }}>
            Start free and explore DevControl on your own. No credit card, no commitment.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/register" style={{
              background: '#fff', color: '#7c3aed',
              padding: '12px 28px', borderRadius: '10px',
              fontWeight: 700, fontSize: '0.95rem', textDecoration: 'none',
            }}>
              Start Free Trial
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#fff',
              padding: '12px 28px', borderRadius: '10px',
              fontWeight: 600, fontSize: '0.95rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
            }}>
              Take a Product Tour
            </a>
          </div>
        </div>
      </section>

    </div>
  )
}
