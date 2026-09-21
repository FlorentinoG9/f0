/**
 * shadcn registry generator for F0.
 * =================================
 *
 * Emits `registry/registry.json` plus one wrapper file per component under
 * `registry/f0/components/`, so `shadcn build` can flatten them into
 * `public/r/*.json` — served from https://one.factorial.dev/r/{name}.json by
 * the existing Storybook deploy.
 *
 * ## Why wrappers and not vendored source
 *
 * A shadcn registry normally copies component source into the consumer's repo.
 * F0 cannot do that for its `F0*` components: `F0Button` alone reaches
 * `@/ui/Action`, `@/ui/Counter`, `@/components/F0Icon` (and with it the whole
 * icon catalogue), `@/lib/emojis`, `@/lib/text`, `@/lib/OneEllipsis` and
 * `@/lib/data-testid`. Vendoring that transitive closure hands the consumer a
 * fork of the library, not a component, and it desynchronises the moment
 * `@factorialco/f0-react` publishes.
 *
 * So each component item installs a one-line local module that re-exports the
 * real symbols from the npm package, and declares `@factorialco/f0-react` as a
 * dependency. What the consumer actually gains from the registry is the part
 * that is genuinely hard to get right by hand: the theme, the Tailwind preset
 * and the provider wiring are installed, correctly configured, in one command —
 * and the catalogue becomes discoverable to the shadcn CLI and MCP server.
 *
 * The exception is `registry/f0/theme` and `registry/f0/lib`, which are real
 * hand-authored source: those files are meant to be owned and edited.
 *
 * ## Export map
 *
 * The symbol list per component is read from the TypeScript program rooted at
 * the published entry points (`src/f0.ts`, `src/experimental.ts`), not from
 * regexing barrels — so a wrapper can never re-export a name that the package
 * does not actually ship.
 *
 * Usage: `pnpm run registry:build`
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import consola from "consola"
import ts from "typescript"
import { computeComponentStatusData } from "./component-status-build.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, "..")
const SRC = join(PKG_ROOT, "src")
const REGISTRY_DIR = join(PKG_ROOT, "registry")
const WRAPPERS_DIR = join(REGISTRY_DIR, "f0", "components")

const HOMEPAGE = "https://one.factorial.dev"
/**
 * `shadcn build` resolves `files[].path` from its working directory (the
 * package root), not from the directory holding registry.json — so every path
 * is written with this prefix.
 */
const PATH_PREFIX = "registry"
const NAMESPACE = "@f0"

/** Entry points whose exports are part of the published API surface. */
const ENTRY_POINTS = [
  { file: join(SRC, "f0.ts"), experimental: false },
  { file: join(SRC, "experimental.ts"), experimental: true },
]

/**
 * Zones that never become registry items. `lib` and `hooks` are covered by the
 * hand-authored foundation items; the rest are either build artefacts
 * (`icons`, `flags`), internal plumbing, or explicitly on the way out.
 */
const EXCLUDED_ZONES = new Set([
  "component-status",
  "deprecated",
  "examples",
  "flags",
  "icons",
  "lib",
  "mocks",
  "testing",
])

/** shadcn item type per F0 zone. */
const TYPE_BY_ZONE: Record<string, string> = {
  ui: "registry:ui",
  components: "registry:ui",
  patterns: "registry:block",
  kits: "registry:block",
  sds: "registry:block",
  layouts: "registry:block",
  experimental: "registry:block",
  hooks: "registry:hook",
}

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

interface ExportedSymbol {
  name: string
  /** Re-export with `export type` rather than `export`. */
  typeOnly: boolean
}

interface ComponentGroup {
  zone: string
  /** Directory (or bare file) name inside the zone, e.g. `F0Button`, `badge`. */
  dir: string
  /** Full path of that directory relative to `src`, POSIX-separated. */
  path: string
  symbols: Map<string, ExportedSymbol>
  experimental: boolean
}

/**
 * A symbol is type-only when every one of its declarations is a type
 * declaration. `const`-plus-`interface` pairs (a component and its props
 * merged under one name) stay value re-exports so both halves survive.
 */
function isTypeOnly(symbol: ts.Symbol): boolean {
  const decls = symbol.getDeclarations()
  if (!decls || decls.length === 0) {
    return false
  }
  return decls.every(
    (d) =>
      ts.isInterfaceDeclaration(d) ||
      ts.isTypeAliasDeclaration(d) ||
      ts.isTypeParameterDeclaration(d)
  )
}

/**
 * Resolve a declaring file to the component that owns it.
 *
 * `knownDirs` holds every directory that owns a Storybook story, taken from the
 * component-status scan — so `components/avatars/F0Avatar/types.ts` resolves to
 * `F0Avatar`, not to the `avatars` grouping folder. Walking up and taking the
 * DEEPEST match is what keeps grouping folders (`avatars`, `experimental/Lists`,
 * `patterns/forms`) from collapsing a dozen components into one item.
 *
 * Files with no story above them fall back to the first path segment pair,
 * which covers exports like hooks; barrels are rejected outright.
 */
