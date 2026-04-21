import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { configureAuth } from './lib/auth.ts'
import './styles.css'

// Initialize Cognito (no-op if env vars are missing)
configureAuth()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
