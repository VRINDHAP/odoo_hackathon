"""
Domain Exceptions for Subscriptions Engine [PDF 6.1, 8].
Owned by Vrindha.

Provides HTTP-mapped application exceptions for:
- InvalidStateTransitionException (HTTP 409 Conflict): Illegal lifecycle transitions.
- QuotationExpiredException (HTTP 400 Bad Request): Attempting to confirm an expired quote.
- PlanPolicyViolationException (HTTP 400 Bad Request): Violations of plan configuration policies.
"""
from typing import Any, Dict, List, Optional
from fastapi import status
from app.core.errors import AppException


class InvalidStateTransitionException(AppException):
    """
    State machine transition rejection (HTTP 409 Conflict) [PDF 6.1, 8].
    Raised when an action attempts an illegal status transition in the lifecycle matrix.
    """

    def __init__(
        self,
        current_state: Any,
        target_state: Any,
        reason: Optional[str] = None,
    ):
        curr = getattr(current_state, "value", str(current_state))
        targ = getattr(target_state, "value", str(target_state))
        detail = (
            f"Cannot transition subscription from '{curr}' to '{targ}'."
            + (f" Reason: {reason}" if reason else "")
        )
        super().__init__(
            code="INVALID_STATE_TRANSITION",
            message=detail,
            status_code=status.HTTP_409_CONFLICT,
            fields=[
                {"field": "current_status", "message": curr},
                {"field": "target_status", "message": targ},
            ],
        )


class QuotationExpiredException(AppException):
    """
    Quotation deadline expiration (HTTP 400 Bad Request) [PDF 6.1, 8].
    Raised when attempting to confirm a quotation after quotation_expires_at has passed.
    """

    def __init__(self, expires_at: Any, current_date: Any):
        detail = (
            f"Quotation has expired on {expires_at}. "
            f"Current date is {current_date}. It cannot be confirmed."
        )
        super().__init__(
            code="QUOTATION_EXPIRED",
            message=detail,
            status_code=status.HTTP_400_BAD_REQUEST,
            fields=[{"field": "quotation_expires_at", "message": str(expires_at)}],
        )


class PlanPolicyViolationException(AppException):
    """
    Plan Policy Guard Violation (HTTP 400 Bad Request) [PDF 5.4, 6.1, 8].
    Raised when a requested action contradicts plan rules:
    - Pausing when plan.pausable == False
    - Closing when plan.closable == False
    - Renewing when plan.renewable == False
    - Quantity below plan.min_quantity
    """

    def __init__(self, policy_rule: str, detail: Optional[str] = None):
        msg = f"Operation violates plan policy: '{policy_rule}'."
        if detail:
            msg += f" {detail}"
        super().__init__(
            code="PLAN_POLICY_VIOLATION",
            message=msg,
            status_code=status.HTTP_400_BAD_REQUEST,
            fields=[{"field": "policy_rule", "message": policy_rule}],
        )
