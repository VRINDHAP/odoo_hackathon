import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import { Button } from '../../components/forms/Primitives';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../hooks/useToast';
import type { AuditLogEntry, PaginatedResponse } from '../../types/domain';
import { formatDateTime } from '../../utils/dates';

/**
 * FE-1.7: Audit Log Viewer with Expandable Before/After JSON Diff (Admin Only)
 * [SPEC.md §2, §5.10, §12.2]
 */
function renderJsonDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): React.ReactElement {
  const allKeys = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  );

  return (
    <div className="diff-grid">
      <div className="diff-pane">
        <div className="eyebrow-cap" style={{ marginBottom: 6 }}>
          Before State
        </div>
        {before === null ? (
          <span style={{ color: 'var(--color-ink-mute-2)' }}>null (New Entity Created)</span>
        ) : (
          allKeys.map((key) => {
            const bVal = before[key];
            const aVal = after ? after[key] : undefined;
            const changed = JSON.stringify(bVal) !== JSON.stringify(aVal);
            return (
              <div key={`b-${key}`} style={{ marginBottom: 2 }}>
                <span className={changed ? 'diff-line-removed' : undefined}>
                  &quot;{key}&quot;: {JSON.stringify(bVal)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="diff-pane">
        <div className="eyebrow-cap" style={{ marginBottom: 6 }}>
          After State
        </div>
        {after === null ? (
          <span style={{ color: 'var(--color-ink-mute-2)' }}>null (Entity Deleted)</span>
        ) : (
          allKeys.map((key) => {
            const bVal = before ? before[key] : undefined;
            const aVal = after[key];
            const changed = JSON.stringify(bVal) !== JSON.stringify(aVal);
            return (
              <div key={`a-${key}`} style={{ marginBottom: 2 }}>
                <span className={changed ? 'diff-line-added' : undefined}>
                  &quot;{key}&quot;: {JSON.stringify(aVal)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const AuditLogPage: React.FC = () => {
  const { showToast } = useToast();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const debouncedSearch = useDebounce(search, 300);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: '20',
      });
      if (debouncedSearch) qs.set('search', debouncedSearch);
      if (entityFilter) qs.set('entity', entityFilter);

      const res = await apiRequest<PaginatedResponse<AuditLogEntry>>(`/audit-logs?${qs.toString()}`);
      setEntries(res.items);
      setTotalPages(res.total_pages);
      setTotal(res.total);
      if (res.items.length > 0 && Object.keys(expandedIds).length === 0) {
        setExpandedIds({ [res.items[0].id]: true });
      }
    } catch {
      showToast('Unable to load system audit logs', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, entityFilter, expandedIds, page, showToast]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const toggleRow = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Immutable Ledger · Admin Only</span>
          <h1 className="type-display-md">Audit Log &amp; State Diffs</h1>
          <p className="type-caption">
            Every catalog change, subscription state transition, invoice action, and payment insertion is recorded with before/after snapshots.
          </p>
        </div>
        <div className="page-header-actions">
          <Button variant="outline" onClick={() => void fetchLogs()}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
      </header>

      <div className="table-card">
        <div className="table-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
            <input
              type="search"
              className="form-input"
              placeholder="Search actor email, entity ID, or action…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              style={{ maxWidth: 320 }}
            />
            <select
              className="form-select"
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              style={{ maxWidth: 190 }}
              aria-label="Filter by entity"
            >
              <option value="">All Entities</option>
              <option value="Subscription">Subscription</option>
              <option value="Invoice">Invoice</option>
              <option value="Payment">Payment</option>
              <option value="Plan">Plan</option>
              <option value="Product">Product</option>
              <option value="User">User</option>
              <option value="Settings">Settings</option>
            </select>
          </div>
          <span className="type-caption">{total} audit events</span>
        </div>

        <div className="table-scroll">
          <table className="ramp-table">
            <thead>
              <tr>
                <th style={{ width: 38 }} />
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>Action</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={6}>
                      <div className="skeleton-line" />
                    </td>
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center' }}>
                    <span className="type-caption">No audit events match your filter criteria.</span>
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const isOpen = Boolean(expandedIds[entry.id]);
                  return (
                    <React.Fragment key={entry.id}>
                      <tr onClick={() => toggleRow(entry.id)} style={{ cursor: 'pointer' }}>
                        <td>
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </td>
                        <td className="type-caption">{formatDateTime(entry.timestamp)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{entry.actor_email}</span>
                            <StatusChip status={entry.actor_role} showDot={false} />
                          </div>
                        </td>
                        <td>
                          <span>{entry.entity}</span>{' '}
                          <span className="mono-text" style={{ color: 'var(--color-ink-mute)' }}>
                            ({entry.entity_id})
                          </span>
                        </td>
                        <td>
                          <span className="mono-text">{entry.action}</span>
                        </td>
                        <td className="mono-text" style={{ color: 'var(--color-ink-mute)' }}>
                          {entry.ip_address}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colSpan={6} style={{ backgroundColor: 'var(--color-canvas-sand)', padding: '14px 20px' }}>
                            {renderJsonDiff(entry.before, entry.after)}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="table-pagination">
          <span className="type-caption">
            Page {page} of {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