function locate(
  fileName: string,
  knownDirs: Set<string>
): { zone: string; dir: string; path: string } | null {
  const rel = relative(SRC, fileName)
  if (rel.startsWith("..")) {
    return null
  } // outside src — a dependency, not ours
  const parts = rel.split(sep)
  if (parts.length < 2) {
    return null
  } // a bare `src/*.ts` barrel
  const zone = parts[0]
  if (EXCLUDED_ZONES.has(zone)) {
    return null
  }

  for (let depth = parts.length - 1; depth >= 2; depth--) {
    const candidate = parts.slice(0, depth).join("/")
    if (knownDirs.has(candidate)) {
      return { zone, dir: parts[depth - 1], path: candidate }
    }
  }

  // `ui/badge.tsx` is a single-file primitive; `ui/Avatar/index.ts` is a folder.
  const dir =
    parts.length === 2 ? parts[1].replace(/\.(tsx?|mts|cts)$/, "") : parts[1]
  // A barrel is a re-export hub, not a component.
  if (dir === "exports" || dir === "index") {
    return null
  }
  const path = `${zone}/${dir}`
  // A folder that *contains* components (`components/dialog-alike`,
  // `experimental/Forms`) is a grouping folder. Its children already have their
  // own items; emitting one for the parent too would ship an item that bundles
  // a dozen unrelated components under one name.
  for (const known of knownDirs) {
    if (known.startsWith(`${path}/`)) {
      return null
    }
  }
  return { zone, dir, path }
}

function collectExports(knownDirs: Set<string>): Map<string, ComponentGroup> {
  const program = ts.createProgram(
    ENTRY_POINTS.map((e) => e.file),
    {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      noEmit: true,
      skipLibCheck: true,
      baseUrl: PKG_ROOT,
      paths: { "@/*": ["src/*"] },
    }
  )
  const checker = program.getTypeChecker()
  const groups = new Map<string, ComponentGroup>()

  for (const entry of ENTRY_POINTS) {
    const source = program.getSourceFile(entry.file)
    if (!source) {
      throw new Error(`Entry point not found: ${entry.file}`)
    }
    const moduleSymbol = checker.getSymbolAtLocation(source)
    if (!moduleSymbol) {
      throw new Error(`No module symbol for ${entry.file}`)
    }

    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      // SymbolFlags is a bitfield, so membership is a masked comparison.
      const isAlias = (exported.flags & ts.SymbolFlags.Alias) !== 0
      const target = isAlias ? checker.getAliasedSymbol(exported) : exported
      const decl = target.getDeclarations()?.[0]
      if (!decl) {
        continue
      }
      const at = locate(decl.getSourceFile().fileName, knownDirs)
      if (!at) {
        continue
      }

      const key = at.path
      let group = groups.get(key)
      if (!group) {
        group = { ...at, symbols: new Map(), experimental: entry.experimental }
        groups.set(key, group)
      }
      // A name reachable from both entry points is not experimental.
      if (!entry.experimental) {
        group.experimental = false
      }
      group.symbols.set(exported.getName(), {
        name: exported.getName(),
        typeOnly: isTypeOnly(target),
      })
    }
  }
  return groups
}

// ---------------------------------------------------------------------------
// Item construction
// ---------------------------------------------------------------------------

/** `F0Button` -> `f0-button`, `OneCalendar` -> `one-calendar`, `badge` -> `badge`. */
function toItemName(dir: string): string {
  return dir
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
}

function wrapperSource(group: ComponentGroup, entry: string): string {
  const values = [...group.symbols.values()]
    .filter((s) => !s.typeOnly)
    .map((s) => s.name)
    .sort()
  const types = [...group.symbols.values()]
    .filter((s) => s.typeOnly)
    .map((s) => s.name)
    .sort()

  const lines = [
    `// Generated by scripts/build-registry.ts — do not edit by hand.`,
    `//`,
    `// Re-exported from the published package rather than vendored: ${group.dir}`,
    `// depends on F0 internals that only make sense inside the library. Extend it`,
    `// by wrapping the re-exports below, and it will keep tracking upstream.`,
    ``,
  ]
  if (values.length > 0) {
    lines.push(`export { ${values.join(", ")} } from "${entry}"`)
  }
  if (types.length > 0) {
    lines.push(`export type { ${types.join(", ")} } from "${entry}"`)
  }
  return lines.join("\n") + "\n"
}

interface RegistryFile {
  path: string
  type: string
  target?: string
}

