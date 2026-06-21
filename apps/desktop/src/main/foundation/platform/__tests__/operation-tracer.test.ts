/**
 * OperationTracer unit tests — the pure observability core (ADR 0007).
 *
 * Asserts the MVP guarantees: one wide event per Operation, ONLY allowlisted
 * attribute keys are representable (the structural privacy boundary), the ring
 * buffer is bounded (oldest evicted), correlation by `traceId`, and durations come
 * from the injected clock. The "only allowlisted keys" property is enforced at the
 * TYPE level — this test documents it and a `// @ts-expect-error` proves a
 * non-allowlisted key is a compile error.
 */
import { describe, expect, it } from 'vitest'
import { currentTraceId, runWithTraceId } from '../../diagnostics/trace-context.js'
import { OperationTracer } from '../operation-tracer.js'

describe('OperationTracer', () => {
  it('emits exactly one wide event per Operation, correlated by traceId', () => {
    const tracer = new OperationTracer()

    const span = tracer.startOperation('commit', 'trace-abc')
    span.setAttribute('fileCount', 2)
    const event = span.end('ok')

    expect(tracer.events()).toHaveLength(1)
    expect(event.traceId).toBe('trace-abc')
    expect(event.kind).toBe('commit')
    expect(event.outcome).toBe('ok')
    expect(event.attributes.fileCount).toBe(2)
  })

  it('records duration from the injected clock', () => {
    let t = 1000
    const tracer = new OperationTracer({ now: () => t })

    const span = tracer.startOperation('apply', 'trace-dur')
    t = 1250
    const event = span.end('ok')

    expect(event.durationMs).toBe(250)
    expect(event.attributes.durationMs).toBe(250)
  })

  it('only allowlisted attribute keys are representable (structural privacy, ADR 0007)', () => {
    const tracer = new OperationTracer()
    const span = tracer.startOperation('sync', 'trace-priv')

    // Allowlisted keys (counts/enums) compile fine.
    span.setAttribute('fileCount', 1)
    span.setAttribute('outcome', 'ok')
    span.setAttribute('automationLevel', 'manual')

    // A path/URL/secret key is NOT representable. The block below never runs (guarded
    // by `false`), but it must still TYPE-CHECK: the `@ts-expect-error` asserts that
    // `setAttribute('filePath', …)` is a compile error — the privacy invariant living
    // in the type system (ADR 0007). If `filePath` ever became allowlisted, the
    // directive would be unused and lint/tsc would fail, catching the regression.
    if (false as boolean) {
      // @ts-expect-error 'filePath' is not an AllowlistedAttributeKey by construction.
      span.setAttribute('filePath', '/home/user/.zshrc')
    }

    const event = span.end('ok')
    // Only allowlisted keys ever land on the event (durationMs is always added).
    expect(Object.keys(event.attributes).sort()).toEqual(
      ['automationLevel', 'durationMs', 'fileCount', 'outcome'].sort(),
    )
  })

  it('bounds the ring buffer, evicting the oldest events', () => {
    const tracer = new OperationTracer({ capacity: 3 })

    for (let i = 0; i < 5; i++) tracer.startOperation('poll', `trace-${i}`).end('ok')

    const ids = tracer.events().map((e) => e.traceId)
    // Only the last 3 survive; the two oldest were evicted.
    expect(ids).toEqual(['trace-2', 'trace-3', 'trace-4'])
  })

  it('events() returns a copy that cannot mutate the internal buffer', () => {
    const tracer = new OperationTracer()
    tracer.startOperation('track', 'trace-copy').end('ok')

    const snapshot = tracer.events() as unknown as unknown[]
    snapshot.push({ tampered: true })

    expect(tracer.events()).toHaveLength(1)
  })

  it('establishes and restores the ambient diagnostics trace context', async () => {
    const tracer = new OperationTracer()

    await runWithTraceId('outer-trace', async () => {
      const span = tracer.startOperation('commit', 'inner-trace')
      expect(currentTraceId()).toBe('inner-trace')
      await Promise.resolve()
      expect(currentTraceId()).toBe('inner-trace')

      span.end('ok')
      expect(currentTraceId()).toBe('outer-trace')
    })

    expect(currentTraceId()).toBeUndefined()
  })
})
