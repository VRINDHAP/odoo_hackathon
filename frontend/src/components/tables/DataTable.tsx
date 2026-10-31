import React, { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../forms/Primitives';

export interface DataColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  width?: string;
  sortValue?: (row: T) => string | number;
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  toolbar?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  page?: number;
  totalPages?: number;
  totalItems?: number;
  onPageChange?: (nextPage: number) => void;
}

/**
 * SPEC.md §11 & §12:
 * - Skeleton loaders prevent layout shifts during network fetches
 * - Automatically engages @tanstack/react-virtual when rows > 100
 * - Sortable column headers + server pagination metadata footer
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  toolbar,
  emptyTitle = 'No records found',
  emptyDescription = 'Adjust your active filters or create a new record to get started.',
  emptyAction,
  onRowClick,
  page,
  totalPages,
  totalItems,
  onPageChange,
}: DataTableProps<T>): React.ReactElement {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const parentRef = useRef<HTMLDivElement | null>(null);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const factor = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * factor;
      }
      return String(va).localeCompare(String(vb)) * factor;
    });
  }, [columns, rows, sortDir, sortKey]);

  const useVirtual = sortedRows.length > 100;

  const rowVirtualizer = useVirtualizer({
    count: useVirtual ? sortedRows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 46,
    overscan: 12,
  });

  const handleSort = (col: DataColumn<T>) => {
    if (!col.sortValue) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir('asc');
    }
  };

  return (
    <div className="table-card">
      {toolbar ? <div className="table-toolbar">{toolbar}</div> : null}

      <div
        ref={parentRef}
        className="table-scroll"
        style={useVirtual ? { maxHeight: 560, overflowY: 'auto' } : undefined}
      >
        <table className="ramp-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: col.align ?? 'left',
                    width: col.width,
                    cursor: col.sortValue ? 'pointer' : 'default',
                  }}
                  onClick={() => handleSort(col)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span>{col.header}</span>
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? (
                        <ArrowUp size={11} />
                      ) : (
                        <ArrowDown size={11} />
                      )
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={`skeleton-${idx}`}>
                  {columns.map((col) => (
                    <td key={col.key}>
                      <div className="skeleton-line" style={{ width: col.align === 'right' ? '60%' : '82%', marginLeft: col.align === 'right' ? 'auto' : 0 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ padding: '48px 24px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <span className="eyebrow-cap">Empty Register</span>
                    <h3 className="type-heading">{emptyTitle}</h3>
                    <p className="type-caption" style={{ maxWidth: 420 }}>
                      {emptyDescription}
                    </p>
                    {emptyAction ? <div style={{ marginTop: 6 }}>{emptyAction}</div> : null}
                  </div>
                </td>
              </tr>
            ) : useVirtual ? (
              <>
                {rowVirtualizer.getVirtualItems().length > 0 && rowVirtualizer.getVirtualItems()[0].start > 0 ? (
                  <tr>
                    <td colSpan={columns.length} style={{ height: rowVirtualizer.getVirtualItems()[0].start, padding: 0 }} />
                  </tr>
                ) : null}
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = sortedRows[virtualRow.index];
                  return (
                    <tr
                      key={rowKey(row)}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={col.align === 'right' ? 'money-cell' : undefined}
                          style={{ textAlign: col.align ?? 'left' }}
                        >
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {rowVirtualizer.getVirtualItems().length > 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      style={{
                        height:
                          rowVirtualizer.getTotalSize() -
                          rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1].end,
                        padding: 0,
                      }}
                    />
                  </tr>
                ) : null}
              </>
            ) : (
              sortedRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={col.align === 'right' ? 'money-cell' : undefined}
                      style={{ textAlign: col.align ?? 'left' }}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {page !== undefined && totalPages !== undefined && onPageChange ? (
        <div className="table-pagination">
          <span className="type-caption">
            Page {page} of {totalPages}
            {totalItems !== undefined ? ` · ${totalItems} total records` : ''}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
              Prev
            </Button>
            <Button
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next page"
            >
              Next
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

