import { useRef, useState } from 'react'
import { ArrowRight, BarChart3, Boxes, CheckCircle2, Eye, EyeOff, Leaf, LockKeyhole, Mail } from 'lucide-react'
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
      <section className="auth-story">
        <div className="auth-story__top">
          <div className="brand brand--light">
            <span className="brand-mark">R</span>
            <div><strong>RAR</strong><span>Business tracker</span></div>
          </div>
          <span className="auth-story__tag">Built for restaurant traders</span>
        </div>
        <div className="auth-story__content">
          <p className="eyebrow">One source of truth</p>
          <h1>Know what sold.<br />Know what’s in stock.</h1>
          <p>Track every bundle, gem conversion, supplier purchase, and farming cycle without losing sight of your real inventory.</p>
          <div className="auth-benefits">
            <div><span><BarChart3 size={20} /></span><strong>Separate currency totals</strong><small>USD, MYR, PHP, and IDR stay cleanly apart.</small></div>
            <div><span><Boxes size={20} /></span><strong>Live inventory</strong><small>Every transaction moves stock exactly once.</small></div>
            <div><span><Leaf size={20} /></span><strong>Farm forecasting</strong><small>Sync cycles and see your monthly production.</small></div>
          </div>
        </div>
        <p className="auth-story__footer"><CheckCircle2 size={16} /> Secured by your existing Supabase account</p>
      </section>

      <main className="auth-panel">
        <div className="auth-card">
          <div className="auth-card__heading">
            <p className="eyebrow">Welcome to your back office</p>
            <h2>{mode === 'login' ? 'Sign in to continue' : 'Create your account'}</h2>
            <p>{mode === 'login' ? 'Your sales and stock are waiting.' : 'Start with your own private RAR workspace.'}</p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>Sign in</button>
            <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchMode('signup')}>Create account</button>
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
            <Button type="submit" loading={loading} className="auth-submit">{mode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight size={18} /></Button>
          </form>
          <p className="auth-privacy">Your session stays signed in on this device until you sign out.</p>
        </div>
      </main>
    </div>
  )
}
