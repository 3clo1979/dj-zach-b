import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { amountInput, businessToday, financeTotals, formatUsd, parseUsdAmount, paymentMethods, type FinancialRecord } from '../booking-finance-contract';
import { formatDay, type Inquiry } from './studio-data';

export type FinanceDraft = {
  mode: 'status' | 'amounts' | 'payment' | 'void';
  inquiryId: string; revision: string; status: string; bookingRevision?: string;
  amount: string; quotedAmount: string; bookedAmount: string;
  kind: 'payment' | 'refund'; paidOn: string; method: typeof paymentMethods[number] | '';
  recordId: string; reason: string;
};
export type FinanceEditor = { original: FinanceDraft; draft: FinanceDraft };
export function financeAlreadySaved(editor: FinanceEditor | null, records: FinancialRecord[]) {
  if (!editor) return false;
  const d = editor.draft, record = records.find(item => item.id === d.recordId);
  return !!record && (d.mode === 'payment' || (d.mode === 'void' && record.voidedAt !== null));
}
export const financeIsDirty = (editor: FinanceEditor | null) => !!editor && JSON.stringify(editor.original) !== JSON.stringify(editor.draft);

export const financeDay = businessToday;

export function newFinanceDraft(inquiry: Inquiry, mode: FinanceDraft['mode'], today: string): FinanceDraft {
  return { mode, inquiryId: inquiry.id, revision: inquiry.revision, status: inquiry.status,
    amount: '', quotedAmount: amountInput(inquiry.quotedAmountCents), bookedAmount: amountInput(inquiry.bookedAmountCents),
    kind: 'payment', paidOn: today, method: '', recordId: '', reason: '' };
}
export function BookingFinanceSummary({ inquiry, records, disabled, onOpen, onVoid }: {
  inquiry: Inquiry; records: FinancialRecord[]; disabled: boolean;
  onOpen: (mode: 'amounts' | 'payment', kind?: 'payment' | 'refund') => void;
  onVoid: (record: FinancialRecord) => void;
}) {
  const totals = financeTotals(records);
  const difference = inquiry.bookedAmountCents == null ? null : inquiry.bookedAmountCents - totals.netReceivedCents;
  return <section className="booking-finance" aria-label={'Amounts and payments for ' + inquiry.name}>
    <dl className="booking-money"><div><dt>Quoted</dt><dd>{formatUsd(inquiry.quotedAmountCents ?? null)}</dd></div><div><dt>Agreed booking</dt><dd>{formatUsd(inquiry.bookedAmountCents ?? null)}</dd></div><div><dt>Net received <small>recorded</small></dt><dd>{formatUsd(totals.netReceivedCents)}</dd></div></dl>
    <p className="booking-balance">{difference === null ? 'Balance unknown — no agreed amount saved.' : difference < 0 ? `Recorded overpayment: ${formatUsd(-difference)}. Review before recording more.` : `${inquiry.status === 'Booked' ? 'Recorded balance' : 'Agreed amount less net received'}: ${formatUsd(difference)}.`} {inquiry.status === 'Canceled' && 'Canceled booking — this is not an amount due.'}</p>
    <div className="booking-finance-actions"><button type="button" disabled={disabled} onClick={() => onOpen('amounts')}>Edit amounts</button><button type="button" disabled={disabled} onClick={() => onOpen('payment', 'payment')}>Record payment</button><button type="button" disabled={disabled || totals.netReceivedCents <= 0} onClick={() => onOpen('payment', 'refund')}>Record refund</button></div>
    <details className="booking-payment-history"><summary>Payment history ({records.length})</summary><p>Manual records only. Nothing here charges, transfers, or verifies money with a provider.</p>{records.length ? <ol>{records.map(record => <li key={record.id} className={record.voidedAt ? 'is-void' : ''}><div><b>{record.kind === 'refund' ? 'Refund' : 'Payment'} · {formatUsd(record.amountCents)}</b><span>{formatDay(record.paidOn)} · {record.method}</span><small>Recorded {new Date(record.createdAt).toLocaleString()}</small>{record.voidedAt && <small>Voided {new Date(record.voidedAt).toLocaleString()} · {record.voidReason}</small>}</div>{record.voidedAt ? <span className="studio-pill">Voided · excluded</span> : <button type="button" disabled={disabled} aria-label={`Void ${record.kind} of ${formatUsd(record.amountCents)} on ${formatDay(record.paidOn)}`} onClick={() => onVoid(record)}>Void record</button>}</li>)}</ol> : <p>No payments or refunds recorded yet. This does not confirm that nothing has been paid.</p>}</details>
  </section>;
}

