/// <reference types="vite/client" />

declare module '@fontsource-variable/geist'
declare module '@fontsource-variable/geist-mono'

// The `window.dotden` shape is NOT redeclared here: it is the shared DotdenApi
// contract (the same type the preload bridge is checked against), so any change
// to the underlying foundation result types becomes a renderer compile error.
//
// Referenced via an inline `import()` type so this file stays a global script
// (a top-level `import` would turn it into a module and silently drop the global
// `Window` augmentation along with the ambient `declare module`s above).
interface Window {
  dotden: import('../shared/ipc-api').DotdenApi
}