interface RegistryItem {
  name: string
  type: string
  title: string
  description: string
  files: RegistryFile[]
  dependencies?: string[]
  registryDependencies?: string[]
  categories?: string[]
  docs?: string
  meta?: Record<string, unknown>
}

const PKG = "@factorialco/f0-react"

/**
 * Peers the consumer must install alongside the package.
 *
 * `@factorialco/f0-react` declares 45 peerDependencies and marks none of them
 * optional, and its published entry point is one barrel that re-exports the
 * whole library — so importing `F0Button` still pulls the chunk graph that
 * reaches `@livekit/components-react`, `pdfjs-dist`, `@xyflow/react` and the
 * rest. Declaring only the package produces an install that resolves and then
 * fails at bundle time with "Failed to resolve import". Verified against a
 * clean consumer: without these, the very first render throws.
 *
 * Deliberately withheld:
 *  - `react` / `react-dom`  — the consumer's app owns the React version.
 *  - `typescript`           — a devDependency in any real consumer.
 *  - `tailwindcss`          — f0 peers `^3.4.3`, so declaring it DOWNGRADES a
 *    Tailwind v4 consumer's own toolchain (measured: 4.3.3 -> 3.4.19, which
 *    breaks their CSS build). f0's prebuilt stylesheet is version-agnostic and
 *    the preset loads fine under v4 via `@config`, so there is nothing to gain.
 */
function requiredPeers(): string[] {
  const withheld = new Set(["react", "react-dom", "typescript", "tailwindcss"])
  const pkg = JSON.parse(
    readFileSync(join(PKG_ROOT, "package.json"), "utf-8")
  ) as { peerDependencies?: Record<string, string> }
  return Object.entries(pkg.peerDependencies ?? {})
    .filter(([name]) => !withheld.has(name))
    .map(([name, range]) => `${name}@${range}`)
    .sort()
}

/** Hand-authored items. These ship real source the consumer is meant to own. */
function foundationItems(): RegistryItem[] {
  return [
    {
      name: "theme",
      type: "registry:theme",
      title: "F0 Theme",
      description:
        "F0 design tokens: the pre-compiled stylesheet that every F0 component renders against, plus the Tailwind preset that lets your own markup use the same colours, spacing, radii and type scale.",
      files: [
        {
          path: `${PATH_PREFIX}/f0/theme/f0.css`,
          type: "registry:file",
          target: "~/f0.css",
        },
        {
          path: `${PATH_PREFIX}/f0/theme/f0-preset.ts`,
          type: "registry:file",
          target: "~/f0-preset.ts",
        },
      ],
      // The whole peer set rides on `theme`, which every other item depends on
      // transitively — so one `shadcn add` of any component installs a tree
      // that actually bundles.
      dependencies: [PKG, "@factorialco/f0-core", ...requiredPeers()],
      categories: ["theme", "foundation"],
      docs: [
        "Two independent steps — do both:",
        "",
        "1. Import `f0.css` once in your app entry, before your own Tailwind",
        "   entry file so your utilities can still override F0 defaults. This is",
        "   pre-compiled CSS and works on any Tailwind version.",
        "",
        "2. Point Tailwind at the preset so your OWN markup can use F0 tokens",
        "   (`bg-f1-background`, `text-f1-foreground`, the type scale).",
        "",
        "   Tailwind v3 — spread it at the TOP LEVEL of tailwind.config.ts, not",
        "   inside `theme.extend`; F0 replaces the palette rather than extending it:",
        "",
        '     import { f0Preset } from "./f0-preset"',
        "     export default { ...f0Preset, content: [...] }",
        "",
        "   Tailwind v4 — keep the same config file and load it from your CSS",
        "   through the v3-compat layer:",
        "",
        '     @import "tailwindcss";',
        '     @config "./tailwind.config.ts";',
        "",
        "Note: the raw palette (`bg-flubber-50`) emits bare HSL channels and is",
        "not meant to be used as utilities on either version — those tokens exist",
        "to be resolved through `theme()`. Use the semantic `f1-*` colours.",
      ].join("\n"),
    },
    {
      name: "utils",
      type: "registry:lib",
      title: "F0 Utils",
      description:
        "`cn` for merging conflicting Tailwind classes and `focusRing` so custom interactive elements get the same keyboard focus treatment as F0 components.",
      files: [{ path: `${PATH_PREFIX}/f0/lib/utils.ts`, type: "registry:lib" }],
      dependencies: ["clsx", "tailwind-merge"],
      categories: ["foundation"],
    },
    {
      name: "provider",
      type: "registry:lib",
      title: "F0 Provider",
      description:
        "Root provider supplying translations, locale and layout context. Required — F0 components read all three from context and throw when rendered outside it.",
      files: [
        {
          path: `${PATH_PREFIX}/f0/lib/f0-provider.tsx`,
          type: "registry:lib",
          target: "@lib/f0-provider.tsx",
        },
      ],
      dependencies: [PKG],
      registryDependencies: [`${NAMESPACE}/theme`],
      categories: ["foundation"],
      docs: 'Wrap your application once, above the router:\n\n  <F0Root locale="en">\n    <App />\n  </F0Root>',
    },
  ]
}

