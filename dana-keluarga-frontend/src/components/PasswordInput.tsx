import { useId, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Feedback } from './Feedback'

export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const hintId = useId()
  const inputId = props.id ?? `${hintId}-input`
  return <>
    <div className="password-control">
      <input {...props} id={inputId} className={className} type={visible ? 'text' : 'password'}
        aria-describedby={[props['aria-describedby'], capsLock ? hintId : null].filter(Boolean).join(' ') || undefined}
        onKeyDown={(event) => { setCapsLock(event.getModifierState('CapsLock')); props.onKeyDown?.(event) }}
        onKeyUp={(event) => { setCapsLock(event.getModifierState('CapsLock')); props.onKeyUp?.(event) }}
        onBlur={(event) => { setCapsLock(false); props.onBlur?.(event) }} />
      <button type="button" className="password-toggle" disabled={props.disabled} aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={visible} aria-controls={inputId} onClick={() => setVisible((value) => !value)}>
        {visible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
      </button>
    </div>
    {capsLock && <div id={hintId}><Feedback tone="warning" title="Caps Lock aktif">Periksa huruf besar dan kecil pada password.</Feedback></div>}
  </>
}
