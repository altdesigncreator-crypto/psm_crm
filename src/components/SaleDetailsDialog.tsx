import { useEffect, useId, useState, type FormEvent } from 'react';
import { Loader2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/contexts/TranslationContext';
import {
  computeCompanyIncome, formatKyat, formatLakh, kyatToLakh, saveSale, validateSaleInput,
} from '@/lib/sales';
import type { Lead } from '@/types';

interface SaleDetailsDialogProps {
  /** The lead being sold, or null to keep the dialog closed. */
  lead: Pick<Lead, 'id' | 'name' | 'status' | 'sale_amount' | 'commission_rate'> | null;
  onOpenChange: (open: boolean) => void;
  /** Called with the server row (incl. DB-computed income) after a successful save. */
  onSaved: (lead: Lead) => void;
}

const toInputValue = (n: number | null | undefined) => (n == null ? '' : String(n));

/**
 * Captures sale amount + company commission when a lead moves to Sold, and
 * lets an already-sold lead's figures be corrected. Moving to Sold and the
 * figures are saved in one UPDATE (see saveSale), so a lead can never sit in
 * Sold without them — the DB trigger enforces the same rule server-side.
 */
export default function SaleDetailsDialog({ lead, onOpenChange, onSaved }: SaleDetailsDialogProps) {
  const { t } = useTranslation();
  const amountId = useId();
  const rateId = useId();
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const isEdit = lead?.status === 'sold';

  // Re-seed the form each time the dialog opens for a lead.
  useEffect(() => {
    if (!lead) return;
    setAmount(lead.sale_amount ? toInputValue(kyatToLakh(Number(lead.sale_amount))) : '');
    setRate(toInputValue(lead.commission_rate));
    setSubmitted(false);
    setSaving(false);
  }, [lead?.id]);

  const { value, errors } = validateSaleInput(amount, rate);
  const preview = value ? computeCompanyIncome(value.saleAmount, value.commissionRate) : null;
  const showAmountError = (submitted || amount !== '') && errors.amount;
  const showRateError = (submitted || rate !== '') && errors.rate;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!lead || !value || saving) return;
    setSaving(true);
    try {
      const saved = await saveSale(lead.id, value);
      toast.success(t(isEdit ? 'sale.updatedToast' : 'sale.markedSoldToast'));
      onSaved(saved);
      onOpenChange(false);
    } catch {
      toast.error(t('sale.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!lead} onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-2xl">
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{t(isEdit ? 'sale.editTitle' : 'sale.recordTitle')}</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              <span className="font-semibold text-foreground">{lead?.name}</span>
              {' · '}
              {t(isEdit ? 'sale.editDescription' : 'sale.recordDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor={amountId} className="text-sm font-medium text-foreground">{t('sale.amountLabel')}</label>
            <Input
              id={amountId}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder="1,500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={!!showAmountError}
              aria-describedby={`${amountId}-hint`}
              className="h-12 text-base tabular-nums"
            />
            <p id={`${amountId}-hint`} className={`text-xs ${showAmountError ? 'text-destructive' : 'text-muted-foreground'} tabular-nums`}>
              {showAmountError ? t(`sale.error.${errors.amount}`) : value ? `= ${formatKyat(value.saleAmount)}` : ' '}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor={rateId} className="text-sm font-medium text-foreground">{t('sale.rateLabel')}</label>
            <Input
              id={rateId}
              inputMode="decimal"
              autoComplete="off"
              placeholder="2"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              aria-invalid={!!showRateError}
              aria-describedby={`${rateId}-hint`}
              className="h-12 text-base tabular-nums"
            />
            <p id={`${rateId}-hint`} className="text-xs text-destructive">
              {showRateError ? t(`sale.error.${errors.rate}`) : ' '}
            </p>
          </div>

          <div className="rounded-xl bg-success/10 border border-success/20 p-4 flex items-center gap-3" aria-live="polite">
            <div className="w-10 h-10 rounded-lg bg-success/15 flex items-center justify-center shrink-0"><TrendingUp className="w-5 h-5 text-success" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{t('sale.companyIncome')}</p>
              <p className="text-lg font-bold text-foreground tabular-nums truncate">
                {preview == null ? '—' : `${formatLakh(preview)} ${t('sale.lakhUnit')}`}
              </p>
              {preview != null && <p className="text-xs text-muted-foreground tabular-nums truncate">{formatKyat(preview)}</p>}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-12" disabled={saving} onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" className="h-12" disabled={saving || (submitted && !value)}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t(isEdit ? 'common.save' : 'sale.confirmSold')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
