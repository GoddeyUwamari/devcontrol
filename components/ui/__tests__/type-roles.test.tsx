/**
 * The shared components in components/ui are on the app type scale (typography plan T2b): each one sets a role
 * size (text-ui, text-meta, text-label, ...) and an explicit weight class, so a caller that overrides only the
 * size (className="text-xs") keeps the component's weight, and a caller's size still wins through cn().
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../button'

const classes = (el: Element) => el.className.split(/\s+/)

describe('Button', () => {
  it('sets the ui role and an explicit weight on the base and default size', () => {
    render(<Button>Save</Button>)
    expect(classes(screen.getByRole('button', { name: 'Save' }))).toEqual(expect.arrayContaining(['text-ui', 'font-semibold']))
  })

  it('sm is the meta role (13 px), lg the body role (15 px), xl the section role', () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button size="xl">Extra</Button>
      </>
    )
    const sm = classes(screen.getByRole('button', { name: 'Small' }))
    expect(sm).toContain('text-meta')
    expect(sm).not.toContain('text-ui')
    expect(sm).not.toContain('text-xs')
    const lg = classes(screen.getByRole('button', { name: 'Large' }))
    expect(lg).toContain('text-body')
    expect(lg).not.toContain('text-base')
    expect(classes(screen.getByRole('button', { name: 'Extra' }))).toContain('text-section')
    for (const name of ['Small', 'Large', 'Extra']) expect(classes(screen.getByRole('button', { name }))).toContain('font-semibold')
  })

  it("keeps the role size next to a variant's text colour, and lets a caller's size win", () => {
    render(
      <>
        <Button variant="destructive">Delete</Button>
        <Button className="text-label">Tiny</Button>
      </>
    )
    expect(classes(screen.getByRole('button', { name: 'Delete' }))).toEqual(expect.arrayContaining(['text-ui', 'text-white']))
    const tiny = classes(screen.getByRole('button', { name: 'Tiny' }))
    expect(tiny).toContain('text-label')
    expect(tiny).not.toContain('text-ui')
    expect(tiny).toContain('font-semibold')
  })
})
