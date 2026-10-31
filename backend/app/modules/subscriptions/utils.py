"""
Date Calculations, Sequencing, and Financial Utilities for Subscriptions [PDF 5.6, 7.2].
Owned by Vrindha.

Provides:
- calculate_next_billing_date: Calendar month-end clamping with anchor_day stabilization
  (e.g., Jan 31 -> Feb 28/29 -> Mar 31 without progressive date drift).
- calculate_billing_period_range: Period start/end boundaries for invoices.
- generate_subscription_number: Formatted sequence generator (e.g., SUB-2026-000001).
- Financial recalculation helpers for line items and totals.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, Optional, Sequence, Tuple


# Set of recognized billing periods (normalized to lowercase)
SUPPORTED_PERIODS = {
    "daily": "daily",
    "day": "daily",
    "weekly": "weekly",
    "week": "weekly",
    "monthly": "monthly",
    "month": "monthly",
    "yearly": "yearly",
    "year": "yearly",
    "annual": "yearly",
    "annually": "yearly",
}


def calculate_next_billing_date(
    current_date: date,
    billing_period: str,
    anchor_day: int,
) -> date:
    """
    Computes the next billing date advancing from `current_date` by `billing_period`,
    stabilized against calendar month-end clamping using `anchor_day`.

    Guarantees zero month-end date drift:
    - If anchor_day = 31 and the next month is February (non-leap), clamped to Feb 28.
    - When calculating the subsequent month from Feb 28 with anchor_day = 31, advances
      to March 31 (anchor_day is preserved).
    - In leap years, Feb clamps to Feb 29.
    - Yearly intervals preserve month and anchor day (e.g. Feb 29 in leap year clamps to Feb 28
      in non-leap year and returns to Feb 29 in leap year).
    - Weekly advances strictly by 7 days.
    - Daily advances strictly by 1 day.

    Args:
        current_date: The baseline reference date.
        billing_period: 'daily', 'weekly', 'monthly', or 'yearly' (case-insensitive).
        anchor_day: Day of month (1 to 31) originally established by the subscription.

    Returns:
        The computed next billing date.

    Raises:
        ValueError: If anchor_day is not between 1 and 31, or if billing_period is unrecognized.
    """
    if not isinstance(anchor_day, int) or not (1 <= anchor_day <= 31):
        raise ValueError(
            f"Invalid anchor_day: {anchor_day}. Must be an integer between 1 and 31."
        )

    norm_period = billing_period.strip().lower()
    period_type = SUPPORTED_PERIODS.get(norm_period)

    if not period_type:
        raise ValueError(
            f"Unsupported billing period: '{billing_period}'. "
            f"Supported periods are: 'daily', 'weekly', 'monthly', 'yearly'."
        )

    if period_type == "daily":
        return current_date + timedelta(days=1)

    if period_type == "weekly":
        return current_date + timedelta(days=7)

    if period_type == "monthly":
        # Advance 1 calendar month
        if current_date.month == 12:
            target_year = current_date.year + 1
            target_month = 1
        else:
            target_year = current_date.year
            target_month = current_date.month + 1

        # Determine maximum number of days in target month
        _, max_days_in_month = calendar.monthrange(target_year, target_month)
        # Clamp anchor_day to month-end if anchor_day exceeds month length
        target_day = min(anchor_day, max_days_in_month)
        return date(target_year, target_month, target_day)

    if period_type == "yearly":
        # Advance 1 calendar year, keeping target month
        target_year = current_date.year + 1
        target_month = current_date.month

        # Clamp if anchor_day exceeds target month (e.g. leap day Feb 29 -> Feb 28)
        _, max_days_in_month = calendar.monthrange(target_year, target_month)
        target_day = min(anchor_day, max_days_in_month)
        return date(target_year, target_month, target_day)

    raise ValueError(f"Unhandled billing period: {billing_period}")


def calculate_billing_period_range(
    start_date: date,
    billing_period: str,
    anchor_day: int,
) -> Tuple[date, date]:
    """
    Calculates the exact billing cycle start and end boundaries for an invoice.

    Args:
        start_date: Beginning of billing cycle.
        billing_period: Recurring interval string ('daily', 'weekly', 'monthly', 'yearly').
        anchor_day: Day of month anchor (1-31).

    Returns:
        Tuple of (period_start, period_end).
    """
    period_start = start_date
    period_end = calculate_next_billing_date(start_date, billing_period, anchor_day)
    return period_start, period_end


def generate_subscription_number(
    seq_val: int,
    prefix: str = "SUB",
    year: Optional[int] = None,
) -> str:
    """
    Generates a standardized human-readable subscription identifier.
    Format:
    - With year: "SUB-2026-000001"
    - Without year: "SUB-00001"

    Args:
        seq_val: Sequence number from sequence or auto-increment integer.
        prefix: Code prefix, default "SUB".
        year: Optional calendar year, defaults to current UTC year.

    Returns:
        Formatted identifier string.
    """
    if year is None:
        year = datetime.utcnow().year
    return f"{prefix}-{year}-{seq_val:06d}"


def calculate_line_amounts(
    quantity: int,
    unit_price: Decimal,
    tax_rate: Decimal = Decimal("0.0000"),
    discount_amount: Decimal = Decimal("0.00"),
) -> Dict[str, Decimal]:
    """
    Calculates line-level financial breakdown: subtotal, discount, tax, and total.

    Formula:
    - subtotal = quantity * unit_price
    - taxable_base = max(0, subtotal - discount_amount)
    - tax_amount = taxable_base * (tax_rate / 100)
    - total = taxable_base + tax_amount

    Args:
        quantity: Contracted line quantity.
        unit_price: Unit price per recurring cycle.
        tax_rate: Tax percentage (e.g. 18.0 for 18%).
        discount_amount: Line-level discount reduction.

    Returns:
        Dictionary with keys: 'subtotal', 'discount_amount', 'tax_amount', 'total'.
    """
    qty = Decimal(str(quantity))
    price = Decimal(str(unit_price))
    tax_pct = Decimal(str(tax_rate))
    disc = Decimal(str(discount_amount))

    subtotal = (qty * price).quantize(Decimal("0.01"))
    taxable_base = max(Decimal("0.00"), subtotal - disc)
    tax_amount = (taxable_base * (tax_pct / Decimal("100.0"))).quantize(Decimal("0.01"))
    total = (taxable_base + tax_amount).quantize(Decimal("0.01"))

    return {
        "subtotal": subtotal,
        "discount_amount": disc.quantize(Decimal("0.01")),
        "tax_amount": tax_amount,
        "total": total,
    }


def calculate_subscription_totals(
    lines: Sequence[Any],
) -> Dict[str, Decimal]:
    """
    Aggregates financial totals from a sequence of line items.

    Args:
        lines: Iterable of SubscriptionLine instances or dictionaries.

    Returns:
        Dict with keys: 'subtotal', 'discount_amount', 'tax_amount', 'total_amount'.
    """
    subtotal = Decimal("0.00")
    discount_total = Decimal("0.00")
    tax_total = Decimal("0.00")
    total_amount = Decimal("0.00")

    for line in lines:
        if isinstance(line, dict):
            subtotal += Decimal(str(line.get("subtotal", 0)))
            discount_total += Decimal(str(line.get("discount_amount", 0)))
            tax_total += Decimal(str(line.get("tax_amount", 0)))
            total_amount += Decimal(str(line.get("total", 0)))
        else:
            subtotal += Decimal(str(getattr(line, "subtotal", 0)))
            discount_total += Decimal(str(getattr(line, "discount_amount", 0)))
            # Compute tax if tax_amount attribute doesn't exist directly on line
            if hasattr(line, "tax_amount"):
                tax_total += Decimal(str(line.tax_amount))
            elif hasattr(line, "tax_rate"):
                taxable = max(Decimal("0.00"), Decimal(str(line.subtotal)) - Decimal(str(line.discount_amount)))
                line_tax = taxable * (Decimal(str(line.tax_rate)) / Decimal("100.0"))
                tax_total += line_tax
            total_amount += Decimal(str(getattr(line, "total", 0)))

    return {
        "subtotal": subtotal.quantize(Decimal("0.01")),
        "discount_amount": discount_total.quantize(Decimal("0.01")),
        "tax_amount": tax_total.quantize(Decimal("0.01")),
        "total_amount": total_amount.quantize(Decimal("0.01")),
    }

