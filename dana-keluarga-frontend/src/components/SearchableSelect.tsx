import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search, Users } from "lucide-react";
import "./SearchableSelect.css";

type Props = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
};

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Pilih keluarga",
  searchPlaceholder = "Cari nama atau kode keluarga",
  disabled,
  required,
}: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = options.find((option) => option.value === value);
  const matches = options.filter((option) =>
    option.label
      .toLocaleLowerCase("id-ID")
      .includes(query.trim().toLocaleLowerCase("id-ID")),
  );
  const choices =
    placeholder === "Semua keluarga"
      ? [{ value: "", label: placeholder }, ...matches]
      : matches;
  const expanded = open && !disabled;
  const activeIndex = Math.min(active, choices.length - 1);
  useEffect(() => {
    input.current?.setCustomValidity(
      required && !value ? `${label} wajib dipilih.` : "",
    );
    input.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [required, value, label]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [expanded]);
  useEffect(() => {
    if (expanded && activeIndex >= 0)
      document
        .getElementById(`${id}-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, expanded, id]);
  const show = () => {
    if (!disabled) {
      setQuery("");
      setActive(0);
      setOpen(true);
    }
  };
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
    input.current?.focus();
  };
  return (
    <div
      ref={root}
      className="searchable-select"
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="ss-required">
            {" "}
            *
          </span>
        )}
      </label>
      <div
        className={`ss-control${expanded ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
      >
        {expanded ? (
          <Search size={18} aria-hidden="true" />
        ) : (
          <Users size={18} aria-hidden="true" />
        )}
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-required={required || undefined}
          aria-activedescendant={
            expanded && activeIndex >= 0
              ? `${id}-option-${activeIndex}`
              : undefined
          }
          value={expanded ? query : (selected?.label ?? "")}
          placeholder={expanded ? searchPlaceholder : placeholder}
          disabled={disabled}
          autoComplete="off"
          onFocus={() => {
            if (!expanded) show();
          }}
          onClick={() => {
            if (!expanded) show();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && expanded) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!expanded) show();
              else
                setActive(
                  Math.max(
                    0,
                    Math.min(
                      choices.length - 1,
                      activeIndex + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (!expanded) show();
              else if (choices[activeIndex]) choose(choices[activeIndex].value);
            }
          }}
        />
        <button
          type="button"
          className="ss-toggle"
          disabled={disabled}
          aria-label={
            expanded
              ? `Tutup pilihan ${label.toLowerCase()}`
              : `Buka pilihan ${label.toLowerCase()}`
          }
          tabIndex={-1}
          onClick={() => {
            if (expanded) {
              setOpen(false);
              input.current?.focus();
            } else {
              show();
              input.current?.focus();
            }
          }}
        >
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="ss-panel">
          <div className="ss-caption">
            {query
              ? `${matches.length} keluarga ditemukan`
              : "Pilih ruang keluarga"}
          </div>
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className="ss-list"
          >
            {choices.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={`ss-option${index === activeIndex ? " is-active" : ""}${option.value === value ? " is-selected" : ""}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option.value)}
              >
                <span className="ss-avatar" aria-hidden="true">
                  {option.value ? (
                    option.label.charAt(0).toUpperCase()
                  ) : (
                    <Users size={16} />
                  )}
                </span>
                <span className="ss-option-label">{option.label}</span>
                {option.value === value && (
                  <Check size={17} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
          {!matches.length && (
            <div className="ss-empty" role="status">
              <Search size={22} aria-hidden="true" />
              <strong>Keluarga tidak ditemukan</strong>
              <span>Coba nama atau kode keluarga lain.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
