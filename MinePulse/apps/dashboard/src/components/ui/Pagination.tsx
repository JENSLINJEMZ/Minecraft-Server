import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
}): JSX.Element {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-4 pt-3 text-xs text-content-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn-ghost px-2 py-1"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-2">
          Page {page} / {Math.max(1, totalPages)}
        </span>
        <button
          type="button"
          className="btn-ghost px-2 py-1"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
