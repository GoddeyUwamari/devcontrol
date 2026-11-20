'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { deploymentsService } from '@/lib/services/deployments.service'
import { useRegisteredServices } from '@/lib/hooks/use-registered-services'
import {
  RECORD_COPY,
  RECORD_REGIONS,
  RECORD_RESULT_LABELS,
  recordErrorMessage,
  recordedMessage,
  type RecordedResult,
} from '@/lib/deployments/record'

const EMPTY_FORM = { serviceId: '', environment: 'production', region: 'us-east-1', version: '', result: '' as '' | RecordedResult }

/**
 * "Record a deployment": the only form that creates deployment rows. It
 * records a deployment that already happened -- DevControl doesn't deploy
 * anything. The service is one of the organization's registered services, and
 * the result (Succeeded / Failed) has no default: the form can't be sent until
 * one is chosen. Who recorded it and when are set by the server.
 */
export function RecordDeploymentModal({
  onClose,
  onRecorded,
  onPlanLimit,
}: {
  onClose: () => void
  /** A record was saved: refresh what shows it. */
  onRecorded: () => void
  /** The plan's monthly limit was reached (402). */
  onPlanLimit: () => void
}) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const { data: services = [], isPending: servicesLoading, isError: servicesFailed } = useRegisteredServices()
  // The confirmation closes the form after 2 s; never after it has gone.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.serviceId) { setError(RECORD_COPY.chooseService); return }
    if (!form.result) { setError(RECORD_COPY.resultHint); return }
    const result = form.result
    const serviceName = services.find(s => s.id === form.serviceId)?.name ?? ''
    setSubmitting(true); setError(null)
    try {
      await deploymentsService.record({
        serviceId:   form.serviceId,
        environment: form.environment,
        region:      form.region,
        status:      result,
        version:     form.version.trim() || undefined,
      })
      setSuccess(recordedMessage(serviceName, form.environment, result))
      setForm(EMPTY_FORM)
      onRecorded()
      closeTimer.current = setTimeout(onClose, 2000)
    } catch (err: any) {
      if (err?.response?.status === 402) onPlanLimit()
      else setError(recordErrorMessage(err))
    } finally { setSubmitting(false) }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-[1000] p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 w-full sm:max-w-lg shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="record-deployment-title" data-testid="record-deployment-modal">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h2 id="record-deployment-title" className="text-section text-slate-900 mb-1">{RECORD_COPY.title}</h2>
            <p className="text-meta text-ink-muted m-0">{RECORD_COPY.description}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="bg-transparent border-none cursor-pointer text-slate-400 hover:text-slate-600 p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        {success ? (
          <div className="p-4 bg-green-50 rounded-xl border border-green-200 text-center" data-testid="record-deployment-success">
            <p className="text-ui font-semibold text-ink-success m-0">{success}</p>
          </div>
        ) : (
          <form method="post" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="record-service" className="block text-label text-slate-700 mb-1.5">{RECORD_COPY.serviceLabel}</label>
              <select
                id="record-service"
                value={form.serviceId}
                onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}
                disabled={servicesLoading || servicesFailed || services.length === 0}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 bg-white outline-none focus:border-violet-500 transition-all disabled:bg-slate-50 disabled:text-ink-muted"
              >
                <option value="" disabled>{servicesLoading ? RECORD_COPY.servicesLoading : RECORD_COPY.servicePlaceholder}</option>
                {services.map(service => (
                  <option key={service.id} value={service.id}>{service.name}</option>
                ))}
              </select>
              {!servicesLoading && servicesFailed && (
                <p className="text-meta text-ink-danger mt-1.5 mb-0">{RECORD_COPY.servicesFailed}</p>
              )}
              {!servicesLoading && !servicesFailed && services.length === 0 && (
                <p className="text-meta text-ink-warning mt-1.5 mb-0" data-testid="record-deployment-no-services">{RECORD_COPY.servicesNone}</p>
              )}
            </div>
            <fieldset className="border-none p-0 m-0 min-w-0">
              <legend className="block text-label text-slate-700 mb-1.5">{RECORD_COPY.resultLabel}</legend>
              <div className="flex gap-2">
                {(['success', 'failed'] as const).map(result => (
                  <label
                    key={result}
                    className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border text-ui cursor-pointer transition-colors ${
                      form.result === result ? 'border-violet-500 bg-violet-50 text-slate-900' : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="record-result"
                      value={result}
                      checked={form.result === result}
                      onChange={() => setForm(f => ({ ...f, result }))}
                      className="accent-violet-600"
                    />
                    {RECORD_RESULT_LABELS[result]}
                  </label>
                ))}
              </div>
              {!form.result && (
                <p className="text-meta text-ink-muted mt-1.5 mb-0" data-testid="record-deployment-result-hint">{RECORD_COPY.resultHint}</p>
              )}
            </fieldset>
            <div>
              <label htmlFor="record-environment" className="block text-label text-slate-700 mb-1.5">Environment</label>
              <select
                id="record-environment"
                value={form.environment}
                onChange={e => setForm(f => ({ ...f, environment: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 bg-white outline-none focus:border-violet-500 transition-all"
              >
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
              </select>
            </div>
            <div>
              <label htmlFor="record-region" className="block text-label text-slate-700 mb-1.5">Region</label>
              <select
                id="record-region"
                value={form.region}
                onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 bg-white outline-none focus:border-violet-500 transition-all"
              >
                {RECORD_REGIONS.map(region => (
                  <option key={region.value} value={region.value}>{region.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="record-version" className="block text-label text-slate-700 mb-1.5">
                Version <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <input
                id="record-version"
                type="text"
                value={form.version}
                onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                placeholder="e.g. v2.4.1, main@a1b2c3d"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 transition-all"
              />
            </div>
            <p className="text-meta text-ink-muted m-0">{RECORD_COPY.timeNote}</p>
            {error && (
              <div className="px-3.5 py-2.5 bg-red-50 rounded-lg border border-red-100" role="alert" data-testid="record-deployment-error">
                <p className="text-meta text-ink-danger m-0">{error}</p>
              </div>
            )}
            <div className="flex gap-3 justify-end pt-1">
              <button type="button" onClick={onClose}
                className="px-5 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-ui font-medium cursor-pointer hover:bg-slate-50 transition-colors">
                {RECORD_COPY.cancel}
              </button>
              <button type="submit" disabled={submitting || !form.serviceId || !form.result}
                className={`px-5 py-2.5 rounded-lg text-white text-ui font-semibold border-none inline-flex items-center gap-2 transition-colors ${submitting ? 'bg-violet-400 cursor-default' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer disabled:bg-violet-300 disabled:cursor-not-allowed'}`}>
                {submitting
                  ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> {RECORD_COPY.submitting}</>
                  : RECORD_COPY.submit
                }
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
