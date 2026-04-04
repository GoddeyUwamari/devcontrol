'use client';

import { useState } from 'react';
import api from '@/lib/api';
import {
  FileText, Calendar, ArrowRight, Search, Clock, TrendingUp,
  Sparkles, Code2, Shield, DollarSign, Rocket, Mail, Tag,
  Filter, BookOpen, Star,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default function BlogPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [emailSubscribe, setEmailSubscribe] = useState('');
  const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'duplicate'>('idle');

  const handleSubscribe = async () => {
    if (!emailSubscribe || !emailSubscribe.includes('@')) return;
    setSubscribeStatus('loading');
    try {
      const res = await api.post('/api/newsletter/subscribe', { email: emailSubscribe, source: 'blog' });
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

  const posts = [
    {
      id: 1,
      title: 'Introducing DORA Metrics in DevControl',
      description:
        'Track deployment frequency, lead time, change failure rate, and recovery time with our new DORA metrics dashboard. Learn how elite performers measure success.',
      date: '2026-03-28',
      category: 'Product',
      author: { name: 'Sarah Chen', role: 'Product Manager', avatar: 'SC' },
      readTime: '5 min read',
      tags: ['DORA', 'Metrics', 'DevOps'],
      featured: true,
      image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80',
    },
    {
      id: 2,
      title: 'Best Practices for Service Catalog Management',
      description:
        'Learn how leading engineering teams organize and maintain their service catalogs at scale. A comprehensive guide to ownership, metadata, and discoverability.',
      date: '2026-03-21',
      category: 'Engineering',
      author: { name: 'Michael Torres', role: 'Staff Engineer', avatar: 'MT' },
      readTime: '8 min read',
      tags: ['Service Catalog', 'Best Practices', 'Platform Engineering'],
      featured: false,
      image: 'https://images.unsplash.com/photo-1507537297725-24a1c029d3ca?auto=format&fit=crop&w=800&q=80',
    },
    {
      id: 3,
      title: 'Reducing AWS Costs with Infrastructure Visibility',
      description:
        'How one team saved 30% on their AWS bill by understanding their infrastructure dependencies. Real-world strategies for cost optimization.',
      date: '2026-03-14',
      category: 'Case Study',
      author: { name: 'Emily Rodriguez', role: 'Solutions Architect', avatar: 'ER' },
      readTime: '6 min read',
      tags: ['AWS', 'Cost Optimization', 'Case Study'],
      featured: true,
      image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
    },
    {
      id: 4,
      title: 'The Platform Engineering Maturity Model',
      description:
        'A framework for assessing and improving your internal developer platform. Understand where you are and how to level up.',
      date: '2026-03-07',
      category: 'Engineering',
      author: { name: 'David Kim', role: 'Engineering Lead', avatar: 'DK' },
      readTime: '10 min read',
      tags: ['Platform Engineering', 'Framework', 'Maturity Model'],
      featured: false,
      image: 'https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&w=800&q=80',
    },
    {
      id: 5,
      title: 'Security Scanning at Scale: Lessons Learned',
      description:
        'How we built a security scanning system that checks 10,000+ resources daily without impacting performance. Architecture and best practices.',
      date: '2026-02-28',
      category: 'Security',
      author: { name: 'Alex Thompson', role: 'Security Engineer', avatar: 'AT' },
      readTime: '7 min read',
      tags: ['Security', 'Scanning', 'Architecture'],
      featured: false,
      image: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=800&q=80',
    },
    {
      id: 6,
      title: 'From Chaos to Clarity: Service Ownership Models',
      description:
        'Establishing clear ownership for microservices. How to define responsibilities, on-call rotations, and accountability in distributed systems.',
      date: '2026-02-21',
      category: 'Engineering',
      author: { name: 'Jessica Park', role: 'Engineering Manager', avatar: 'JP' },
      readTime: '9 min read',
      tags: ['Ownership', 'Microservices', 'Teams'],
      featured: false,
      image: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80',
    },
  ];

  const categories = [
    { name: 'All', icon: BookOpen, count: posts.length },
    { name: 'Product', icon: Sparkles, count: posts.filter((p) => p.category === 'Product').length },
    { name: 'Engineering', icon: Code2, count: posts.filter((p) => p.category === 'Engineering').length },
    { name: 'Security', icon: Shield, count: posts.filter((p) => p.category === 'Security').length },
    { name: 'Case Study', icon: TrendingUp, count: posts.filter((p) => p.category === 'Case Study').length },
  ];

  const filteredPosts = posts.filter((post) => {
    const matchesCategory = selectedCategory === 'All' || post.category === selectedCategory;
    const matchesSearch =
      searchQuery === '' ||
      post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const featuredPosts = posts.filter((p) => p.featured);
  const regularPosts = filteredPosts.filter((p) => !p.featured);

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* Hero */}
      <section style={{ background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)', padding: '80px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'rgba(124,58,237,0.1)', borderRadius: '20px',
            padding: '4px 14px', marginBottom: '20px',
          }}>
            <FileText style={{ width: '14px', height: '14px', color: '#7c3aed' }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#7c3aed', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              DevControl Blog
            </span>
          </div>
          <h1 style={{
            color: '#0f172a', fontWeight: 800,
            fontSize: 'clamp(2rem, 4vw, 2.8rem)',
            marginBottom: '16px', letterSpacing: '-0.02em', lineHeight: 1.2,
          }}>
            Engineering Insights &amp; Product Updates
          </h1>
          <p style={{ color: '#374151', fontSize: '1.1rem', maxWidth: '600px', margin: '0 auto 32px', lineHeight: 1.6 }}>
            Platform engineering insights, product updates, and best practices from industry leaders and the DevControl team.
          </p>
          <div style={{ position: 'relative', maxWidth: '480px', margin: '0 auto' }}>
            <Search style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', width: '18px', height: '18px', color: '#9ca3af' }} />
            <input
              type="text"
              placeholder="Search articles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%', height: '48px', paddingLeft: '44px', paddingRight: '16px',
                borderRadius: '10px', border: '1px solid #e5e7eb', background: '#fff',
                fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
                color: '#0f172a',
              }}
            />
          </div>
        </div>
      </section>

      {/* Content */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 48px' }}>

        {/* Category Filters */}
        <div style={{ padding: '40px 0 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Filter style={{ width: '15px', height: '15px', color: '#9ca3af' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#6b7280' }}>Filter by category</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {categories.map((category) => {
              const Icon = category.icon;
              const active = selectedCategory === category.name;
              return (
                <button
                  key={category.name}
                  onClick={() => setSelectedCategory(category.name)}
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
                  {category.name}
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 600,
                    background: active ? 'rgba(255,255,255,0.25)' : '#f3f4f6',
                    color: active ? '#fff' : '#6b7280',
                    padding: '1px 7px', borderRadius: '10px', marginLeft: '2px',
                  }}>
                    {category.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Featured Posts */}
        {selectedCategory === 'All' && searchQuery === '' && featuredPosts.length > 0 && (
          <div style={{ marginBottom: '48px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <Star style={{ width: '18px', height: '18px', color: '#f59e0b' }} />
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>Featured Articles</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px' }}>
              {featuredPosts.slice(0, 2).map((post) => (
                <Link key={post.id} href={'/blog/' + post.id} style={{ textDecoration: 'none', display: 'block' }}>
                <div
                  style={{
                    border: '1px solid #e5e7eb', borderRadius: '16px',
                    overflow: 'hidden', background: '#fff',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    transition: 'box-shadow 0.2s ease',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)')}
                >
                  <div style={{ position: 'relative', height: '200px', overflow: 'hidden' }}>
                    <Image src={post.image} alt={post.title} fill style={{ objectFit: 'cover' }} unoptimized />
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.2), transparent)' }} />
                    <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
                      <span style={{
                        background: '#f59e0b', color: '#fff', fontSize: '0.75rem',
                        fontWeight: 700, padding: '3px 10px', borderRadius: '6px',
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                      }}>
                        <Star style={{ width: '10px', height: '10px' }} /> Featured
                      </span>
                    </div>
                  </div>
                  <div style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#7c3aed', background: '#ede9fe', padding: '2px 10px', borderRadius: '6px' }}>
                        {post.category}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#6b7280' }}>
                        <Calendar style={{ width: '11px', height: '11px' }} />
                        {new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#6b7280' }}>
                        <Clock style={{ width: '11px', height: '11px' }} />
                        {post.readTime}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px', lineHeight: 1.3 }}>
                      {post.title}
                    </h3>
                    <p style={{ fontSize: '0.875rem', color: '#4b5563', lineHeight: 1.6, marginBottom: '20px' }}>
                      {post.description}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(124,58,237,0.1))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.7rem', fontWeight: 700, color: '#7c3aed',
                        }}>
                          {post.author.avatar}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a' }}>{post.author.name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{post.author.role}</div>
                        </div>
                      </div>
                      <ArrowRight style={{ width: '18px', height: '18px', color: '#7c3aed' }} />
                    </div>
                  </div>
                </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Regular Posts */}
        <div style={{ marginBottom: '48px' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', marginBottom: '24px' }}>
            {selectedCategory !== 'All' || searchQuery !== ''
              ? `${filteredPosts.length} ${filteredPosts.length === 1 ? 'Article' : 'Articles'}${searchQuery ? ` matching "${searchQuery}"` : ''}`
              : 'Latest Articles'}
          </h2>

          {filteredPosts.length === 0 ? (
            <div style={{ padding: '64px 24px', textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: '16px' }}>
              <FileText style={{ width: '48px', height: '48px', color: '#9ca3af', margin: '0 auto 16px' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0f172a', marginBottom: '8px' }}>No articles found</h3>
              <p style={{ color: '#6b7280', marginBottom: '20px' }}>Try adjusting your search or filter criteria</p>
              <button
                onClick={() => { setSearchQuery(''); setSelectedCategory('All'); }}
                style={{
                  padding: '8px 20px', borderRadius: '8px', border: '1px solid #e5e7eb',
                  background: '#fff', color: '#374151', fontSize: '0.875rem',
                  fontWeight: 500, cursor: 'pointer',
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
              {(selectedCategory === 'All' && searchQuery === '' ? regularPosts : filteredPosts).map((post) => (
                <Link key={post.id} href={'/blog/' + post.id} style={{ textDecoration: 'none', display: 'block' }}>
                <div
                  style={{
                    border: '1px solid #e5e7eb', borderRadius: '14px', overflow: 'hidden',
                    background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                    display: 'flex', flexDirection: 'column', cursor: 'pointer',
                    transition: 'box-shadow 0.2s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)')}
                >
                  <div style={{ position: 'relative', height: '168px', overflow: 'hidden', background: '#f3f4f6' }}>
                    <Image src={post.image} alt={post.title} fill style={{ objectFit: 'cover' }} unoptimized />
                  </div>
                  <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7c3aed', border: '1px solid #ddd6fe', padding: '2px 8px', borderRadius: '5px' }}>
                        {post.category}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.72rem', color: '#6b7280' }}>
                        <Clock style={{ width: '10px', height: '10px' }} />
                        {post.readTime}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.35, marginBottom: '8px' }}>
                      {post.title}
                    </h3>
                    <p style={{ fontSize: '0.82rem', color: '#4b5563', lineHeight: 1.55, flex: 1, marginBottom: '16px' }}>
                      {post.description}
                    </p>
                    <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '28px', height: '28px', borderRadius: '50%',
                            background: 'linear-gradient(135deg, rgba(124,58,237,0.25), rgba(124,58,237,0.08))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.65rem', fontWeight: 700, color: '#7c3aed',
                          }}>
                            {post.author.avatar}
                          </div>
                          <span style={{ fontSize: '0.78rem', color: '#4b5563' }}>{post.author.name}</span>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                          {new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {post.tags.slice(0, 3).map((tag) => (
                          <span key={tag} style={{
                            fontSize: '0.7rem', fontWeight: 500, color: '#6b7280',
                            background: '#f3f4f6', padding: '2px 8px', borderRadius: '5px',
                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                          }}>
                            <Tag style={{ width: '9px', height: '9px' }} />
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Newsletter */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(124,58,237,0.03))',
          border: '1px solid rgba(124,58,237,0.15)',
          borderRadius: '20px', padding: '48px 32px',
          textAlign: 'center', marginBottom: '48px',
        }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: '50%',
            background: 'rgba(124,58,237,0.12)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
          }}>
            <Mail style={{ width: '22px', height: '22px', color: '#7c3aed' }} />
          </div>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
            Stay Updated with DevControl
          </h3>
          <p style={{ color: '#4b5563', maxWidth: '480px', margin: '0 auto 24px', lineHeight: 1.6 }}>
            Get the latest platform engineering insights, product updates, and best practices delivered to your inbox every week.
          </p>
          <div style={{ display: 'flex', gap: '12px', maxWidth: '400px', margin: '0 auto' }}>
            <input
              type="email"
              placeholder="Enter your email"
              value={emailSubscribe}
              onChange={(e) => setEmailSubscribe(e.target.value)}
              style={{
                flex: 1, height: '44px', paddingLeft: '14px', paddingRight: '14px',
                borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff',
                fontSize: '0.875rem', outline: 'none', color: '#0f172a', boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleSubscribe}
              disabled={subscribeStatus === 'loading' || subscribeStatus === 'success'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                height: '44px', padding: '0 20px', borderRadius: '8px',
                background: subscribeStatus === 'success' ? '#059669' : '#7c3aed',
                color: '#fff', fontWeight: 600,
                fontSize: '0.875rem', border: 'none', cursor: subscribeStatus === 'loading' || subscribeStatus === 'success' ? 'default' : 'pointer',
                whiteSpace: 'nowrap', opacity: subscribeStatus === 'loading' ? 0.7 : 1,
              }}
            >
              {subscribeStatus === 'loading' ? 'Subscribing...' : subscribeStatus === 'success' ? 'Subscribed!' : <>Subscribe <ArrowRight style={{ width: '14px', height: '14px' }} /></>}
            </button>
          </div>
          {subscribeStatus === 'success' && (
            <p style={{ fontSize: '0.8rem', color: '#059669', marginTop: '10px' }}>
              You&apos;re subscribed! We&apos;ll notify you of new posts.
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

        {/* Popular Topics */}
        <div style={{ marginBottom: '48px' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', marginBottom: '24px' }}>Popular Topics</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            {[
              { name: 'DORA Metrics', icon: TrendingUp, count: 2 },
              { name: 'Cost Optimization', icon: DollarSign, count: 1 },
              { name: 'Platform Engineering', icon: Rocket, count: 2 },
              { name: 'Security', icon: Shield, count: 1 },
            ].map((topic) => {
              const Icon = topic.icon;
              return (
                <div
                  key={topic.name}
                  style={{
                    border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px',
                    background: '#fff', cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'box-shadow 0.15s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '10px',
                      background: 'rgba(124,58,237,0.1)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <Icon style={{ width: '18px', height: '18px', color: '#7c3aed' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{topic.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{topic.count} articles</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resources */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px', paddingBottom: '64px' }}>
          <Link href="/docs" style={{ textDecoration: 'none' }}>
            <div
              style={{
                border: '1px solid #e5e7eb', borderRadius: '14px', padding: '24px',
                background: '#fff', cursor: 'pointer', transition: 'box-shadow 0.15s ease',
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <BookOpen style={{ width: '18px', height: '18px', color: '#7c3aed' }} />
                <span style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>Documentation</span>
                <ArrowRight style={{ width: '14px', height: '14px', color: '#7c3aed', marginLeft: 'auto' }} />
              </div>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
                Comprehensive guides, tutorials, and API references
              </p>
            </div>
          </Link>
          <Link href="/changelog" style={{ textDecoration: 'none' }}>
            <div
              style={{
                border: '1px solid #e5e7eb', borderRadius: '14px', padding: '24px',
                background: '#fff', cursor: 'pointer', transition: 'box-shadow 0.15s ease',
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <Sparkles style={{ width: '18px', height: '18px', color: '#7c3aed' }} />
                <span style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>Changelog</span>
                <ArrowRight style={{ width: '14px', height: '14px', color: '#7c3aed', marginLeft: 'auto' }} />
              </div>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
                See what&apos;s new and improved in DevControl
              </p>
            </div>
          </Link>
        </div>

      </div>
    </div>
  );
}
