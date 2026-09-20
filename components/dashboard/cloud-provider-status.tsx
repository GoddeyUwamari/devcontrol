type ProviderState = 'connected' | 'not_connected' | 'coming_soon'

interface Provider {
  name: string
  short: string
  state: ProviderState
  tileColor: string
  tileBackground: string
}

/**
 * Communicates DevControl's multi-cloud direction truthfully: AWS reflects
 * the real connection state passed in; GCP and Azure are always
 * "Coming soon" — there is no GCP/Azure backend integration anywhere in
 * this codebase, so this must never read "Connected" for either.
 */
export function CloudProviderStatus({ awsConnected }: { awsConnected: boolean }) {
  const providers: Provider[] = [
    { name: 'AWS', short: 'aws', state: awsConnected ? 'connected' : 'not_connected', tileColor: '#F59E0B', tileBackground: '#FFF7ED' },
    { name: 'Google Cloud', short: 'GCP', state: 'coming_soon', tileColor: '#2563EB', tileBackground: '#EFF6FF' },
    { name: 'Azure', short: 'Azure', state: 'coming_soon', tileColor: '#0EA5E9', tileBackground: '#F0F9FF' },
  ]

  return (
    <div className="flex gap-2.5">
      {providers.map((provider) => (
        <div key={provider.name} className="flex flex-col items-center gap-1" title={provider.state === 'coming_soon' ? `${provider.name} — Coming soon` : `${provider.name} — ${provider.state === 'connected' ? 'Connected' : 'Not connected'}`}>
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center border border-border shrink-0"
            style={{ background: provider.tileBackground }}
          >
            <span className="text-[11px] font-bold" style={{ color: provider.tileColor }}>{provider.short}</span>
          </div>
          {provider.state === 'coming_soon' && (
            <span className="text-[10px] text-[var(--text-secondary)] whitespace-nowrap">Coming soon</span>
          )}
        </div>
      ))}
    </div>
  )
}
