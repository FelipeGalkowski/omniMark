import { createContext, useContext } from "react"

export interface User {
  id: string
  name: string
  email: string
  isDemoUser: boolean
}

export interface AuthCtxType {
  user: User
  updateUser: (updates: { name: string }) => Promise<void>
}

export const AuthContext = createContext<AuthCtxType>({
  user: { id: "demo", name: "Demo", email: "demo@omnimark.dev", isDemoUser: true },
  updateUser: async () => {},
})

export const useAuth = () => useContext(AuthContext)
