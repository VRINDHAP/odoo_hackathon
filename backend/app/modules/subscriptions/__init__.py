"""
Subscriptions Module [Vrindha].
Provides domain models, schemas, and date utility functions for recurring subscriptions.
"""
from app.modules.subscriptions.models import (
    Subscription,
    SubscriptionLine,
    SubscriptionStatus,
)
from app.modules.subscriptions.schemas import (
    SubscriptionBase,
    SubscriptionCloseRequest,
    SubscriptionCreate,
    SubscriptionDetailResponse,
    SubscriptionLineBase,
    SubscriptionLineCreate,
    SubscriptionLineResponse,
    SubscriptionLineUpdate,
    SubscriptionPauseRequest,
    SubscriptionRenewRequest,
    SubscriptionResponse,
    SubscriptionResumeRequest,
    SubscriptionTransitionRequest,
    SubscriptionUpdate,
)
from app.modules.subscriptions.utils import (
    calculate_billing_period_range,
    calculate_line_amounts,
    calculate_next_billing_date,
    calculate_subscription_totals,
    generate_subscription_number,
)

__all__ = [
    # Models
    "Subscription",
    "SubscriptionLine",
    "SubscriptionStatus",
    # Schemas
    "SubscriptionBase",
    "SubscriptionCreate",
    "SubscriptionUpdate",
    "SubscriptionResponse",
    "SubscriptionDetailResponse",
    "SubscriptionLineBase",
    "SubscriptionLineCreate",
    "SubscriptionLineUpdate",
    "SubscriptionLineResponse",
    "SubscriptionTransitionRequest",
    "SubscriptionPauseRequest",
    "SubscriptionResumeRequest",
    "SubscriptionCloseRequest",
    "SubscriptionRenewRequest",
    # Utils
    "calculate_next_billing_date",
    "calculate_billing_period_range",
    "generate_subscription_number",
    "calculate_line_amounts",
    "calculate_subscription_totals",
]

