# -*- coding: utf-8 -*-
"""Cleanup coverage for the final database doctor shim removal slice."""

from __future__ import annotations

import unittest
from pathlib import Path

import src.database_doctor as database_doctor
import src.database_doctor_smoke as database_doctor_smoke


class DatabaseDoctorCleanupTestCase(unittest.TestCase):
    def test_legacy_shim_paths_are_removed(self) -> None:
        repo_root = Path(__file__).resolve().parent.parent

        self.assertFalse((repo_root / "src" / "experimental").exists())
        self.assertFalse((repo_root / "scripts" / "database_doctor_experimental.py").exists())

    def test_smoke_module_exports_only_formal_entrypoints(self) -> None:
        for legacy_name in (
            "build_experimental_database_doctor_report",
            "build_experimental_database_real_pg_bundle_report",
            "experimental_database_doctor_reporting",
            "build_database_doctor_report_with_split_modules",
            "build_database_real_pg_bundle_report_with_split_modules",
            "database_doctor_reporting_with_split_modules",
        ):
            self.assertFalse(hasattr(database_doctor_smoke, legacy_name), legacy_name)

        self.assertTrue(callable(database_doctor_smoke.build_database_doctor_smoke_report))
        self.assertTrue(callable(database_doctor_smoke.build_database_real_pg_bundle_smoke_report))

    def test_doctor_module_exports_no_experimental_aliases(self) -> None:
        for legacy_name in (
            "build_experimental_database_doctor_report",
            "build_experimental_database_real_pg_bundle_report",
            "experimental_database_doctor_reporting",
            "build_database_doctor_report_with_split_modules",
            "build_database_real_pg_bundle_report_with_split_modules",
            "database_doctor_reporting_with_split_modules",
        ):
            self.assertFalse(hasattr(database_doctor, legacy_name), legacy_name)

        self.assertTrue(callable(database_doctor.build_database_doctor_report))
        self.assertTrue(callable(database_doctor.build_database_real_pg_bundle_report))


if __name__ == "__main__":
    unittest.main()