export default function BookingFinanceDialog({ editor, inquiry, busy, stale, alreadySaved, today, error, onChange, onClose, onReload, onSave }: {
  editor: FinanceEditor; inquiry: Inquiry | undefined; busy: boolean; stale: boolean; alreadySaved: boolean; today: string; error: string;
  onChange: (draft: FinanceDraft) => void; onClose: () => void; onReload: () => void; onSave: (skip?: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => { node?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const d = editor.draft, isQuote = d.status === 'Quote sent';
  const title = d.mode === 'status' ? isQuote ? 'Save the quote?' : 'Confirm the booking amount?' : d.mode === 'amounts' ? 'Quote & agreed amount' : d.mode === 'void' ? 'Void this manual record?' : d.kind === 'refund' ? 'Record a refund' : 'Record a payment';
  const patch = (value: Partial<FinanceDraft>) => onChange({ ...d, ...value });
  const money = (label: string, name: 'amount' | 'quotedAmount' | 'bookedAmount', required = false) => <label>{label}<span className="finance-money-input"><span aria-hidden="true">$</span><input name={name} aria-label={label} inputMode="decimal" autoComplete="off" placeholder="Not entered" maxLength={10} value={d[name]} required={required} onChange={event => patch({ [name]: event.target.value })}/><span>USD</span></span></label>;
  return <dialog ref={dialog} className="finance-dialog" aria-labelledby="finance-dialog-title" aria-describedby="finance-dialog-help" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="finance-dialog-heading"><div><p className="studio-eyebrow">Private Booking Desk</p><h2 id="finance-dialog-title">{title}</h2><p>{inquiry?.name || 'Inquiry no longer available'}</p></div><button className="studio-icon-button" type="button" aria-label="Close amount and payment dialog" disabled={busy} onClick={onClose}><X size={20} aria-hidden="true"/></button></div>
    <p id="finance-dialog-help">{d.mode === 'status' ? isQuote ? 'An optional quote for the services discussed. You can add or change it later.' : 'Start with the saved quote, then adjust to the amount you agreed. Recording a price is optional.' : d.mode === 'amounts' ? 'Separate the quote from the final agreement. A blank value means unknown, not $0.00. Changes are kept in the audit history.' : d.mode === 'void' ? 'Use this to correct a mistaken entry, not to record a real refund. The original stays in history and is excluded from totals.' : 'A manual record only — this does not charge, refund, or transfer money. Check your own payment records first.'}</p>
    {stale && <p role="status" className="finance-warning">This inquiry changed after you opened it. Reload saved values and review your draft before saving.</p>}
    {alreadySaved && <p role="status" className="finance-warning">{d.mode === 'void' ? 'This record is already voided. Close this dialog to review the correction in payment history.' : 'This payment record is already saved. Close this dialog to review it in payment history; don’t enter it again.'}</p>}
    {error && <p role="alert" className="finance-warning">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); onSave(); }} aria-busy={busy}>
      <fieldset disabled={busy || stale || alreadySaved || !inquiry}>
        {d.mode === 'status' && <>{money(isQuote ? 'Quoted amount (optional)' : 'Agreed booking amount (optional)', 'amount')}<p className="finance-help">Zero means a confirmed no-charge amount. Leave this blank or choose Skip to keep the saved value unchanged.</p></>}
        {d.mode === 'amounts' && <div className="finance-fields">{money('Quoted amount (optional)', 'quotedAmount')}{money('Agreed booking amount (optional)', 'bookedAmount')}</div>}
        {d.mode === 'payment' && <>{money(d.kind === 'refund' ? 'Refund amount' : 'Payment amount', 'amount', true)}<div className="finance-fields"><label>{d.kind === 'refund' ? 'Refund date' : 'Payment date'}<input aria-label={d.kind === 'refund' ? 'Refund date' : 'Payment date'} type="date" value={d.paidOn} required max={today} onChange={event => patch({ paidOn: event.target.value })}/></label><label>Method<select aria-label="Payment method" required value={d.method} onChange={event => patch({ method: event.target.value as FinanceDraft['method'] })}><option value="">Choose method</option>{paymentMethods.map(method => <option key={method}>{method}</option>)}</select></label></div><p className="finance-help">Use the date money was actually {d.kind === 'refund' ? 'refunded' : 'received'} in America/New_York. Stripe and other methods are labels, not connected accounts.</p></>}
        {d.mode === 'void' && <><p className="finance-help">{d.kind === 'refund' ? 'Refund' : 'Payment'} · {formatUsd(parseUsdAmount(d.amount))} · {formatDay(d.paidOn)} · {d.method}. No money will move.</p><label>Reason for correction<input aria-label="Reason for correction" value={d.reason} required maxLength={300} onChange={event => patch({ reason: event.target.value })}/></label></>}
        <div className="finance-dialog-actions"><button className="studio-button gold" type="submit"><Check size={17} aria-hidden="true"/>{busy ? 'Saving…' : d.mode === 'status' ? `Save & mark ${d.status}` : d.mode === 'void' ? 'Void record' : d.mode === 'payment' ? `Save ${d.kind} record` : 'Save amounts'}</button>{d.mode === 'status' && <button className="studio-button outline" type="button" onClick={() => onSave(true)}>Skip amount · mark {d.status}</button>}</div>
      </fieldset>
      <div className="finance-dialog-secondary"><button type="button" className="studio-text-button" disabled={busy} onClick={onClose}>{alreadySaved ? 'Close' : 'Cancel'}</button>{inquiry && !alreadySaved && <button type="button" className="studio-text-button" disabled={busy} onClick={onReload}>Reload saved values</button>}</div>
    </form>
  </dialog>;
}
