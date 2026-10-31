"""
Domain Exceptions for Payments & Balance Management [PDF 5.9, 7.2, 8].
Owned by Vrindha.
"""
from fastapi import status
from app.core.errors import AppException


class OverpaymentException(AppException):
    """Raised when payment amount exceeds the remaining invoice balance (HTTP 400)."""

    def __init__(self, message: str = "Payment amount exceeds remaining invoice balance."):
        super().__init__(
            code="OVERPAYMENT",
            message=message,
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class InvalidInvoiceStatusException(AppException):
    """Raised when attempting payment on an invoice in draft or cancelled state (HTTP 400)."""

    def __init__(self, message: str = "Payments can only be recorded on confirmed or unpaid invoices."):
        super().__init__(
            code="INVALID_INVOICE_STATUS",
            message=message,
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class PaymentAlreadyReversedException(AppException):
    """Raised when attempting to reverse a payment that is already reversed or failed (HTTP 400)."""

    def __init__(self, message: str = "Payment has already been reversed or cannot be reversed."):
        super().__init__(
            code="PAYMENT_ALREADY_REVERSED",
            message=message,
            status_code=status.HTTP_400_BAD_REQUEST,
        )

