"""
Discount Rule Engine Service Layer [PDF 5.8, 7.3].
Owned by Vrindha.

Implements:
- Automated Discount Evaluation (evaluate_discount) selecting the optimal (highest relief) discount rule.
- Scope-aware calculation (Subscription vs Product scope).
- Atomic redemption (redeem_discount_atomic) using DB-level compare-and-increment to guarantee zero race condition overages.
- Safe release (release_discount_redemption) reversing redemptions on invoice cancellation.
- Full Admin CRUD and telemetry reporting.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional, Sequence, Tuple, Union
import uuid

from sqlalchemy import desc, func, or_, text
from sqlalchemy.orm import Session

from app.core.errors import BadRequestError, ConflictError, NotFoundError
from app.modules.discounts.models import (
    DiscountProduct,
    DiscountRedemption,
    DiscountRule,
    DiscountScope,
    DiscountType,
)
from app.modules.discounts.schemas import (
    DiscountRedemptionItem,
    DiscountRuleCreate,
    DiscountRuleUpdate,
    DiscountUsageResponse,
)

logger = logging.getLogger(__name__)


class DiscountService:
    """
    Core Discount Evaluation and Usage Management Service [PDF 5.8, 7.3].
    """

    # ========================================================================
    # RULE EVALUATION ENGINE [PDF 7.3]
    # ========================================================================

    @classmethod
    def evaluate_discount(
        cls,
        subtotal: Decimal,
        lines: Sequence[Any],
        invoice_date: date,
        db: Session,
    ) -> Optional[Tuple[DiscountRule, Decimal]]:
        """
        Evaluates all active discount rules against an invoice/quote subtotal and lines [PDF 7.3].

        Algorithm:
        1. Query active rules where start_date <= invoice_date <= end_date.
        2. Ensure usage_limit IS NULL OR usage_count < usage_limit.
        3. Enforce min_purchase_amount and min_quantity guards.
        4. Apply scope rules:
           - 'subscription': Relief evaluated against the overall subtotal.
           - 'product': Relief evaluated strictly against eligible line item subtotals.
        5. Computes percent or fixed relief, ensuring subtotal is never exceeded.
        6. Selects the rule providing the maximum relief (highest discount for the customer).

        Returns:
            Tuple of (winning_rule, discount_amount) or None if no discount qualifies.
        """
        subtotal_dec = Decimal(str(subtotal)).quantize(Decimal("0.01"))
        if subtotal_dec <= Decimal("0.00"):
            return None

        # Calculate total line quantity
        total_quantity = 0
        for line in lines:
            total_quantity += int(getattr(line, "quantity", 1) if not isinstance(line, dict) else line.get("quantity", 1))

        # Query all active candidates within the calendar window
        candidates = (
            db.query(DiscountRule)
            .filter(
                DiscountRule.is_active.is_(True),
                DiscountRule.start_date <= invoice_date,
                DiscountRule.end_date >= invoice_date,
                or_(
                    DiscountRule.usage_limit.is_(None),
                    DiscountRule.usage_count < DiscountRule.usage_limit,
                ),
            )
            .all()
        )

        best_rule: Optional[DiscountRule] = None
        best_amount: Decimal = Decimal("0.00")

        for rule in candidates:
            # Check minimum purchase threshold
            if subtotal_dec < rule.min_purchase_amount:
                continue

            # Check minimum quantity threshold
            if total_quantity < rule.min_quantity:
                continue

            applicable_subtotal: Decimal = Decimal("0.00")

            if rule.scope == DiscountScope.PRODUCT:
                # Get IDs of eligible products for this rule
                eligible_product_ids = {p.product_id for p in rule.products}
                if not eligible_product_ids:
                    continue

                # Sum subtotals of lines matching eligible products
                matching_lines_subtotal = Decimal("0.00")
                for line in lines:
                    pid = getattr(line, "product_id", None) if not isinstance(line, dict) else line.get("product_id")
                    if pid and str(pid) in eligible_product_ids:
                        if isinstance(line, dict):
                            l_sub = line.get("subtotal")
                            if l_sub is not None:
                                matching_lines_subtotal += Decimal(str(l_sub))
                            else:
                                qty = Decimal(str(line.get("quantity", 1)))
                                prc = Decimal(str(line.get("unit_price", 0)))
                                matching_lines_subtotal += qty * prc
                        else:
                            l_sub = getattr(line, "subtotal", None)
                            if l_sub is not None:
                                matching_lines_subtotal += Decimal(str(l_sub))
                            else:
                                qty = Decimal(str(getattr(line, "quantity", 1)))
                                prc = Decimal(str(getattr(line, "unit_price", 0)))
                                matching_lines_subtotal += qty * prc

                if matching_lines_subtotal <= Decimal("0.00"):
                    continue

                applicable_subtotal = matching_lines_subtotal.quantize(Decimal("0.01"))

            else:
                # Subscription scope covers entire subtotal
                applicable_subtotal = subtotal_dec

            # Calculate financial relief amount
            if rule.type == DiscountType.PERCENT:
                rate = Decimal(str(rule.value)) / Decimal("100.0")
                relief = (applicable_subtotal * rate).quantize(Decimal("0.01"))
            elif rule.type == DiscountType.FIXED:
                fixed_val = Decimal(str(rule.value)).quantize(Decimal("0.01"))
                relief = min(fixed_val, applicable_subtotal)
            else:
                relief = Decimal("0.00")

            # Never allow discount relief to exceed overall subtotal
            relief = min(relief, subtotal_dec)

            if relief > best_amount:
                best_amount = relief
                best_rule = rule

        if best_rule and best_amount > Decimal("0.00"):
            return best_rule, best_amount

        return None

    # ========================================================================
    # ATOMIC USAGE & REDEMPTIONS [PDF 5.8, 7.3]
    # ========================================================================

    @classmethod
    def redeem_discount_atomic(
        cls,
        discount_id: Union[str, uuid.UUID],
        invoice_id: Optional[Union[str, uuid.UUID]],
        subscription_id: Optional[Union[str, uuid.UUID]],
        amount: Decimal,
        db: Session,
    ) -> bool:
        """
        Atomically records a discount redemption and increments usage count [PDF 7.3].

        Guarantees zero race conditions under concurrent billing runs via:
        `UPDATE discount_rules SET usage_count = usage_count + 1 WHERE id = :id AND (usage_limit IS NULL OR usage_count < usage_limit)`
        """
        disc_id_str = str(discount_id)
        inv_id_str = str(invoice_id) if invoice_id else None
        sub_id_str = str(subscription_id) if subscription_id else None
        amount_dec = Decimal(str(amount)).quantize(Decimal("0.01"))

        # Atomic increment query
        stmt = text(
            "UPDATE discount_rules "
            "SET usage_count = usage_count + 1, updated_at = :now "
            "WHERE id = :id AND is_active = :is_active "
            "AND (usage_limit IS NULL OR usage_count < usage_limit)"
        )
        res = db.execute(
            stmt,
            {
                "id": disc_id_str,
                "is_active": True,
                "now": datetime.utcnow(),
            },
        )

        if res.rowcount == 0:
            logger.warning(
                f"Atomic discount redemption failed for rule '{disc_id_str}': limit reached or rule inactive."
            )
            return False

        # Record redemption audit row
        redemption = DiscountRedemption(
            id=str(uuid.uuid4()),
            discount_id=disc_id_str,
            invoice_id=inv_id_str,
            subscription_id=sub_id_str,
            amount=amount_dec,
            created_at=datetime.utcnow(),
        )
        db.add(redemption)
        db.flush()
        return True

    @classmethod
    def release_discount_redemption(
        cls,
        discount_id: Union[str, uuid.UUID],
        invoice_id: Union[str, uuid.UUID],
        db: Session,
    ) -> bool:
        """
        Reverses a discount redemption on invoice cancellation [PDF 5.8, 16].
        Deletes the redemption row and safely decrements rule usage_count.
        """
        disc_id_str = str(discount_id)
        inv_id_str = str(invoice_id)

        redemption = (
            db.query(DiscountRedemption)
            .filter(
                DiscountRedemption.discount_id == disc_id_str,
                DiscountRedemption.invoice_id == inv_id_str,
            )
            .first()
        )

        if not redemption:
            return False

        db.delete(redemption)

        # Safely decrement usage count (floor at 0)
        stmt = text(
            "UPDATE discount_rules "
            "SET usage_count = CASE WHEN usage_count > 0 THEN usage_count - 1 ELSE 0 END, updated_at = :now "
            "WHERE id = :id"
        )
        db.execute(stmt, {"id": disc_id_str, "now": datetime.utcnow()})
        db.flush()
        logger.info(f"Released discount redemption for rule '{disc_id_str}' on cancelled invoice '{inv_id_str}'.")
        return True

    # ========================================================================
    # ADMIN CRUD METHODS [PDF 2, 8]
    # ========================================================================

    @classmethod
    def create_discount_rule(
        cls,
        db: Session,
        request: DiscountRuleCreate,
    ) -> DiscountRule:
        """Creates a new discount rule with optional product bindings."""
        rule = DiscountRule(
            id=str(uuid.uuid4()),
            name=request.name.strip(),
            type=request.type,
            value=request.value,
            min_purchase_amount=request.min_purchase_amount,
            min_quantity=request.min_quantity,
            start_date=request.start_date,
            end_date=request.end_date,
            usage_limit=request.usage_limit,
            scope=request.scope,
            is_active=request.is_active,
            usage_count=0,
        )

        if request.scope == DiscountScope.PRODUCT and request.product_ids:
            for pid in request.product_ids:
                rule.products.append(DiscountProduct(discount_id=rule.id, product_id=pid))

        db.add(rule)
        db.commit()
        db.refresh(rule)
        return rule

    @classmethod
    def get_discount_rule(cls, db: Session, rule_id: str) -> DiscountRule:
        """Fetches rule by ID."""
        rule = db.query(DiscountRule).filter(DiscountRule.id == str(rule_id)).first()
        if not rule:
            raise NotFoundError("DiscountRule", rule_id)
        return rule

    @classmethod
    def list_discount_rules(
        cls,
        db: Session,
        active_only: bool = False,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[DiscountRule], int]:
        """Lists discount rules with pagination and status filters."""
        query = db.query(DiscountRule)
        if active_only:
            query = query.filter(DiscountRule.is_active.is_(True))

        total = query.count()
        results = query.order_by(desc(DiscountRule.created_at)).offset(skip).limit(limit).all()
        return results, total

    @classmethod
    def update_discount_rule(
        cls,
        db: Session,
        rule_id: str,
        request: DiscountRuleUpdate,
    ) -> DiscountRule:
        """Modifies discount rule configuration."""
        rule = cls.get_discount_rule(db, rule_id)

        update_data = request.model_dump(exclude_unset=True)

        if "product_ids" in update_data:
            new_pids = update_data.pop("product_ids") or []
            # Replace existing product associations
            rule.products.clear()
            for pid in new_pids:
                rule.products.append(DiscountProduct(discount_id=rule.id, product_id=pid))

        for field_name, value in update_data.items():
            setattr(rule, field_name, value)

        rule.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(rule)
        return rule

    @classmethod
    def get_discount_usage(cls, db: Session, rule_id: str) -> DiscountUsageResponse:
        """Generates real-time usage statistics and redemption history."""
        rule = cls.get_discount_rule(db, rule_id)

        total_relieved = (
            db.query(func.coalesce(func.sum(DiscountRedemption.amount), Decimal("0.00")))
            .filter(DiscountRedemption.discount_id == rule.id)
            .scalar()
        )

        redemptions = (
            db.query(DiscountRedemption)
            .filter(DiscountRedemption.discount_id == rule.id)
            .order_by(desc(DiscountRedemption.created_at))
            .limit(100)
            .all()
        )

        rem_uses = None
        if rule.usage_limit is not None:
            rem_uses = max(0, rule.usage_limit - rule.usage_count)

        is_reached = rule.usage_limit is not None and rule.usage_count >= rule.usage_limit

        return DiscountUsageResponse(
            discount_id=rule.id,
            name=rule.name,
            usage_count=rule.usage_count,
            usage_limit=rule.usage_limit,
            is_limit_reached=is_reached,
            remaining_uses=rem_uses,
            total_discount_amount=Decimal(str(total_relieved)).quantize(Decimal("0.01")),
            redemptions=[
                DiscountRedemptionItem(
                    id=r.id,
                    discount_id=r.discount_id,
                    invoice_id=r.invoice_id,
                    subscription_id=r.subscription_id,
                    amount=r.amount,
                    created_at=r.created_at,
                )
                for r in redemptions
            ],
        )

