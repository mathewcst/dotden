# React 19 + React Compiler wiring on Vite 8 / plugin-react v6

The renderer uses **React 19.2** with **React Compiler 1.0** (`babel-plugin-react-compiler`, pinned to an exact version per the React team's guidance). Because `@vitejs/plugin-react@6` dropped Babel in favour of Oxc, the compiler runs as a **separate Babel pass** rather than through the plugin: `plugins: [react(), babel({ presets: [reactCompilerPreset()] })]` (maintainer-canonical order), via `@rolldown/plugin-babel` + `@babel/core`. The pre-v6 `react({ babel: { plugins: [...] } })` form is **ignored under v6 and emits no compiler output — silently**. ESLint uses `eslint-plugin-react-hooks@7.1.x`, whose `flat.recommended` preset already carries the compiler rules; the standalone `eslint-plugin-react-compiler` is deprecated and must not be installed.

Because this misconfiguration fails silently and we stack it on a beta bundler (ADR 0010) **and** Base UI whose compiler compatibility is unverified by MUI (ADR 0012, `mui/base-ui#809`), the scaffold's `build` step **greps the output bundle for `_c(` cache slots to prove the compiler actually ran**. If it didn't, we learn immediately.

## Consequences

- Fallback if the `@rolldown/plugin-babel` (`0.x`) path misbehaves under Vite 8: switch the renderer to `@vitejs/plugin-react-swc@4.3.1` and run the compiler via its SWC plugin path. (Reverting to electron-vite 5 + Vite 7 instead restores the classic bundled-Babel path.)
