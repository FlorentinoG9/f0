import { baseConfig } from "@factorialco/f0-core/tailwind"
import type { Config } from "tailwindcss"

/**
 * F0 Tailwind preset.
 *
 * Spread this into your own `tailwind.config.ts` so utility classes written in
 * *your* markup resolve against the same tokens F0 components use
 * (`bg-f1-background`, `text-f1-foreground`, `rounded-md`, the type scale…).
 *
 * This does NOT style F0 components — those ship pre-compiled in
 * `@factorialco/f0-react/dist/styles.css`. The two are independent: import the
 * stylesheet to render F0, add this preset to author matching markup yourself.
 *
 * F0 *replaces* the Tailwind palette rather than extending it (`theme.colors`,
 * not `theme.extend.colors`), so spread `f0Preset` at the top level of your
 * config instead of nesting it under `extend`.
 */
export const f0Preset = {
  ...baseConfig,
  theme: {
    ...baseConfig.theme,
    extend: {
      ...baseConfig.theme?.extend,
      keyframes: {
        ...baseConfig.theme?.extend?.keyframes,
        "rotate-gradient": {
          from: { "--gradient-angle": "0deg" },
          to: { "--gradient-angle": "360deg" },
        },
      },
      animation: {
        ...baseConfig.theme?.extend?.animation,
        "rotate-gradient": "rotate-gradient 2s linear infinite",
      },
    },
  },
} satisfies Omit<Config, "content">

export default f0Preset
