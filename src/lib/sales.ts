import { supabase } from '@/db/supabase';
import type { Lead } from '@/types';

/** 1 lakh (သိန်း) = 100,000 MMK. Sale amounts are stored in MMK and entered
 * / displayed in lakhs — the unit the team already quotes prices in (see
 * BUDGET_RANGES) and far less error-prone than typing nine zeros. */
export const KYAT_PER_LAKH = 100_000;

export const lakhToKyat = (lakh: number) => Math.round(lakh * KYAT_PER_LAKH * 100) / 100;
export const kyatToLakh = (kyat: number) => kyat / KYAT_PER_LAKH;

/** Company income from a sale. Mirrors the commission_amount generated
 * column (round(sale_amount * commission_rate / 100, 2)) — used only to
 * preview the figure before saving; the DB value is the source of truth. */
export function computeCompanyIncome(saleAmountKyat: number, commissionRate: number): number {
  return Math.round(saleAmountKyat * commissionRate) / 100;
}

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const formatNumber = (n: number) => numberFormat.format(n);
export const formatKyat = (kyat: number) => `${numberFormat.format(kyat)} MMK`;
export const formatLakh = (kyat: number) => numberFormat.format(kyatToLakh(kyat));
export const formatPercent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

/** Parses a user-typed number, tolerating thousands separators. Returns
 * null for blank or non-numeric input. */
export function parseDecimal(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export interface SaleInput {
  /** Sale value in MMK. */
  saleAmount: number;
  /** Company commission, percent 0–100. */
  commissionRate: number;
}

export type SaleFieldError = 'amountRequired' | 'amountTooLarge' | 'rateRequired' | 'rateOutOfRange';

/** numeric(14, 2) ceiling for sale_amount. */
const MAX_SALE_KYAT = 999_999_999_999.99;

/** Same rules the enforce_sale_details trigger applies, checked client-side
 * so the user gets inline feedback instead of a failed save. */
export function validateSaleInput(amountLakhRaw: string, rateRaw: string): {
  value: SaleInput | null;
  errors: { amount?: SaleFieldError; rate?: SaleFieldError };
} {
  const errors: { amount?: SaleFieldError; rate?: SaleFieldError } = {};
  const amountLakh = parseDecimal(amountLakhRaw);
  const rate = parseDecimal(rateRaw);

  const saleAmount = amountLakh === null ? null : lakhToKyat(amountLakh);
  if (saleAmount === null || saleAmount <= 0) errors.amount = 'amountRequired';
  else if (saleAmount > MAX_SALE_KYAT) errors.amount = 'amountTooLarge';

  if (rate === null) errors.rate = 'rateRequired';
  else if (rate < 0 || rate > 100) errors.rate = 'rateOutOfRange';

  if (errors.amount || errors.rate || saleAmount === null || rate === null) return { value: null, errors };
  return { value: { saleAmount, commissionRate: Math.round(rate * 100) / 100 }, errors };
}

/** Moves a lead into Sold together with its sale details in a single
 * UPDATE, so the stage and the money can never be saved separately.
 * Returns the server row, which carries the DB-computed commission_amount
 * and sold_at. Also used to correct an already-sold lead's figures. */
export async function saveSale(leadId: string, input: SaleInput): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update({ status: 'sold', sale_amount: input.saleAmount, commission_rate: input.commissionRate })
    .eq('id', leadId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Lead;
}
