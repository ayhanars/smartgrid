export const MIN_PASSWORD_LENGTH = 8

/** Supabase error strings, reworded for the dialogs. */
export function friendlyAuthError(err: unknown): string {
  // Supabase data errors are plain objects with a message, not Error instances.
  const message = err instanceof Error ? err.message : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password. If you signed up before passwords existed, use “Forgot password?” to set one.'
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: open the link we sent when you signed up.'
  if (/rate limit|too many requests|security purposes/i.test(message)) return 'Too many attempts for now. Wait a minute and try again.'
  if (/password should be at least/i.test(message)) return `Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`
  if (/provider is not enabled/i.test(message)) return 'Google sign-in is not enabled for this app yet.'
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'No connection. Check your network and try again.'
  return message || 'Something went wrong'
}
