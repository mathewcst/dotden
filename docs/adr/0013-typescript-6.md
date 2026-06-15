# TypeScript 6 across the monorepo

We adopt **TypeScript 6.0** (pin `^6.0.3`), bumping from 5.9.2. Every gating dependency supports it: typescript-eslint 8.61 (peer `>=4.8.4 <6.1.0`), `@astrojs/check` 0.9.9 (`^5 || ^6`), and Vite (decoupled from `tsc`). **Do not exceed 6.1** until typescript-eslint widens its `<6.1.0` peer cap.

TS 6 is a default-flipping release (`strict`, `target: es2025`, `module: esnext`, `types: []`) and removes legacy options, so the bump runs the experimental **`ts5to6` codemod** and then **pins the changed options explicitly** in each tsconfig so behaviour is intentional — with extra care that the Electron **main** process target/module stay compatible with its bundler. `tsc --noEmit` remains the authoritative `check:types` gate.

## Consequences

- **tsgo / TypeScript 7** (the native Go compiler) is nightly-only (`@typescript/native-preview`) and is **deferred** — at most an optional non-blocking secondary CI job later, never the gate.
- Fallback: if a single workspace breaks on 6.0, pin just that workspace to 5.9 via pnpm; there is no pressure to move since 6.0 is the final JS-based TypeScript line and 5.9 keeps full ecosystem support.
