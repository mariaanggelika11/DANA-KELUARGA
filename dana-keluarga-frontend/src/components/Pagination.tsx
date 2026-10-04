import { ChevronLeft, ChevronRight } from "lucide-react";
import "./Pagination.css";

type Props = {
  page: number;
  total: number;
  pageSize: number;
  disabled?: boolean;
  onChange: (page: number) => void;
};

export function Pagination({
  page,
  total,
  pageSize,
  disabled = false,
  onChange,
}: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <nav className="pagination" aria-label="Navigasi halaman">
      <button
        type="button"
        className="secondary-button pagination-arrow"
        aria-label="Halaman sebelumnya"
        title="Halaman sebelumnya"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <span
        className="pagination-position"
        aria-label={`Halaman ${page} dari ${pages}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {page} / {pages}
      </span>
      <button
        type="button"
        className="secondary-button pagination-arrow"
        aria-label="Halaman berikutnya"
        title="Halaman berikutnya"
        disabled={disabled || page >= pages}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </nav>
  );
}
