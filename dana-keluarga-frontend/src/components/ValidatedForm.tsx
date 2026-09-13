import { useId, useState, type FormHTMLAttributes } from 'react'
import { Feedback } from './Feedback'

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
type Issue = { control: Control; message: string }
function isControl(element: EventTarget): element is Control {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
}
function errorFor(control: Control) {
  if (control.disabled || !control.willValidate) return ''
  const label = Array.from(control.labels?.[0]?.childNodes ?? []).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())?.textContent?.trim() || control.name || 'Kolom ini'
  if (control.validity.valueMissing || (control.required && !control.value.trim())) return `${label} wajib diisi.`
  if (control.validity.typeMismatch) return `${label} belum valid. Contoh email: nama@contoh.com.`
  if ('minLength' in control && control.value && control.minLength > 0 && control.value.length < control.minLength) return `${label} minimal ${control.minLength} karakter.`
  if (control.validity.rangeUnderflow && control instanceof HTMLInputElement) return `${label} minimal ${control.min}.`
  if (control.validity.rangeOverflow && control instanceof HTMLInputElement) return `${label} maksimal ${control.max}.`
  if (!control.validity.valid) return `${label} belum sesuai format yang diminta.`
  return ''
}

// Shared validation for login and every modal form; no submit reaches the API while invalid.
export function ValidatedForm({ children, onSubmit, onInputCapture, onBlurCapture, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  const [issues, setIssues] = useState<Issue[]>([])
  const summaryId = useId()
  function validate(control: Control) {
    const message = errorFor(control)
    if (message) { control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-errormessage', summaryId) }
    else { control.removeAttribute('aria-invalid'); control.removeAttribute('aria-errormessage') }
    return message
  }
  return <form {...props} noValidate onSubmit={(event) => {
    const next = Array.from(event.currentTarget.elements).filter(isControl).map((control) => ({ control, message: validate(control) })).filter((issue) => issue.message)
    setIssues(next)
    if (next.length) { event.preventDefault(); next[0].control.focus(); return }
    onSubmit?.(event)
  }} onBlurCapture={(event) => {
    if (isControl(event.target)) {
      const control = event.target
      const message = validate(control)
      setIssues((current) => [...current.filter((issue) => issue.control !== control && issue.control.isConnected), ...(message ? [{ control, message }] : [])])
    }
    onBlurCapture?.(event)
  }} onInputCapture={(event) => {
    if (isControl(event.target) && event.target.hasAttribute('aria-invalid')) {
      const control = event.target
      const message = validate(control)
      setIssues((current) => current.flatMap((issue) => !issue.control.isConnected ? [] : issue.control === control ? message ? [{ control, message }] : [] : [issue]))
    }
    onInputCapture?.(event)
  }}>
    {children}
    {issues.length > 0 && <div id={summaryId} className="validation-summary"><Feedback tone="error" title="Periksa isian berikut"><ul>{issues.map((issue, index) => <li key={index}><button type="button" onClick={() => issue.control.focus()}>{issue.message}</button></li>)}</ul></Feedback></div>}
  </form>
}
