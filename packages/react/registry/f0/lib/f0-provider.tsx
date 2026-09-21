import { defaultTranslations, F0Provider } from "@factorialco/f0-react"
import type { ComponentProps, ReactNode } from "react"

type F0ProviderProps = ComponentProps<typeof F0Provider>

export interface F0RootProps {
  children: ReactNode
  /** Overrides merged over `defaultTranslations`. */
  translations?: Partial<F0ProviderProps["i18n"]["translations"]>
  /** BCP 47 locale. Drives date, number and duration formatting. */
  locale?: string
  /** Layout configuration forwarded to F0's LayoutProvider. */
  layout?: F0ProviderProps["layout"]
}

/**
 * Root provider for F0.
 *
 * Every F0 component reads translations and locale from context, so this must
 * wrap your application — a component rendered outside it will throw. Mount it
 * once, above your router.
 */
export function F0Root({
  children,
  translations,
  locale = "en",
  layout,
}: F0RootProps) {
  return (
    <F0Provider
      i18n={{ translations: { ...defaultTranslations, ...translations } }}
      l10n={{ l10n: { locale } }}
      layout={layout}
    >
      {children}
    </F0Provider>
  )
}
