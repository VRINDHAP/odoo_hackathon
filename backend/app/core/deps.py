"""
FastAPI Dependency Injection Providers.
Includes Database Session provider and standard Pagination query parameters.
"""
from typing import Generator
from fastapi import Query
from sqlalchemy.orm import Session
from app.core.db import get_db


class PaginationParams:
    """Standardized server-side pagination dependency [PDF 11]."""

    def __init__(
        self,
        page: int = Query(1, ge=1, description="Page number starting at 1"),
        page_size: int = Query(20, ge=1, le=100, description="Items per page (max 100)"),
    ):
        self.page = page
        self.page_size = page_size
        self.skip = (page - 1) * page_size
        self.limit = page_size
