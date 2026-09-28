import { createContext, useContext } from "react"

export type ThemeMode = "light" | "dark" | "system"

export interface ThemeCtx {
  isDark: boolean
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
}

export const ThemeContext = createContext<ThemeCtx>({
  isDark: false,
  mode: "system",
  setMode: () => {},
})

export const useTheme = () => useContext(ThemeContext)
