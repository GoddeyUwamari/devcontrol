import Link from 'next/link'
import { Info } from 'lucide-react'
import type { DateRangeOption, Service, Team } from '@/lib/types'
import { COPY, type SourceInfo } from '../_lib/dora-page'

/** Under the subtitle: where the records come from and when the last one was made (data time, not render time). */
export function SourceLine({ source }: { source: SourceInfo }) {
  if (source.dot === 'none' || !source.text) return null
  // Keep the record time ("Nov 19, 11:55 AM") on one line when the text wraps.
  const cut = source.text.lastIndexOf(' · ')
  const lead = cut >= 0 ? source.text.slice(0, cut + 3) : source.text
  const time = cut >= 0 ? source.text.slice(cut + 3) : null
  return (
    <p className="flex items-start gap-1.5 text-meta text-ink-muted mt-2" data-testid="dora-source-line">
      <span
        aria-hidden="true"
        data-dot={source.dot}
        className={`w-2 h-2 mt-[5px] rounded-full shrink-0 ${source.dot === 'solid' ? 'bg-violet-600' : 'border border-slate-400 bg-white'}`}
      />
      <span>{lead}{time && <span className="whitespace-nowrap">{time}</span>}</span>
    </p>
  )
}

/** No finished deployments and no record at all in the workspace. */
export function NoDataBanner() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 sm:px-5" data-testid="dora-no-data-banner" role="status">
      <Info size={16} className="text-ink-info shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="text-ui font-semibold text-ink">{COPY.bannerTitle}</p>
        <p className="text-meta text-ink-body mt-0.5">{COPY.bannerBody}</p>
        <Link href={COPY.recordHref} className="inline-flex items-center min-h-11 sm:min-h-0 mt-1 text-label text-ink-info no-underline hover:underline">
          {COPY.bannerLink} →
        </Link>
      </div>
    </div>
  )
}

const RANGES: DateRangeOption[] = ['7d', '30d', '90d']
const SELECT = 'w-full sm:w-40 min-h-11 sm:min-h-9 px-2.5 text-ui text-ink bg-white border border-slate-200 rounded-lg cursor-pointer'

interface FiltersProps {
  dateRange: DateRangeOption
  onDateRange: (r: DateRangeOption) => void
  serviceId: string
  onService: (id: string) => void
  teamId: string
  onTeam: (id: string) => void
  services: Service[] | undefined
  teams: Team[] | undefined
}

/** Period tabs and the Service / Team selects. Every section of the page reads the one query these drive. */
export function Filters({ dateRange, onDateRange, serviceId, onService, teamId, onTeam, services, teams }: FiltersProps) {
  return (
    <>
      <div className="grid grid-cols-3 sm:flex bg-slate-50 border border-slate-200 rounded-lg p-0.5 gap-0.5 w-full sm:w-auto" role="group" aria-label="Period">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={dateRange === r}
            onClick={() => onDateRange(r)}
            className={`min-h-11 sm:min-h-8 px-3.5 rounded-md text-label border-none cursor-pointer ${dateRange === r ? 'bg-white text-ink shadow-sm' : 'bg-transparent text-ink-muted'}`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5 text-label text-ink-muted">
          <span className="sm:sr-only">Service</span>
          <select aria-label="Service" value={serviceId} onChange={(e) => onService(e.target.value)} className={SELECT}>
            <option value="all">All services</option>
            {services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5 text-label text-ink-muted">
          <span className="sm:sr-only">Team</span>
          <select aria-label="Team" value={teamId} onChange={(e) => onTeam(e.target.value)} className={SELECT}>
            <option value="all">All teams</option>
            {teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>
    </>
  )
}
