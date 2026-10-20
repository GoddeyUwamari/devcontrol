/** Marks a control or column that is placed but not built until Phase 2. */
export function PhaseTwoTag() {
  return (
    <span className="inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-violet-800 bg-violet-100">
      Phase 2
    </span>
  )
}
