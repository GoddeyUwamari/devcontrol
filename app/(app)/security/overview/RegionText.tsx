import { Fragment } from 'react'

// An AWS region code: us-east-1, eu-west-2, ap-southeast-1, us-gov-west-1, cn-north-1.
const REGION = /\b[a-z]{2}(?:-gov)?-[a-z]+-\d+\b/g

/** Text with every region code kept on one line ("us-east-1" never breaks at its hyphens); the rest wraps as usual. */
export function RegionText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(REGION)) {
    parts.push(text.slice(last, m.index), <span key={m.index} data-testid="security-region" className="whitespace-nowrap">{m[0]}</span>)
    last = m.index + m[0].length
  }
  parts.push(text.slice(last))
  return <Fragment>{parts}</Fragment>
}
