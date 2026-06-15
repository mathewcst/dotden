import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

function DerivedPreview({ count }: { count: number }) {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    label: `slot ${index + 1}`,
    value: count * (index + 1),
  }))
  const total = rows.reduce((sum, row) => sum + row.value, 0)

  return (
    <div className="border-border bg-card text-card-foreground grid gap-2 rounded-lg border p-4">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="font-mono">{row.value}</span>
        </div>
      ))}
      <div className="border-border mt-2 border-t pt-2 text-right font-mono text-sm">
        total {total}
      </div>
    </div>
  )
}

export function App() {
  const [count, setCount] = useState(1)

  return (
    <main className="bg-background text-foreground min-h-screen p-8">
      <section className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="space-y-3">
          <div className="border-border text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
            <Sparkles className="size-3.5" /> secure electron shell
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">dotden</h1>
          <p className="text-muted-foreground max-w-xl">
            Minimal desktop shell: Electron 42, Vite 8, React 19 compiler, Tailwind v4, shadcn-style
            Base UI components.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => setCount((value) => value + 1)}>Increment compiler probe</Button>
          <span className="text-muted-foreground font-mono text-sm">count={count}</span>
        </div>

        <DerivedPreview count={count} />

        <p className="text-muted-foreground text-xs">
          Preload bridge: Electron {window.dotden.versions.electron} / Node{' '}
          {window.dotden.versions.node} / {window.dotden.platform}
        </p>
      </section>
    </main>
  )
}
