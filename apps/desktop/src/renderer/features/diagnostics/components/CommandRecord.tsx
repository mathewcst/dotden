import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { RedactedCommandRecord as RedactedCommandRecordDto } from '@shared/diagnostics'
import { cn } from '@/shared/lib/utils'

const REDACTED_TOKEN = '[REDACTED]'
const OMITTED_RENDERED_OUTPUT = '[rendered output omitted]'

/** One expandable, already-redacted Command record row. */
export function CommandRecord({ record }: { record: RedactedCommandRecordDto }) {
  const [expanded, setExpanded] = useState(record.exitCode !== 0)
  const failed = record.exitCode !== 0
  const commandLine = [record.command, ...record.args].join(' ')

  return (
    <article className="border-border/70 border-b text-xs">
      <button
        type="button"
        className="hover:bg-secondary/70 grid w-full grid-cols-[18px_auto_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight
          className={cn(
            'text-muted-foreground size-3.5 transition-transform',
            expanded && 'rotate-90',
          )}
          aria-hidden
        />
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-[11px] font-medium',
            failed ? 'bg-dd-red-950 text-dd-red-300' : 'bg-dd-green-950 text-dd-green-300',
          )}
        >
          {failed ? `exit ${record.exitCode}` : '0'}
        </span>
        <span className="text-foreground truncate font-mono">{commandLine}</span>
        <span className="text-muted-foreground font-mono">
          {new Date(record.timestamp).toLocaleTimeString()}
        </span>
        {record.traceId ? (
          <span className="bg-secondary text-muted-foreground max-w-32 truncate rounded px-1.5 py-0.5 font-mono text-[11px]">
            {record.traceId}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="grid gap-2 px-9 pb-3">
          <OutputBlock label="stdout" value={record.redactedStdout} />
          <OutputBlock label="stderr" value={record.redactedStderr} />
        </div>
      ) : null}
    </article>
  )
}

function OutputBlock({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <pre className="bg-background/80 border-border/70 overflow-auto rounded border p-2 font-mono text-[11px] leading-5 whitespace-pre-wrap">
      <span className="text-muted-foreground">{label}: </span>
      <RedactedText value={value} />
    </pre>
  )
}

function RedactedText({ value }: { value: string }) {
  if (value === OMITTED_RENDERED_OUTPUT) {
    return <span className="text-dd-ember-400">{OMITTED_RENDERED_OUTPUT}</span>
  }
  const parts = value.split(REDACTED_TOKEN)
  return (
    <>
      {parts.map((part, index) => (
        <span key={`${index}-${part}`}>
          {part}
          {index < parts.length - 1 ? (
            <span className="text-dd-ember-400">{REDACTED_TOKEN}</span>
          ) : null}
        </span>
      ))}
    </>
  )
}
