import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  currencyError,
  formatCurrencyInput,
  parseCurrency,
} from "../lib/currency";

type Props = {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  min?: string;
  max?: string;
  error?: string;
  helperText?: string;
};
export function CurrencyInput({
  value,
  onChange,
  name,
  label,
  placeholder = "Masukkan nominal",
  required = false,
  disabled,
  readOnly,
  min,
  max,
  error,
  helperText,
}: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [invalid, setInvalid] = useState("");
  const validation =
    error || invalid || currencyError(value, required, min, max);
  const display = formatCurrencyInput(value);
  useLayoutEffect(() => {
    input.current?.setCustomValidity(validation);
    if (caret.current !== null && input.current) {
      let remaining = caret.current;
      let position = 0;
      while (position < display.length && remaining > 0) {
        if (/\d/.test(display[position])) remaining--;
        position++;
      }
      input.current.setSelectionRange(position, position);
      caret.current = null;
    }
  }, [display, validation]);
  return (
    <div className="money-field">
      <label htmlFor={id}>{label}</label>
      <div className="currency-input">
        <span aria-hidden="true">Rp</span>
        <input
          ref={input}
          id={id}
          name={name}
          value={display}
          inputMode="numeric"
          autoComplete="off"
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          aria-invalid={touched && Boolean(validation)}
          aria-describedby={`${id}-help`}
          onBlur={() => setTouched(true)}
          onInvalid={() => setTouched(true)}
          onKeyDown={(event) => {
            const element = event.currentTarget;
            const start = element.selectionStart ?? 0;
            if (element.selectionEnd !== start || readOnly) return;
            const index = event.key === "Backspace" ? start - 1 : start;
            if (
              display[index] === "." &&
              (event.key === "Backspace" || event.key === "Delete")
            ) {
              event.preventDefault();
              const before = display.slice(0, start).replace(/\D/g, "").length;
              const remove = event.key === "Backspace" ? before - 1 : before;
              const raw = value.slice(0, remove) + value.slice(remove + 1);
              caret.current = Math.max(
                0,
                event.key === "Backspace" ? before - 1 : before,
              );
              setInvalid("");
              setTouched(true);
              onChange(raw ? BigInt(raw).toString() : "");
            }
          }}
          onChange={(event) => {
            const text = event.target.value;
            try {
              // Formatting separators may become irregular during edits; reject other characters first.
              const inserted = (event.nativeEvent as InputEvent).data;
              if (
                (inserted && /[^\d]/.test(inserted)) ||
                !/^[\d.]*$/.test(text)
              )
                throw new Error("Gunakan angka saja untuk nominal.");
              const raw = parseCurrency(text.replace(/\./g, ""));
              caret.current = text
                .slice(0, event.target.selectionStart ?? text.length)
                .replace(/\D/g, "").length;
              setInvalid("");
              setTouched(true);
              onChange(raw);
            } catch (err) {
              setTouched(true);
              setInvalid((err as Error).message);
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            try {
              const pasted = parseCurrency(event.clipboardData.getData("text"));
              const start = event.currentTarget.selectionStart ?? 0;
              const end = event.currentTarget.selectionEnd ?? start;
              const before = display.slice(0, start).replace(/\D/g, "");
              const after = display.slice(end).replace(/\D/g, "");
              const raw = before + pasted + after;
              caret.current = before.length + pasted.length;
              setInvalid("");
              setTouched(true);
              onChange(raw ? BigInt(raw).toString() : "");
            } catch (err) {
              setTouched(true);
              setInvalid((err as Error).message);
            }
          }}
        />
      </div>
      <small
        id={`${id}-help`}
        className={touched && validation ? "field-error" : "field-help"}
      >
        {touched && validation ? validation : helperText}
      </small>
    </div>
  );
}
