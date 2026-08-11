import { useEffect, useState } from 'react'
import { getCurrentUser, signOut } from 'aws-amplify/auth'
import { ChatExperience } from '@/components/ChatExperience.tsx'
import { AuthScreen } from '@/components/AuthScreen.tsx'

export function App() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState<string>()

  /** Resolves the signed-in user, if any, and reports whether there is one. */
  const syncUser = () =>
    getCurrentUser()
      .then((user) => {
        // `loginId` is the email the user typed; `username` is the pool's internal id.
        setEmail(user.signInDetails?.loginId ?? user.username)
        return true
      })
      .catch(() => false)

  useEffect(() => {
    syncUser()
      .then(setAuthed)
      .finally(() => setChecking(false))
  }, [])

  const handleSignOut = async () => {
    try {
      await signOut()
    } finally {
      // Amplify clears its local token store even when the request to revoke the session
      // server-side fails, so the user still leaves the session they asked to end.
      setAuthed(false)
      setEmail(undefined)
    }
  }

  if (checking) return null

  if (!authed) {
    return (
      <AuthScreen
        onAuthenticated={() => {
          syncUser().then(setAuthed)
        }}
      />
    )
  }

  return <ChatExperience userEmail={email} onSignOut={handleSignOut} />
}
