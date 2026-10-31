"""
Brightloop Subscription Management System - Backend Application Package.
"""
import sys
import os

_packages_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".packages"))
if os.path.exists(_packages_path) and _packages_path not in sys.path:
    sys.path.insert(0, _packages_path)
