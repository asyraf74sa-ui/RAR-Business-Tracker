import { useRef, useState } from 'react'
import { ArrowRight, Boxes, CheckCircle2, Eye, EyeOff, Gem, Leaf, LockKeyhole, Mail, WalletCards } from 'lucide-react'
import { Button, Field } from './ui.jsx'

export default function AuthPage({ onAuthenticate }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const submitLock = useRef(false)

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setPassword('')
    setConfirmPassword('')
    setMessage(null)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (submitLock.current) return
    setMessage(null)

    if (!email.trim() || !email.includes('@')) {
      setMessage({ type: 'error', text: 'Enter a valid email address.' })
      return
    }
    if (password.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters.' })
      return
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setMessage({ type: 'error', text: 'The passwords do not match.' })
      return
    }

    submitLock.current = true
    setLoading(true)
    try {
      const result = await onAuthenticate({ mode, email: email.trim(), password })
      if (result?.message) setMessage({ type: result.ok ? 'success' : 'error', text: result.message })
    } finally {
      submitLock.current = false
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-page__shape auth-page__shape--one" />
      <div className="auth-page__shape auth-page__shape--two" />
      <header className="auth-product">
        <div className="brand brand--product">
          <span className="brand-mark" aria-hidden="true">B</span>
          <div><strong>Business Tracker</strong><span>RAR + My Restaurant</span></div>
        </div>
      </header>

      <main className="auth-panel">
        <div className="auth-card">
          <div className="auth-card__heading">
            <span className="auth-card__icon"><WalletCards size={22} /></span>
            <p className="eyebrow">Private owner dashboard</p>
            <h1>{mode === 'login' ? 'Business Tracker sign-in' : 'Create your workspace'}</h1>
            <p>{mode === 'login' ? 'Use your RAR Business Tracker account to access your private RAR and My Restaurant records.' : 'Create a RAR Business Tracker account with private, isolated workspaces for both restaurant businesses.'}</p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchMode('signup')}>Create account</button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <Field label="Email address">
              <div className="input-with-icon"><Mail size={18} /><input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            </Field>
            <Field label="Password" hint={mode === 'signup' ? 'Use at least 6 characters.' : undefined}>
              <div className="input-with-icon"><LockKeyhole size={18} /><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            </Field>
            {mode === 'signup' && (
              <Field label="Confirm password">
                <div className="input-with-icon"><LockKeyhole size={18} /><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="••••••••" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={6} /></div>
              </Field>
            )}
            {message && <div className={`form-message form-message--${message.type}`} role="alert">{message.text}</div>}
            <Button type="submit" loading={loading} className="auth-submit">{mode === 'login' ? 'Sign in securely' : 'Create account'}<ArrowRight size={18} /></Button>
          </form>

          <div className="auth-trust"><CheckCircle2 size={16} /><span>Authentication is handled by Supabase. This app does not save your password in its business database.</span></div>
        </div>
      </main>

      <section className="auth-benefits" aria-label="Product benefits">
        <div><span><WalletCards size={19} /></span><p><strong>Clean wallet totals</strong><small>Every currency stays separate.</small></p></div>
        <div><span><Boxes size={19} /></span><p><strong>Separate inventory</strong><small>RAR and MR stock never mix.</small></p></div>
        <div><span><Gem size={19} /></span><p><strong>Gem tracking</strong><small>Conversions stay connected.</small></p></div>
        <div><span><Leaf size={19} /></span><p><strong>Native workspaces</strong><small>Financial view plus focused operations.</small></p></div>
      </section>
    </div>
  )
}
