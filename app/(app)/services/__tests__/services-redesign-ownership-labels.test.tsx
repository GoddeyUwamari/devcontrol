/**
 * In-app polish (founder rulings 2026-11-24): the redesign's ownership labels, component by
 * component, beside the legacy page's (redesign off), which must not change. The redesign
 * fixture has no Team-tag-only rows, so "Team tag only" is pinned here.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import type { AWSService, AWSServicesStats } from '@/lib/services/aws-services.service'
import { Details, OwnerCell } from '../AttentionTable'
import { UnownedCard } from '../UnownedCard'
import { unknownTagsText } from '../notChecked'
import { NO_OWNER_TAG_LABEL, TEAM_TAG_ONLY_LABEL } from '../ownership'

const row = (o: Partial<AWSService>): AWSService => ({
  id: 'r1', name: 'res-1', type: 'ec2', status: 'healthy', aws_region: 'us-east-1', environment: null,
  owner: null, team: null, ownership: 'owned', needs_attention: false, priority_severity: null, reason: null,
  last_seen_at: null, attention_cause: null, ...o,
} as unknown as AWSService)
const unowned = row({ ownership: 'unowned' })
const teamOnly = row({ ownership: 'owned', team: 'data' })

const stats = (n: number) => ({ ownership: { owned: 5, unowned: n, unknown: 0 }, teams: { top: [{ team: 'platform', count: 5 }], all: [{ team: 'platform', count: 5 }], total_teams: 1 } }) as unknown as AWSServicesStats

function detailsField(term: string): string | null {
  const dt = screen.getAllByRole('term').find((el) => el.textContent === term)!
  return dt.nextElementSibling!.textContent
}

describe('labels', () => {
  it("are the founder's words", () => {
    expect(NO_OWNER_TAG_LABEL).toBe('No owner tag')
    expect(TEAM_TAG_ONLY_LABEL).toBe('Team tag only')
  })
})

describe('OwnerCell', () => {
  it.each([
    [true, true, 'No owner tag', 'Team tag only · data'],
    [true, false, 'No owner tag', 'Team tag only'],
    [false, true, 'Unowned', 'No Owner tag · data'],
    [false, false, 'Unowned', 'No Owner tag'],
  ])('redesign %s, withTeam %s: %j and %j', (redesign, withTeam, unownedText, teamOnlyText) => {
    const { container, unmount } = render(<OwnerCell row={unowned} withTeam={withTeam} redesign={redesign} />)
    expect(container.textContent).toBe(unownedText)
    expect(container.firstElementChild).toHaveClass('bg-orange-50', 'text-orange-900')
    unmount()
    const team = render(<OwnerCell row={teamOnly} withTeam={withTeam} redesign={redesign} />)
    expect(team.container.textContent).toBe(teamOnlyText)
  })

  it('an owner with a team is the same either way', () => {
    const owned = row({ owner: 'owner-a@example.com', team: 'data' })
    expect(render(<OwnerCell row={owned} redesign />).container.textContent).toBe('owner-a@example.com · data')
  })
})

describe('Details', () => {
  it.each([
    [true, 'No owner tag', 'No owner tag', 'Team tag only'],
    [false, 'Unowned', 'Unowned', 'No Owner tag'],
  ])('redesign %s: Owner %j, Ownership %j; team-only Owner %j', (redesign, owner, ownership, teamOnlyOwner) => {
    const { unmount } = render(<Details row={unowned} redesign={redesign} />)
    expect(detailsField('Owner')).toBe(owner)
    expect(detailsField('Ownership')).toBe(ownership)
    unmount()
    render(<Details row={teamOnly} redesign={redesign} />)
    expect(detailsField('Owner')).toBe(teamOnlyOwner)
    expect(detailsField('Ownership')).toBe('Owned')
    expect(detailsField('Team')).toBe('data')
  })
})

describe('UnownedCard', () => {
  it.each([
    [true, 3, '3 resources have no owner tag', 'No owner tag'],
    [true, 1, '1 resource has no owner tag', 'No owner tag'],
    [false, 3, '3 resources are unowned', 'Unowned'],
    [false, 1, '1 resource is unowned', 'Unowned'],
  ])('redesign %s, %i: heading %j, bar %j; the explanation and Show the N unchanged', (redesign, n, heading, bar) => {
    let shown = 0
    render(<UnownedCard stats={stats(n)} redesign={redesign} onShowUnowned={() => { shown++ }} />)
    const card = screen.getByRole('heading', { level: 2 }).closest('section')!
    expect(screen.getByRole('heading', { level: 2 }).textContent?.replace(/\s+/g, ' ').trim()).toBe(heading)
    expect(card).toHaveTextContent('They have neither an Owner nor a Team tag, so nobody is on the hook for them. A resource with only a Team tag counts as owned by that team.')
    const bars = within(screen.getByRole('list', { name: 'Resources per team' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(bars).toEqual(['platform5', `${bar}${n}`])
    fireEvent.click(screen.getByRole('button', { name: `Show the ${n}` }))
    expect(shown).toBe(1)
  })
})

describe('unknownTagsText', () => {
  it('the redesign names the label in quotes; the default (legacy page, Infrastructure) is unchanged', () => {
    expect(unknownTagsText(1, undefined, true)).toBe("1 resource: tags couldn't be read, so its owner is unknown, not missing. It is not counted under \"No owner tag\".")
    expect(unknownTagsText(5, { cloudfront: 5 }, true)).toBe("5 resources: tags couldn't be read, so their owner is unknown, not missing. They are not counted under \"No owner tag\". By type: CloudFront 5.")
    expect(unknownTagsText(1, undefined)).toBe("1 resource: tags couldn't be read, so its owner is unknown, not missing. It is not counted as Unowned.")
    expect(unknownTagsText(5, undefined)).toBe("5 resources: tags couldn't be read, so their owner is unknown, not missing. They are not counted as Unowned.")
  })
})
