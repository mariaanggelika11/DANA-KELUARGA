import type { ButtonHTMLAttributes } from "react";
import { RefreshCw } from "lucide-react";

export function RefreshButton({
  children = "Perbarui",
  className = "secondary-button",
  type = "button",
  loading = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading}
      type={type}
      className={`${className} refresh-button`}
    >
      <RefreshCw
        className={loading ? "loading-spinner" : undefined}
        size={16}
        aria-hidden="true"
      />
      <span>{children}</span>
    </button>
  );
}
