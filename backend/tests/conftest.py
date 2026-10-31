"""
Pytest configuration and environment fixtures.
Ensures backend workspace packages and modules are in sys.path.
"""
import sys
import os

packages_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".packages"))
if os.path.exists(packages_path) and packages_path not in sys.path:
    sys.path.insert(0, packages_path)

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)
