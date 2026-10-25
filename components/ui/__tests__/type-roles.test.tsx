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
