F0 represents a transformative reboot of the visual language for the Factorial
platform. Its core mission is to enhance consistency and coherence across
Factorial's user interface, while ensuring a quick, efficient, and delightful
user and developer experience.

## Why F0?

As Factorial has evolved, it has expanded into a complex suite of features and
functionalities, resulting in a fragmented user experience. Various sections of
the platform display inconsistent visual styles and interactions.

This fragmentation complicates maintenance and scalability of both our user
experience and codebase. We often find ourselves dedicating excessive time to
reinventing the wheel and resolving bugs and inconsistencies instead of
enhancing our product, and our users are left with a confusing, disjointed
experience.

## Why Reboot Our Design System?

Our existing design system, known as "Gamma," was established on informal
constraints that have not withstood the test of time. Despite adding new
components and styles, the underlying foundations have weakened to the point
they have mostly become useless.

After thorough evaluation, we've decided that a fresh start is essential. We
need to distinctly separate our old design rules from the new, establishing a
foundation that supports future growth.

Here are several benefits of rebooting our design system:

- **Clear Vision**: A design system thrives on constraints. Previously, as we
  added components and styles without a clear direction, complexity grew,
  leading to a system that was difficult to use effectively.
- **Fully Responsive**: We aim to provide abstractions that facilitate the
  creation of responsive interfaces across all devices, complementing our mobile
  application and ensuring consistency.
- **Usability for External Developers**: With well-documented and easy-to-use
  components, external developers can potentially seamlessly integrate with our
  look and feel and build upon the Factorial ecosystem.
- **Accessibility**: Ensuring that our platform is accessible to everyone,
  regardless of their abilities, is a priority. This means focusing on the
  accessibility of our components.
- **Robustness**: Our goal is to make every interaction with F0 exceptional.
  This includes comprehensive testing of components to maintain consistency and
  coherence.

## Principles

- **Consistency**: With Factorial's vast features, a consistent visual language
  is key to helping users navigate and leverage their experiences across the
  platform.
- **Efficiency**: Designed for efficiency, F0 aids users in completing tasks
  swiftly and seamlessly.
- **Enjoyability**: We aim for users to enjoy their interaction with Factorial.
  A visually appealing and coherent experience is central to F0.

## Technical Choices

F0 is crafted using leading technologies:

- **React**: This design system is built on React, the leading JavaScript
  library for building user interfaces.
- **TypeScript**: Utilized for robust, maintainable code and enhanced developer
  experience with amazing developer tooling.
- **Tailwind**: Our choice for a utility-first CSS framework, promoting quick,
  consistent UI development.
- **Shadcn** and **Radix** for a powerful and accessible baseline for our
  components.

# How to Use F0?

To integrate F0, install it as a dependency:

$ pnpm install @factorialco/f0-react

Import its styles in your application (typically in main.tsx or similar):

```tsx
import "@factorialco/f0-react/dist/styles.css";
```

You can then utilize any of its components:

```tsx
import { Button } from "@factorialco/f0-react";
```

## Installing via the shadcn registry

F0 publishes a [shadcn registry](https://ui.shadcn.com/docs/registry/getting-started)
at `https://one.factorial.dev/r/{name}.json`. It exists to make the two things
that are fiddly by hand — theme wiring and provider setup — a single command,
and to make the catalogue discoverable to the shadcn CLI and MCP server.

Register the namespace once, in your `components.json`:

```json
{
  "registries": {
    "@f0": "https://one.factorial.dev/r/{name}.json"
  }
}
```

Then add any component. The theme and provider come along transitively, so one
command is enough:

```bash
pnpm dlx shadcn@latest add @f0/f0-button
```

### What you actually get

`@f0/theme`, `@f0/utils` and `@f0/provider` install real source you own and are
meant to edit.

Component items do **not** vendor F0 source. Each installs a small local module
that re-exports from `@factorialco/f0-react` and adds the package as a
dependency. This is deliberate: `F0Button` alone reaches into `@/ui/Action`,
`@/components/F0Icon` (and the whole icon catalogue), `@/lib/emojis` and more —
copying that transitive closure would hand you a fork of the library that stops
tracking upstream on the next release. The local module gives you a seam to wrap
and extend without ejecting.

If you only want components and are happy wiring the theme yourself, plain
`pnpm install @factorialco/f0-react` remains fully supported and equivalent.

### The peer dependency set

`@factorialco/f0-react` declares 45 peerDependencies and marks none of them
optional, and its entry point is a single barrel that re-exports the whole
library. Importing `F0Button` therefore still pulls a chunk graph reaching
`@livekit/components-react`, `pdfjs-dist` and `@xyflow/react`. Installing only
the package resolves fine and then fails at bundle time with
`Failed to resolve import`.

The `@f0/theme` item declares that whole set, and every other item depends on
`theme`, so a single `shadcn add` installs a tree that actually bundles.

Two peers are deliberately withheld:

- **`react` / `react-dom`** — your app owns the React version.
- **`tailwindcss`** — f0 peers `^3.4.3`, so declaring it would _downgrade_ a
  Tailwind v4 consumer (measured: 4.3.3 → 3.4.19, breaking their CSS build).

### Tailwind v3 and v4

The stylesheet and the preset are independent, and both work on either version.

`f0.css` is pre-compiled CSS carrying every component style and token custom
property. It is Tailwind-version-agnostic — import it and F0 renders.

The preset only matters if you want _your own_ markup to use F0 tokens:

```ts
// tailwind.config.ts — spread at the TOP LEVEL, not inside `theme.extend`.
// F0 replaces the Tailwind palette rather than extending it.
import { f0Preset } from "./f0-preset";
export default { ...f0Preset, content: ["./app/**/*.tsx"] };
```

On **v3** that config is picked up as usual. On **v4** load it from CSS through
the v3-compat layer:

```css
@import "tailwindcss";
@config "../tailwind.config.ts";
```

Verified on Tailwind 4.3.3: `bg-f1-background` compiles to
`background-color: hsl(var(--neutral-0))`.

One caveat that applies to both versions: the raw palette (`bg-flubber-50`)
emits bare HSL channels with no `hsl()` wrapper, so it is not usable as a
utility. Those tokens exist to be resolved through `theme()` in `base.css`. Use
the semantic `f1-*` colours.

### React 19

F0 peers `react` at exactly `18.3.1`, so npm/pnpm will refuse the install on a
React 19 app without `legacy-peer-deps` or an override. That pin is the only
blocker found — with it bypassed, F0 typechecks against React 19 types and
renders correctly (verified on React 19.2.8 with `F0Button`, `F0Alert` and
`F0Select`). Loosening the peer range to `^18 || ^19` would remove the friction.

### Regenerating the registry

`registry.json`, the per-component wrappers and the served JSON are all derived
from the TypeScript API surface of `src/f0.ts` and `src/experimental.ts` — never
edited by hand:

```bash
pnpm run registry:build
```

CI runs this before `build-storybook`, so the registry deploys alongside the
docs site. See `scripts/build-registry.ts`.

Note that the generator reads the **working tree**, while consumers install the
**published** package. On `main` those track each other closely, but a stale
checkout can emit a wrapper re-exporting a name a later release removed. If a
consumer hits `has no exported member`, regenerate from an up-to-date `main`.
