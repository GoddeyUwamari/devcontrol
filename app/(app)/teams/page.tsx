'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Users, Plus, X, Slack, Trash2, AlertTriangle } from 'lucide-react'
import { teamsService } from '@/lib/services/teams.service'
import type { Team, CreateTeamPayload } from '@/lib/types'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'

const DEMO_TEAMS: Team[] = [
  { id: 'team-1', name: 'Platform Engineering', description: 'Core infrastructure, CI/CD, and DevOps',      members: ['u1','u2','u3','u4','u5'],                   slackChannel: '#platform-eng', owner: 'Sarah Chen',    createdAt: '2024-01-15T00:00:00Z', updatedAt: '2024-03-01T00:00:00Z' },
  { id: 'team-2', name: 'Backend Services',      description: 'APIs, microservices, and data layer',        members: ['u6','u7','u8','u9','u10','u11','u12'],       slackChannel: '#backend',      owner: 'Marcus Rivera', createdAt: '2024-01-20T00:00:00Z', updatedAt: '2024-03-10T00:00:00Z' },
  { id: 'team-3', name: 'Frontend',              description: 'Web applications and design system',         members: ['u13','u14','u15','u16','u17','u18'],         slackChannel: '#frontend',     owner: 'Priya Nair',    createdAt: '2024-02-01T00:00:00Z', updatedAt: '2024-03-12T00:00:00Z' },
  { id: 'team-4', name: 'Data & Analytics',      description: 'Data pipelines, warehousing, and BI',       members: ['u19','u20','u21','u22'],                    slackChannel: '#data-team',    owner: 'James Wu',      createdAt: '2024-02-10T00:00:00Z', updatedAt: '2024-03-08T00:00:00Z' },
  { id: 'team-5', name: 'Security',              description: 'Security, compliance, and IAM governance',  members: ['u23','u24','u25'],                          slackChannel: '#security',     owner: 'Leila Hassan',  createdAt: '2024-02-15T00:00:00Z', updatedAt: '2024-03-05T00:00:00Z' },
]

const DEMO_META: Record<string, { services: number; cost: string; alerts: number }> = {
  'team-1': { services: 12, cost: '$4,820/mo',  alerts: 2 },
  'team-2': { services: 31, cost: '$18,340/mo', alerts: 5 },
  'team-3': { services: 8,  cost: '$1,960/mo',  alerts: 0 },
  'team-4': { services: 17, cost: '$9,150/mo',  alerts: 1 },
  'team-5': { services: 6,  cost: '$2,210/mo',  alerts: 3 },
}

