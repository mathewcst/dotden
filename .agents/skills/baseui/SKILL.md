---
name: baseui
description: Enforces Base UI patterns in shadcn/ui projects. Avoid Radix UI patterns (asChild, etc.) when working with BaseUI primitives.
---

# shadcn/ui + Base UI Guidelines

A guide for using shadcn/ui components when working with Base UI. Prevents LLMs from incorrectly suggesting Radix UI patterns (asChild, etc.).

Ensure the `@base-ui/react` package is installed. If not, install it using the appropriate package manager.

## Slot Pattern

The major difference between Radix UI and Base UI is the slot pattern. Radix UI uses `asChild`, while Base UI uses the `render` prop. Always use `render` prop over `asChild`.

**Rule:** Always use `render` prop instead of `asChild` for ALL trigger/wrapper components.

Applies to: `DialogTrigger`, `AlertDialogTrigger`, `PopoverTrigger`, `DropdownMenuTrigger`, `TooltipTrigger`, `SelectTrigger`, `TabsTrigger`, `AccordionTrigger`, `Button` (when wrapping links), etc.

```tsx
// ❌ INCORRECT
<DialogTrigger asChild>
  <Button variant="outline">Click me</Button>
</DialogTrigger>

// ✅ CORRECT
<DialogTrigger render={<Button variant="outline" />}>
  Click me
</DialogTrigger>

// ✅ ALSO CORRECT
<DialogTrigger render={<Button variant="outline">Click me</Button>} />
```

## Props

Beyond the slot pattern, only the following components have different props. When using these components following the component specific guide.

### Accordion

There's no `type` prop on the `Accordion` component, use the boolean `multiple` prop instead. The `defaultValue` prop is always array based.

1. Single Mode

```tsx
// ❌ INCORRECT
<Accordion type="single" defaultValue="item-1">
  <AccordionItem value="item-1">
    // ...
  </AccordionItem>
</Accordion>

// ✅ CORRECT
<Accordion defaultValue={["item-1"]}>
  <AccordionItem value="item-1">
    // ...
  </AccordionItem>
</Accordion>
```

2. Multi Mode

```tsx
// ❌ INCORRECT
<Accordion type="multiple" defaultValue={["item-1", "item-2"]}>
  <AccordionItem value="item-1">...</AccordionItem>
  <AccordionItem value="item-2">...</AccordionItem>
</Accordion>

// ✅ CORRECT
<Accordion multiple defaultValue={["item-1", "item-2"]}>
  <AccordionItem value="item-1">...</AccordionItem>
  <AccordionItem value="item-2">...</AccordionItem>
</Accordion>
```

### Button (Special Case)

When rendering a Button as a non-button element (like a Link), you must add `nativeButton={false}`.

```tsx
// ❌ INCORRECT - Radix pattern
import Link from 'next/link'

<Button asChild variant="ghost">
  <Link href="/dashboard">Dashboard</Link>
</Button>

// ✅ CORRECT - Base UI pattern
import Link from 'next/link'
<Button render={<Link href="/dashboard" />} variant="ghost" nativeButton={false}>
  Dashboard
</Button>
```

### Select

The `position` prop is replaced with a boolean prop `alignItemWithTrigger` which defaults to true.

```tsx
// ❌ INCORRECT
<SelectContent position="popper">
  // ...
</SelectContent>

// ✅ CORRECT
<SelectContent alignItemWithTrigger={false}>
  // ...
</SelectContent>
```

By default, the `<Select.Value>` component renders the raw `value`.

Passing the `items` prop to `<Select.Root>` instead renders the matching label for the rendered value:

```tsx title="items prop"
const items = [
  { value: null, label: 'Select theme' },
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

<Select.Root items={items}>
  <Select.Value />
</Select.Root>
```
