"""
Discounts Module [Vrindha].
Provides discount rule engine domain models, schemas, service, and API endpoints.
"""
from app.modules.discounts.models import (
    DiscountProduct,
    DiscountRedemption,
    DiscountRule,
    DiscountScope,
    DiscountType,
)
from app.modules.discounts.router import router as discounts_router
from app.modules.discounts.schemas import (
    DiscountEvaluationRequest,
    DiscountEvaluationResponse,
    DiscountRedemptionItem,
    DiscountRuleBase,
    DiscountRuleCreate,
    DiscountRuleResponse,
    DiscountRuleUpdate,
    DiscountUsageResponse,
    LineItemForEvaluation,
)
from app.modules.discounts.service import DiscountService

__all__ = [
    # Models
    "DiscountRule",
    "DiscountProduct",
    "DiscountRedemption",
    "DiscountType",
    "DiscountScope",
    # Schemas
    "DiscountRuleBase",
    "DiscountRuleCreate",
    "DiscountRuleUpdate",
    "DiscountRuleResponse",
    "DiscountUsageResponse",
    "DiscountRedemptionItem",
    "DiscountEvaluationRequest",
    "DiscountEvaluationResponse",
    "LineItemForEvaluation",
    # Service
    "DiscountService",
    # Router
    "discounts_router",
]

