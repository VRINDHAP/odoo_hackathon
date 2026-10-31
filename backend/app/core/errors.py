"""
Domain Exception Hierarchy and Standardized JSON Error Response Handlers.
Guarantees consistent error body across all endpoints [PDF 8]:
{
    "code": "ERROR_CODE",
    "message": "Human readable explanation",
    "fields": [{"field": "field_name", "message": "specific error"}]
}
"""
import logging
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class AppException(Exception):
    """Base application exception with structured code, status, and field errors."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        fields: Optional[List[Dict[str, str]]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.fields = fields or []


class NotFoundError(AppException):
    """Resource not found (HTTP 404)."""

    def __init__(self, resource: str, identifier: Any):
        super().__init__(
            code="NOT_FOUND",
            message=f"{resource} with identifier '{identifier}' was not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class ConflictError(AppException):
    """State transition conflict or duplicate resource (HTTP 409) [PDF 6.1, 8]."""

    def __init__(self, message: str, code: str = "CONFLICT"):
        super().__init__(
            code=code,
            message=message,
            status_code=status.HTTP_409_CONFLICT,
        )


class ValidationError(AppException):
    """Business rule or input validation failure (HTTP 422)."""

    def __init__(self, message: str, fields: Optional[List[Dict[str, str]]] = None):
        super().__init__(
            code="VALIDATION_ERROR",
            message=message,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            fields=fields or [],
        )


class UnauthorizedError(AppException):
    """Authentication required or token invalid/expired (HTTP 401)."""

    def __init__(self, message: str = "Authentication required or token invalid"):
        super().__init__(
            code="UNAUTHORIZED",
            message=message,
            status_code=status.HTTP_401_UNAUTHORIZED,
        )


class ForbiddenError(AppException):
    """Insufficient privileges (HTTP 403)."""

    def __init__(self, message: str = "Access forbidden: insufficient permissions"):
        super().__init__(
            code="FORBIDDEN",
            message=message,
            status_code=status.HTTP_403_FORBIDDEN,
        )


class BadRequestError(AppException):
    """Malformed request or invalid operation (HTTP 400)."""

    def __init__(self, message: str, code: str = "BAD_REQUEST"):
        super().__init__(
            code=code,
            message=message,
            status_code=status.HTTP_400_BAD_REQUEST,
        )


def setup_exception_handlers(app: FastAPI) -> None:
    """Configures global exception handlers to produce standard response envelope."""

    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": exc.message,
                "fields": exc.fields,
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        field_errors = []
        for error in exc.errors():
            loc = ".".join(str(item) for item in error.get("loc", []) if item != "body")
            field_errors.append({
                "field": loc or "non_field_error",
                "message": error.get("msg", "Invalid value"),
            })
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "code": "VALIDATION_ERROR",
                "message": "Input validation failed. Please check the supplied fields.",
                "fields": field_errors,
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        code_map = {
            400: "BAD_REQUEST",
            401: "UNAUTHORIZED",
            403: "FORBIDDEN",
            404: "NOT_FOUND",
            405: "METHOD_NOT_ALLOWED",
            409: "CONFLICT",
            422: "VALIDATION_ERROR",
            500: "INTERNAL_ERROR",
        }
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": code_map.get(exc.status_code, "HTTP_ERROR"),
                "message": str(exc.detail),
                "fields": [],
            },
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error(f"Unhandled exception processing {request.method} {request.url}: {exc}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred. Please contact system support.",
                "fields": [],
            },
        )