function main() {
  const status = computeComponentStatusData(SRC) as {
    components: {
      name: string
      zone: string
      apiStatus: string
      hasMdxDocs: boolean
      docQuality: string
      a11yTier: string
      storyFile: string
    }[]
  }

  /**
   * Component directory (relative to `src`, POSIX-separated) for every
   * component that owns a story — the authority on where one component ends
   * and the next begins.
   */
  type Status = (typeof status.components)[number]
  const statusByDir = new Map<string, Status>()
  for (const c of status.components) {
    const normalized = c.storyFile
      .split(sep)
      .join("/")
      .replace(/^.*?\/src\//, "")
    const storyDir = dirname(normalized)
    const componentDir = storyDir.endsWith("/__stories__")
      ? dirname(storyDir)
      : storyDir
    // A folder with several stories (variants of one component) keeps the
    // first; they share a directory and therefore a registry item.
    if (!statusByDir.has(componentDir)) {
      statusByDir.set(componentDir, c)
    }
  }
  const knownDirs = new Set(statusByDir.keys())

  const groups = collectExports(knownDirs)
  rmSync(WRAPPERS_DIR, { recursive: true, force: true })
  mkdirSync(WRAPPERS_DIR, { recursive: true })

  const items: RegistryItem[] = foundationItems()
  const claimedNames = new Set(items.map((i) => i.name))
  const skipped: string[] = []

  for (const group of [...groups.values()].sort((a, b) =>
    a.path.localeCompare(b.path)
  )) {
    const type = TYPE_BY_ZONE[group.zone]
    if (!type) {
      skipped.push(`${group.zone}/${group.dir} (unmapped zone)`)
      continue
    }
    if (group.symbols.size === 0) {
      continue
    }

    const meta = statusByDir.get(group.path)
    if (meta?.apiStatus === "internal" || meta?.apiStatus === "deprecated") {
      skipped.push(`${group.zone}/${group.dir} (${meta.apiStatus})`)
      continue
    }

    // Two zones can own a folder of the same name (`patterns/Forms` and
    // `experimental/Forms`). Registry names are a flat namespace, so qualify
    // the loser with its zone rather than let one silently overwrite the other.
    let itemName = toItemName(group.dir)
    if (claimedNames.has(itemName)) {
      itemName = `${group.zone}-${itemName}`
      if (claimedNames.has(itemName)) {
        throw new Error(
          `Duplicate registry item name "${itemName}" from ${group.path}`
        )
      }
    }
    claimedNames.add(itemName)
    const fileName = `${itemName}.ts`
    const entry = group.experimental ? `${PKG}/dist/experimental` : PKG
    writeFileSync(join(WRAPPERS_DIR, fileName), wrapperSource(group, entry))

    const categories = [group.zone]
    if (group.experimental) {
      categories.push("experimental")
    }
    if (meta?.apiStatus === "stable") {
      categories.push("stable")
    }

    items.push({
      name: itemName,
      type,
      title: group.dir,
      description: `${group.dir} from the F0 design system (${group.zone}${
        group.experimental ? ", experimental" : ""
      }). Re-exported from ${PKG}.`,
      files: [
        {
          path: `${PATH_PREFIX}/f0/components/${fileName}`,
          type: "registry:file",
          target: `@ui/${fileName}`,
        },
      ],
      dependencies: [PKG],
      registryDependencies: [`${NAMESPACE}/theme`, `${NAMESPACE}/provider`],
      categories,
      docs: meta?.hasMdxDocs
        ? `${HOMEPAGE}/?path=/docs/${group.zone}-${itemName}--docs`
        : undefined,
      meta: {
        zone: group.zone,
        apiStatus: meta?.apiStatus ?? "unknown",
        a11y: meta?.a11yTier ?? "unknown",
        exports: [...group.symbols.keys()].sort(),
      },
    })
  }

  const registry = {
    $schema: "https://ui.shadcn.com/schema/registry.json",
    name: "f0",
    homepage: HOMEPAGE,
    items,
  }
  writeFileSync(
    join(REGISTRY_DIR, "registry.json"),
    JSON.stringify(registry, null, 2) + "\n"
  )

  consola.info(
    `registry: ${items.length} items (${items.length - 3} components) -> registry/registry.json`
  )
  if (skipped.length > 0) {
    consola.warn(`registry: skipped ${skipped.length}:`)
    for (const s of skipped) {
      consola.warn(`  - ${s}`)
    }
  }
}

main()