export default function TeamsPage() {
  const router = useRouter()
  const demoMode = useDemoMode()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', slackChannel: '', owner: '' })
  const [formError, setFormError] = useState('')

  const { data: teamsData, isLoading } = useQuery({ queryKey: ['teams'], queryFn: teamsService.getAll, enabled: !demoMode })
  const displayTeams = demoMode ? DEMO_TEAMS : (teamsData ?? [])

  const createMutation = useMutation({
    mutationFn: (payload: CreateTeamPayload) => teamsService.create(payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['teams'] }); setShowCreate(false); setForm({ name: '', description: '', slackChannel: '', owner: '' }); setFormError('') },
    onError: () => setFormError('Failed to create team. Please try again.'),
  })

  const deleteMutation = useMutation({
    mutationFn: teamsService.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] }),
  })

  const handleCreate = () => {
    if (!form.name.trim()) { setFormError('Team name is required.'); return }
    if (!form.owner.trim()) { setFormError('Owner is required.'); return }
    createMutation.mutate({ name: form.name.trim(), description: form.description.trim() || undefined, slackChannel: form.slackChannel.trim() || undefined, owner: form.owner.trim() })
  }

  const closeModal = () => { setShowCreate(false); setFormError(''); setForm({ name: '', description: '', slackChannel: '', owner: '' }) }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">Teams &amp; Ownership</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Assign responsibility across services, costs, and infrastructure across your organization.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold border-none cursor-pointer shadow-sm shadow-violet-200 transition-colors whitespace-nowrap self-start">
          <Plus size={14} />{displayTeams.length === 0 ? 'Create Your First Team' : 'Create Team'}
        </button>
      </div>

      {/* Loading */}
      {isLoading && !demoMode && (
        <div className="flex flex-col gap-3">
          {[...Array(3)].map((_, i) => <div key={i} className="bg-slate-50 rounded-xl h-14 border border-slate-100 animate-pulse" />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && displayTeams.length === 0 && (
        <>
          <div className="bg-violet-50 border border-violet-200 border-l-[4px] border-l-violet-600 rounded-xl px-4 py-3.5 mb-6 flex items-start gap-3">
            <span className="text-lg shrink-0">✦</span>
            <div>
              <div className="text-sm font-semibold text-violet-900 mb-0.5">Teams unlock cost attribution and ownership clarity</div>
              <div className="text-xs text-violet-700 leading-relaxed">Platforms without team ownership spend 3× longer resolving incidents and have 40% higher unattributed cloud spend. Create teams to map services, costs, and alerts to the right groups.</div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-14 text-center max-w-lg mx-auto">
            <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center mx-auto mb-5"><Users size={24} className="text-violet-700" /></div>
            <h2 className="text-lg font-bold text-slate-900 mb-2.5">No teams yet</h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-7">Create your first team to start attributing services, costs, and alerts to the right groups.</p>
            <div className="text-left mb-7 flex flex-col gap-2.5">
              {['Map cloud services and infrastructure to owning teams', 'Track monthly cost per team with automatic attribution', 'Route alerts and incidents to the right on-call group', 'Measure team-level compliance posture and risk score'].map(item => (
                <div key={item} className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-violet-600 shrink-0 mt-1.5" />
                  <span className="text-sm text-slate-600 leading-relaxed">{item}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-7 py-3 rounded-xl text-sm font-semibold border-none cursor-pointer transition-colors">
              <Plus size={14} /> Create Your First Team
            </button>
          </div>
        </>
      )}

      {/* Teams table */}
      {displayTeams.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <div className="grid px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-widest min-w-[700px]"
              style={{ gridTemplateColumns: '2fr 80px 80px 120px 110px 140px 80px', gap: '16px' }}>
              {['Team', 'Members', 'Services', 'Monthly Cost', 'Active Alerts', 'Owner', 'Actions'].map(col => <div key={col}>{col}</div>)}
            </div>
            {displayTeams.map((team, idx) => {
              const meta = DEMO_META[team.id]
              const memberCount = (team.members ?? []).length
              const services = demoMode && meta ? meta.services : null
              const cost = demoMode && meta ? meta.cost : null
              const alerts = demoMode && meta ? meta.alerts : null
              const initials = (team.name ?? '?').split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
              return (
                <div key={team.id}
                  className={`grid px-5 py-4 items-center hover:bg-slate-50 transition-colors min-w-[700px] ${idx < displayTeams.length - 1 ? 'border-b border-slate-50' : ''}`}
                  style={{ gridTemplateColumns: '2fr 80px 80px 120px 110px 140px 80px', gap: '16px' }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center text-xs font-bold text-violet-700 shrink-0">{initials}</div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{team.name}</div>
                      {team.description && <div className="text-[11px] text-slate-400 truncate mt-0.5">{team.description}</div>}
                    </div>
                  </div>
                  <div className={`text-sm font-medium ${memberCount === 0 ? 'text-slate-300' : 'text-slate-900'}`}>{memberCount === 0 ? '—' : memberCount}</div>
                  <div className={`text-sm font-medium ${services === null ? 'text-slate-300' : 'text-slate-900'}`}>{services === null ? '—' : services}</div>
                  <div className={`text-sm font-semibold ${cost === null ? 'text-slate-300' : 'text-slate-900'}`}>{cost === null ? '—' : cost}</div>
                  <div className="flex items-center gap-1.5">
                    {alerts === null ? <span className="text-sm text-slate-300">—</span>
                      : alerts === 0 ? <span className="text-sm text-slate-300">0</span>
                      : <><AlertTriangle size={12} style={{ color: alerts >= 3 ? '#DC2626' : '#D97706' }} /><span className="text-sm font-semibold" style={{ color: alerts >= 3 ? '#DC2626' : '#D97706' }}>{alerts}</span></>}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{team.owner || <span className="text-slate-300">—</span>}</div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => router.push('/teams')} className="bg-transparent border-none text-xs font-semibold text-violet-600 cursor-pointer p-0 hover:text-violet-800 transition-colors whitespace-nowrap">View →</button>
                    {!demoMode && (
                      <button onClick={() => deleteMutation.mutate(team.id)} className="bg-transparent border-none cursor-pointer text-slate-200 p-1 rounded-lg flex items-center hover:text-red-600 transition-colors"><Trash2 size={12} /></button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden flex flex-col divide-y divide-slate-50">
            {displayTeams.map(team => {
              const meta = DEMO_META[team.id]
              const memberCount = (team.members ?? []).length
              const alerts = demoMode && meta ? meta.alerts : null
              const cost = demoMode && meta ? meta.cost : null
              const initials = (team.name ?? '?').split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
              return (
                <div key={team.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 bg-violet-50 rounded-xl flex items-center justify-center text-xs font-bold text-violet-700 shrink-0">{initials}</div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">{team.name}</div>
                        {team.description && <div className="text-[11px] text-slate-400 truncate">{team.description}</div>}
                      </div>
                    </div>
                    <button onClick={() => router.push('/teams')} className="bg-transparent border-none text-xs font-semibold text-violet-600 cursor-pointer shrink-0">View →</button>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 pl-11">
                    <span>{memberCount} members</span>
                    {cost && <span className="font-semibold text-slate-600">{cost}</span>}
                    {alerts !== null && alerts > 0 && <span style={{ color: alerts >= 3 ? '#DC2626' : '#D97706' }} className="font-semibold flex items-center gap-1"><AlertTriangle size={10} />{alerts} alert{alerts !== 1 ? 's' : ''}</span>}
                    {team.owner && <span>{team.owner}</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center gap-2">
            {displayTeams.some(t => t.slackChannel) && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400"><Slack size={11} /> Slack channels linked</div>
            )}
            <span className="text-xs text-slate-400 ml-auto">{displayTeams.length} team{displayTeams.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      {/* Create Team Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 px-4 sm:items-center items-end">
          <div className="bg-white rounded-2xl p-5 sm:p-8 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-bold text-slate-900">Create Team</h2>
              <button onClick={closeModal} className="bg-transparent border-none cursor-pointer text-slate-300 hover:text-slate-600 p-1 transition-colors"><X size={17} /></button>
            </div>
            {([
              { label: 'Team Name', key: 'name' as const, placeholder: 'e.g. Platform Engineering', required: true },
              { label: 'Description', key: 'description' as const, placeholder: 'What does this team own?', required: false },
              { label: 'Owner', key: 'owner' as const, placeholder: 'e.g. user-id or email', required: true },
              { label: 'Slack Channel', key: 'slackChannel' as const, placeholder: 'e.g. #platform-eng', required: false },
            ]).map(({ label, key, placeholder, required }) => (
              <div key={key} className="mb-4">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}{required && <span className="text-red-600 ml-0.5">*</span>}</label>
                <input type="text" value={form[key]} onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); setFormError('') }} placeholder={placeholder}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-xs text-slate-900 bg-slate-50 outline-none focus:border-violet-600 focus:bg-white transition-colors box-border" />
              </div>
            ))}
            {formError && <p className="text-xs text-red-600 mb-4">{formError}</p>}
            <div className="flex gap-2.5 mt-2">
              <button onClick={closeModal} className="flex-1 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={createMutation.isPending}
                className={`flex-1 py-2.5 bg-violet-600 border-none rounded-xl text-xs font-semibold text-white transition-colors ${createMutation.isPending ? 'opacity-70 cursor-not-allowed' : 'hover:bg-violet-700 cursor-pointer'}`}>
                {createMutation.isPending ? 'Creating…' : 'Create Team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}