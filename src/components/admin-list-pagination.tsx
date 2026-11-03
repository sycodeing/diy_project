import Link from "next/link";

type AdminListPaginationProps = {
  basePath: string;
  currentPage: number;
  pageSize: number;
  searchParams?: Record<string, string | undefined>;
  totalItems: number;
  totalPages: number;
};

export function AdminListPagination({
  basePath,
  currentPage,
  pageSize,
  searchParams = {},
  totalItems,
  totalPages,
}: AdminListPaginationProps) {
  if (!totalItems) return null;
  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);
  const hrefForPage = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <nav aria-label="列表分页" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel/90 px-4 py-3 text-sm">
      <p className="text-muted">显示 {firstItem}–{lastItem}，共 {totalItems} 条</p>
      <div className="flex items-center gap-2">
        {currentPage > 1
          ? <Link className="focus-ring rounded-md border border-line bg-white px-3 py-2 font-bold" href={hrefForPage(currentPage - 1)}>上一页</Link>
          : <span aria-disabled="true" className="rounded-md border border-line bg-surface px-3 py-2 font-bold text-muted">上一页</span>}
        <span className="min-w-20 text-center font-black">{currentPage} / {totalPages}</span>
        {currentPage < totalPages
          ? <Link className="focus-ring rounded-md border border-line bg-white px-3 py-2 font-bold" href={hrefForPage(currentPage + 1)}>下一页</Link>
          : <span aria-disabled="true" className="rounded-md border border-line bg-surface px-3 py-2 font-bold text-muted">下一页</span>}
      </div>
    </nav>
  );
}
