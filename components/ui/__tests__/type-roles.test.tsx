/**
 * The shared components in components/ui are on the app type scale (typography plan T2b): each one sets a role
 * size (text-ui, text-meta, text-label, ...) and an explicit weight class, so a caller that overrides only the
 * size (className="text-xs") keeps the component's weight, and a caller's size still wins through cn().
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../button'
import { useForm } from 'react-hook-form'
import { Input } from '../input'
import { Textarea } from '../textarea'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../select'
import { Label } from '../label'
import { Tabs, TabsList, TabsTrigger } from '../tabs'
import { Form, FormDescription, FormField, FormItem, FormMessage } from '../form'
import { Inbox } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '../card'
import { Badge } from '../badge'
import { SeverityBadge } from '../severity-badge'
import { Alert, AlertDescription, AlertTitle } from '../alert'
import { EmptyState } from '../empty-state'
import { ErrorBadge, ErrorDisplay } from '../error-display'
import { type AppError, ErrorType, getErrorTitle, getRecoverySuggestion } from '@/lib/errors/error-types'

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

describe('form controls', () => {
  it('input, textarea and the select trigger use the ui role (14/20, as before)', () => {
    render(
      <>
        <Input aria-label="Name" />
        <Textarea aria-label="Notes" />
        <Select>
          <SelectTrigger aria-label="Region">
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
        </Select>
      </>
    )
    expect(classes(screen.getByRole('textbox', { name: 'Name' }))).toContain('text-ui')
    expect(classes(screen.getByRole('textbox', { name: 'Notes' }))).toContain('text-ui')
    expect(classes(screen.getByRole('combobox', { name: 'Region' }))).toContain('text-ui')
  })

  it('the select label is the meta role (13 px) and items the ui role', () => {
    render(
      <Select open value="a">
        <SelectTrigger aria-label="Region">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Regions</SelectLabel>
            <SelectItem value="a">us-east-1</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )
    const label = classes(document.querySelector('[data-slot="select-label"]')!)
    expect(label).toContain('text-meta')
    expect(label).not.toContain('text-xs')
    expect(classes(document.querySelector('[data-slot="select-item"]')!)).toContain('text-ui')
  })

  it('label and tab triggers keep the ui role with their explicit weight', () => {
    render(
      <>
        <Label htmlFor="x">Email</Label>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">General</TabsTrigger>
          </TabsList>
        </Tabs>
      </>
    )
    expect(classes(screen.getByText('Email'))).toEqual(expect.arrayContaining(['text-ui', 'font-medium', 'leading-none']))
    expect(classes(screen.getByRole('tab', { name: 'General' }))).toEqual(expect.arrayContaining(['text-ui', 'font-medium']))
  })

  it("a caller's size still wins on a control", () => {
    render(<Input aria-label="Small" className="text-meta" />)
    const small = classes(screen.getByRole('textbox', { name: 'Small' }))
    expect(small).toContain('text-meta')
    expect(small).not.toContain('text-ui')
  })
})

function SampleForm() {
  const form = useForm<{ name: string }>({ defaultValues: { name: '' } })
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="name"
        render={() => (
          <FormItem>
            <FormDescription>Shown to your team.</FormDescription>
            <FormMessage>Required.</FormMessage>
          </FormItem>
        )}
      />
    </Form>
  )
}

describe('form', () => {
  it('description and message use the ui role (14/20, as before)', () => {
    render(<SampleForm />)
    expect(classes(screen.getByText('Shown to your team.'))).toEqual(expect.arrayContaining(['text-ui', 'text-muted-foreground']))
    expect(classes(screen.getByText('Required.'))).toEqual(expect.arrayContaining(['text-ui', 'text-destructive']))
  })
})

describe('Card', () => {
  it('title is the card-title role (15/22) with an explicit weight; description the meta role (13 px)', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Monthly spend</CardTitle>
          <CardDescription>Month to date</CardDescription>
        </CardHeader>
      </Card>
    )
    const title = classes(screen.getByText('Monthly spend'))
    expect(title).toEqual(expect.arrayContaining(['text-card-title', 'font-semibold']))
    expect(title).not.toContain('leading-none')
    const description = classes(screen.getByText('Month to date'))
    expect(description).toEqual(expect.arrayContaining(['text-meta', 'text-muted-foreground']))
    expect(description).not.toContain('text-sm')
  })
})

describe('badges', () => {
  it('Badge is the label role (12 px) at weight 600', () => {
    render(<Badge>Active</Badge>)
    const badge = classes(screen.getByText('Active'))
    expect(badge).toEqual(expect.arrayContaining(['text-label', 'font-semibold']))
    expect(badge).not.toContain('text-xs')
    expect(badge).not.toContain('font-medium')
  })

  it('a Badge with className="text-xs" keeps weight 600', () => {
    render(<Badge className="text-xs">Legacy</Badge>)
    const badge = classes(screen.getByText('Legacy'))
    expect(badge).toContain('text-xs')
    expect(badge).not.toContain('text-label')
    expect(badge).toContain('font-semibold')
  })

  it("keeps the role next to a variant's text colour", () => {
    render(<Badge variant="destructive">Failed</Badge>)
    expect(classes(screen.getByText('Failed'))).toEqual(expect.arrayContaining(['text-label', 'text-white']))
  })

  it('SeverityBadge is the label role at weight 600, beside its severity colour', () => {
    render(<SeverityBadge severity="critical" label="Critical" />)
    const badge = classes(screen.getByText('Critical'))
    expect(badge).toEqual(expect.arrayContaining(['text-label', 'font-semibold', 'text-red-700']))
    expect(badge).not.toContain('font-medium')
  })
})

describe('Alert', () => {
  it('base and description use the ui role; the title keeps weight 500', () => {
    render(
      <Alert>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Something changed.</AlertDescription>
      </Alert>
    )
    expect(classes(screen.getByRole('alert'))).toContain('text-ui')
    expect(classes(screen.getByText('Heads up'))).toContain('font-medium')
    expect(classes(screen.getByText('Something changed.'))).toEqual(expect.arrayContaining(['text-ui', 'text-muted-foreground']))
  })
})

describe('EmptyState', () => {
  it('title is the section role (18/26) and the copy the body role (15 px)', () => {
    render(<EmptyState icon={Inbox} title="No reports yet" description="Reports you schedule appear here." />)
    const title = screen.getByRole('heading', { level: 3, name: 'No reports yet' })
    expect(classes(title)).toEqual(expect.arrayContaining(['text-section', 'font-semibold']))
    const copy = classes(screen.getByText('Reports you schedule appear here.'))
    expect(copy).toEqual(expect.arrayContaining(['text-body', 'text-muted-foreground']))
    expect(copy).not.toContain('text-sm')
  })
})

const appError = (type: ErrorType): AppError => ({ type, message: 'm', userMessage: 'Could not load dependencies.', retryable: false })

describe('ErrorDisplay', () => {
  it('the recovery line is the meta role at full opacity, in a colour that passes AA', () => {
    render(<ErrorDisplay error={appError(ErrorType.SERVER_ERROR)} />)
    const suggestion = classes(screen.getByText(getRecoverySuggestion(ErrorType.SERVER_ERROR)))
    expect(suggestion).toEqual(expect.arrayContaining(['text-meta', 'text-red-700']))
    expect(suggestion.some((c) => c.startsWith('opacity-'))).toBe(false)
    expect(classes(screen.getByText('Could not load dependencies.'))).toEqual(expect.arrayContaining(['text-ui', 'text-red-700']))
  })

  it('the offline sub-text is orange-700, not orange-600', () => {
    render(<ErrorDisplay error={appError(ErrorType.OFFLINE_ERROR)} />)
    const sub = classes(screen.getByText('Could not load dependencies.'))
    expect(sub).toContain('text-orange-700')
    expect(sub).not.toContain('text-orange-600')
  })

  it('the inline variant uses the ui role', () => {
    render(<ErrorDisplay error={appError(ErrorType.SERVER_ERROR)} variant="inline" />)
    expect(classes(screen.getByRole('alert'))).toContain('text-ui')
  })

  it('ErrorBadge uses the meta role', () => {
    render(<ErrorBadge error={appError(ErrorType.NETWORK_ERROR)} />)
    expect(classes(screen.getByText(getErrorTitle(ErrorType.NETWORK_ERROR)).parentElement!)).toContain('text-meta')
  })
})
