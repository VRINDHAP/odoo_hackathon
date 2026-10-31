import React, { useCallback, useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import { Button, Modal } from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useToast } from '../../hooks/useToast';
import type { PaymentRecord } from '../../types/domain';
import { formatDateTime } from '../../utils/dates';
import { formatMoney, parseMoney } from '../../utils/money';

/**
 * FE-7.2 (Part B): Customer Portal "Payment History" [SPEC.md §2, §9, §12.3]
 * - Strictly queries GET /me/payments
 * - Displays past transaction receipts with settlement references and PDF receipt download
 */
export const PortalPaymentsPage: React.FC = () => {
  const { showToast } = useToast();

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReceipt, setSelectedReceipt] = useState<PaymentRecord | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadMyPayments = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<PaymentRecord[]>('/me/payments');
      setPayments(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load payment history', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadMyPayments();
  }, [loadMyPayments]);

  const handleDownloadInvoicePdf = async (payment: PaymentRecord) => {
    setDownloadingId(payment.id);
    try {
      const blob = await apiRequest<Blob>(`/me/invoices/${payment.invoice_id}/pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${payment.invoice_number}-receipt.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`Downloaded receipt for ${payment.invoice_number}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to download receipt', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const columns: DataColumn<PaymentRecord>[] = [
    {
      key: 'payment_date',
      header: 'Settlement Date',
      sortValue: (row) => row.payment_date,
      render: (row) => formatDateTime(row.payment_date),
    },
    {
      key: 'invoice_number',
      header: 'Invoice #',
      sortValue: (row) => row.invoice_number,
      render: (row) => <span className="mono-text">{row.invoice_number}</span>,
    },
    {
      key: 'method',
      header: 'Method',
      render: (row) => (
        <span style={{ textTransform: 'uppercase', fontSize: 12 }}>
          {row.method.replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'reference',
      header: 'Receipt Reference',
      render: (row) => <span className="mono-text">{row.reference}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.is_reversal || parseMoney(row.amount) < 0 ? (
          <StatusChip status="Reversal" variant="overdue" />
        ) : (
          <StatusChip status="Receipt Issued" variant="paid" />
        ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortValue: (row) => parseMoney(row.amount),
      render: (row) => (
        <span
          className="cell-numeric"
          style={{
            color:
              row.is_reversal || parseMoney(row.amount) < 0
                ? 'var(--chip-overdue-text)'
                : 'var(--color-ink)',
          }}
        >
          {formatMoney(row.amount, row.currency)}
        </span>
      ),
    },
    {
      key: 'receipt',
      header: 'Receipt',
      align: 'right',
      render: (row) => (
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="sand"
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={() => setSelectedReceipt(row)}
          >
            View Receipt
          </Button>
          <Button
            variant="outline"
            style={{ padding: '5px 10px', fontSize: 12 }}
            isLoading={downloadingId === row.id}
            onClick={() => void handleDownloadInvoicePdf(row)}
          >
            <Download size={13} />
            PDF
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Transaction Receipts</span>
          <h1 className="type-display-md">Payment History</h1>
          <p className="type-caption">
            Complete record of settled invoice payments and downloadable receipts for your account.
          </p>
        </div>
      </header>

      <DataTable
        columns={columns}
        rows={payments}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(row) => setSelectedReceipt(row)}
        emptyTitle="No payment receipts recorded yet"
        emptyDescription="Completed online and bank settlements will appear here automatically."
      />

      <Modal
        isOpen={Boolean(selectedReceipt)}
        eyebrow="Official Payment Receipt"
        title={selectedReceipt?.reference ?? 'Receipt'}
        onClose={() => setSelectedReceipt(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer size={14} />
              Print Receipt
            </Button>
            <Button variant="primary" onClick={() => setSelectedReceipt(null)}>
              Close
            </Button>
          </>
        }
      >
        {selectedReceipt ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="mosaic-grid-2">
              <div>
                <span className="eyebrow-cap">Invoice Number</span>
                <div className="mono-text" style={{ marginTop: 4 }}>
                  {selectedReceipt.invoice_number}
                </div>
              </div>
              <div>
                <span className="eyebrow-cap">Settlement Amount</span>
                <div className="type-subhead cell-numeric" style={{ textAlign: 'left', marginTop: 4 }}>
                  {formatMoney(selectedReceipt.amount, selectedReceipt.currency)}
                </div>
              </div>
              <div>
                <span className="eyebrow-cap">Date &amp; Time</span>
                <div className="type-body-sm" style={{ marginTop: 4 }}>
                  {formatDateTime(selectedReceipt.payment_date)}
                </div>
              </div>
              <div>
                <span className="eyebrow-cap">Payment Method</span>
                <div className="type-body-sm" style={{ marginTop: 4, textTransform: 'uppercase' }}>
                  {selectedReceipt.method.replace('_', ' ')}
                </div>
              </div>
            </div>
            {selectedReceipt.note ? (
              <div className="type-caption" style={{ paddingTop: 8, borderTop: '1px solid var(--color-hairline)' }}>
                Note: {selectedReceipt.note}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

