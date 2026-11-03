/**
 * The shared scan result banner: tones, accessibility, and that only the Cost
 * Optimization page uses it in PR 2.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ScanStatusBanner, SCAN_BANNER_TONE_CLASSES, type ScanBannerTone } from '../scan-status-banner'

const TONES: ScanBannerTone[] = ['success', 'info', 'findings', 'warning', 'danger', 'neutral']

describe('ScanStatusBanner', () => {
  it.each(TONES)('tone %s uses its own classes', (tone) => {
    render(<ScanStatusBanner tone={tone} title="Title" description="Description" />)
    const banner = screen.getByTestId('scan-status-banner')
    expect(banner).toHaveAttribute('data-tone', tone)
    for (const cls of SCAN_BANNER_TONE_CLASSES[tone].split(' ')) expect(banner).toHaveClass(cls)
  })

  it('tone classes: green only for success, brand violet for findings', () => {
    expect(SCAN_BANNER_TONE_CLASSES.success).toContain('green')
    expect(SCAN_BANNER_TONE_CLASSES.findings).toContain('violet')
    for (const tone of TONES.filter((t) => t !== 'success')) expect(SCAN_BANNER_TONE_CLASSES[tone]).not.toContain('green')
  })

  it('is a named region with a polite, atomic live status', () => {
    render(<ScanStatusBanner tone="info" title="Analysis complete" description="Details" meta="Manual cost analysis, 5 minutes ago" />)
    expect(screen.getByRole('region', { name: 'Latest analysis' })).toBeInTheDocument()
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    expect(status).not.toHaveAttribute('aria-busy')
    expect(status).toHaveTextContent('Analysis complete')
    expect(status).toHaveTextContent('Details')
    expect(status).toHaveTextContent('Manual cost analysis, 5 minutes ago')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('danger is still polite, never an alert', () => {
    render(<ScanStatusBanner tone="danger" title="Last manual cost analysis failed" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('the same live region stays mounted when the result changes', () => {
    const { rerender } = render(<ScanStatusBanner tone="neutral" title="Analysis in progress" busy />)
    const before = screen.getByRole('status')
    expect(before).toHaveAttribute('aria-busy', 'true')
    rerender(<ScanStatusBanner tone="info" title="Analysis complete" />)
    const after = screen.getByRole('status')
    expect(after).toBe(before)
    expect(after).not.toHaveAttribute('aria-busy')
    rerender(<ScanStatusBanner tone="neutral" title="" loading />)
    expect(screen.getByRole('status')).toBe(before)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })

  it('icons are hidden from assistive technology; the spinner respects reduced motion', () => {
    const { container } = render(<ScanStatusBanner tone="neutral" title="Analysis in progress" busy />)
    const iconWrapper = container.querySelector('[aria-hidden="true"]')
    expect(iconWrapper).not.toBeNull()
    expect(iconWrapper!.querySelector('svg')).toHaveClass('motion-safe:animate-spin')
  })

  it('the action is a real button outside the live region', () => {
    const onClick = vi.fn()
    render(<ScanStatusBanner tone="neutral" title="Couldn't load analysis status" action={{ label: 'Try again', onClick }} />)
    const button = screen.getByRole('button', { name: 'Try again' })
    expect(screen.getByRole('status')).not.toContainElement(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('used only on Cost Optimization in PR 2', () => {
  const root = join(__dirname, '..', '..', '..')
  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) sources(path, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(path)
    }
    return out
  }

  it('no other page or component imports it', () => {
    const importers = ['app', 'components', 'lib']
      .flatMap((dir) => sources(join(root, dir)))
      .filter((file) => /scan-status-banner/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file))
      .filter((file) => file !== join('components', 'ui', 'scan-status-banner.tsx'))
    expect(importers.sort()).toEqual([join('app', '(app)', 'cost-optimization', 'costScanBanner.ts'), join('app', '(app)', 'cost-optimization', 'page.tsx')].sort())
  })
})
