import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

/**
 * The one navigation control on a dashboard card: a small circular arrow at
 * the right edge of the card header. The visible circle is 28px; on touch
 * devices an invisible ::before extends the hit area to 44px. The card
 * itself is not a link.
 */
export function CardArrowLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      data-testid="card-arrow"
      className="relative inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-full border-[0.5px] border-border no-underline transition-colors hover:bg-[var(--bg-accent)] focus-visible:bg-[var(--bg-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-accent)] before:absolute before:content-[''] before:-inset-1 pointer-coarse:before:-inset-2"
    >
      <ArrowRight size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--text-accent)' }} />
    </Link>
  )
}
