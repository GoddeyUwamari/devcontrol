'use client';

import { ExternalLink } from 'lucide-react';

/**
 * Renders a customer-supplied external_reference as a plain external link. DevControl
 * never fetches, proxies, previews, or validates the referenced content -- this
 * component makes no network request of its own; the browser only navigates when the
 * user explicitly clicks. See backend/src/services/soc2-customer-evidence.service.ts's
 * docblock for the same guarantee stated server-side.
 */
export function Soc2ExternalReferenceLink({ href }: { href: string }) {
  return (
    <div className="flex flex-col gap-1">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-700 break-all"
      >
        <ExternalLink size={13} className="shrink-0" />
        {href}
      </a>
      <p className="text-xs text-slate-400">Externally hosted — not verified by DevControl.</p>
    </div>
  );
}
