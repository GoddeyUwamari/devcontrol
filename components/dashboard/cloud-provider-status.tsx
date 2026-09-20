import { CheckCircle2 } from 'lucide-react'

type TileVariant = 'connected' | 'unavailable'

interface Provider {
  name: string
  short: string
  variant: TileVariant
}

/**
 * Two reusable visual treatments, not one-off AWS-specific styling --
 * "connected" reuses the app's existing success visual language (same
 * tokens the "AWS Account Connected" hero pill uses); "unavailable" is a
 * flat, muted, grayscale treatment. Both use dark/near-black or
 * --text-secondary label text (never colored text on a pale tint) so
 * contrast holds regardless of which brand color a future provider adds --
 * only the icon and border carry color, which only needs the lower 3:1
 * non-text contrast WCAG requires for meaningful graphics, not the 4.5:1
 * normal-text minimum.
 *
 * Calculated contrast (WCAG relative-luminance formula, light theme):
 *   connected label (--foreground on --bg-success):      ~15.6:1 (AA normal text needs 4.5:1)
 *   connected icon  (--text-success on --bg-success):     ~3.3:1 (AA non-text needs 3:1)
 *   unavailable label/icon (--text-secondary on --surface-1): ~7.2:1
 *   "Coming soon" caption (--text-secondary on page bg):  ~7.6:1
 */
const TILE_VARIANTS: Record<TileVariant, { background: string; border: string; iconColor: string; labelColor: string }> = {
  connected: {
    background: 'var(--bg-success)',
    border: 'var(--border-success)',
    iconColor: 'var(--text-success)',
    labelColor: 'var(--foreground)',
  },
  unavailable: {
    background: 'var(--surface-1)',
    border: 'var(--border)',
    iconColor: 'var(--text-secondary)',
    labelColor: 'var(--text-secondary)',
  },
}

/**
 * Communicates DevControl's multi-cloud direction truthfully: AWS reflects
 * the real connection state passed in; GCP and Azure are always
 * "Coming soon" — there is no GCP/Azure backend integration anywhere in
 * this codebase, so this must never read "Connected" for either.
 */
export function CloudProviderStatus({ awsConnected }: { awsConnected: boolean }) {
  const providers: Provider[] = [
    { name: 'AWS', short: 'AWS', variant: awsConnected ? 'connected' : 'unavailable' },
    { name: 'Google Cloud', short: 'GCP', variant: 'unavailable' },
    { name: 'Azure', short: 'Azure', variant: 'unavailable' },
  ]

  return (
    <div className="flex gap-2.5">
      {providers.map((provider) => {
        const style = TILE_VARIANTS[provider.variant]
        const caption = provider.variant === 'connected' ? 'Connected' : provider.name === 'AWS' ? 'Not connected' : 'Coming soon'
        return (
          <div key={provider.name} className="flex flex-col items-center gap-1" title={`${provider.name} — ${caption}`}>
            <div
              className="w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 border shrink-0"
              style={{ background: style.background, borderColor: style.border }}
            >
              {provider.variant === 'connected' && <CheckCircle2 size={11} style={{ color: style.iconColor }} />}
              <span className="text-[10px] font-bold leading-none" style={{ color: style.labelColor }}>{provider.short}</span>
            </div>
            <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{caption}</span>
          </div>
        )
      })}
    </div>
  )
}
