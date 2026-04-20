import { useEffect, useState } from 'react'
import { getCurrentUser } from 'aws-amplify/auth'
import { ChatExperience } from '@/components/ChatExperience.tsx'
import { AuthScreen } from '@/components/AuthScreen.tsx'
import { AGENT_MODE } from '@/lib/api.ts'

export function App() {
  const [authed, setAuthed] = useState(AGENT_MODE !== 'direct')
  const [checking, setChecking] = useState(AGENT_MODE === 'direct')

  useEffect(() => {
    if (AGENT_MODE !== 'direct') return

    getCurrentUser()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
      .finally(() => setChecking(false))
  }, [])

  if (checking) return null
  if (!authed) return <AuthScreen onAuthenticated={() => setAuthed(true)} />

  return <ChatExperience />
}
