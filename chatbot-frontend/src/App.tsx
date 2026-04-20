import { useEffect, useState } from 'react'
import { getCurrentUser } from 'aws-amplify/auth'
import { ChatExperience } from '@/components/ChatExperience.tsx'
import { AuthScreen } from '@/components/AuthScreen.tsx'

export function App() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    getCurrentUser()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
      .finally(() => setChecking(false))
  }, [])

  if (checking) return null
  if (!authed) return <AuthScreen onAuthenticated={() => setAuthed(true)} />

  return <ChatExperience />
}
