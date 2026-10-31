"""
Subscriptions Module [Vrindha].
Provides domain models, schemas, state machine service, and API routers.
"""
from app.modules.subscriptions.exceptions import (
    InvalidStateTransitionException,
    PlanPolicyViolationException,
    QuotationExpiredException,
)
from app.modules.subscriptions.models import (
    Subscription,
    SubscriptionLine,
    SubscriptionStatus,
)
from app.modules.subscriptions.router import router as subscriptions_router
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
from app.modules.subscriptions.service import (
    PlanPolicy,
    SubscriptionService,
    get_plan_policy,
    register_plan_policy,
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
    # Exceptions
    "InvalidStateTransitionException",
    "QuotationExpiredException",
    "PlanPolicyViolationException",
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
    # Service
    "SubscriptionService",
    "PlanPolicy",
    "get_plan_policy",
    "register_plan_policy",
    # Router
    "subscriptions_router",
    # Utils
    "calculate_next_billing_date",
    "calculate_billing_period_range",
    "generate_subscription_number",
    "calculate_line_amounts",
    "calculate_subscription_totals",
]
