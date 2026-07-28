from decimal import Decimal

import pytest

from src.portfolio_exact_numeric import (
    PortfolioExactNumericError,
    PortfolioNumericKind,
    PortfolioPrecisionError,
    normalize_legacy_portfolio_decimal,
    normalize_portfolio_value,
    parse_portfolio_decimal,
    portfolio_decimal_equal,
    portfolio_values_equal,
    round_portfolio_decimal_value,
    serialize_portfolio_decimal_value,
    serialize_portfolio_value,
)


def test_currency_money_precision_uses_the_reviewed_minor_unit_registry() -> None:
    assert parse_portfolio_decimal("12.30", kind="money", currency="usd") == Decimal("12.30")
    assert parse_portfolio_decimal("12", kind="money", currency="JPY") == Decimal("12")
    assert serialize_portfolio_decimal_value("12.30", kind="money", currency="USD") == "12.30"
    assert serialize_portfolio_decimal_value("12", kind="money", currency="JPY") == "12"
    for currency in ("INR", "SEK", "TWD"):
        assert parse_portfolio_decimal("12.30", kind="money", currency=currency) == Decimal("12.30")
        assert serialize_portfolio_decimal_value("12.30", kind="money", currency=currency) == "12.30"
        assert round_portfolio_decimal_value("1.225", kind="money", currency=currency) == Decimal("1.22")


@pytest.mark.parametrize("market", ("cn", "hk", "us", "global"))
def test_asset_quantity_and_price_precision_use_the_market_registry(market: str) -> None:
    expected = Decimal("1.12345678")
    assert parse_portfolio_decimal("1.12345678", kind="quantity", market=market) == expected
    assert parse_portfolio_decimal("1.12345678", kind="price", market=market) == expected


def test_fx_precision_and_half_even_derived_rounding_are_explicit() -> None:
    assert parse_portfolio_decimal(
        "7.12345678",
        kind="fx_rate",
        from_currency="USD",
        to_currency="CNY",
    ) == Decimal("7.12345678")
    assert round_portfolio_decimal_value("1.225", kind="money", currency="USD") == Decimal("1.22")
    assert round_portfolio_decimal_value("1.235", kind="money", currency="USD") == Decimal("1.24")


@pytest.mark.parametrize(
    ("kwargs", "value"),
    (
        ({"kind": "money", "currency": "XYZ"}, "1.00"),
        ({"kind": "quantity", "market": "crypto"}, "1"),
        ({"kind": "unknown", "currency": "USD"}, "1"),
        ({"kind": "fx_rate", "from_currency": "USD", "to_currency": "XYZ"}, "1"),
    ),
)
def test_unknown_precision_context_fails_closed(kwargs: dict[str, str], value: str) -> None:
    with pytest.raises(PortfolioPrecisionError):
        parse_portfolio_decimal(value, **kwargs)


@pytest.mark.parametrize(
    "value",
    (0.1, True, "NaN", "Infinity", "1e-2", "not-a-number", "1.234"),
)
def test_public_ingress_rejects_binary_or_malformed_or_excess_precision(value: object) -> None:
    with pytest.raises(PortfolioExactNumericError):
        parse_portfolio_decimal(value, kind="money", currency="USD")


def test_public_equality_is_exact_at_the_resolved_quantum() -> None:
    assert portfolio_decimal_equal("1.20", "1.2", kind="money", currency="USD")
    assert not portfolio_decimal_equal("1.20", "1.21", kind="money", currency="USD")


def test_legacy_float_conversion_is_explicit_and_uses_storage_scale() -> None:
    assert normalize_legacy_portfolio_decimal(0.1) == Decimal("0.10000000")


def test_stable_policy_api_uses_named_kinds_and_rejects_binary_float() -> None:
    assert normalize_portfolio_value(
        "1.20",
        kind=PortfolioNumericKind.MONEY,
        currency="USD",
    ) == Decimal("1.20")
    assert serialize_portfolio_value(
        "1.20",
        kind=PortfolioNumericKind.MONEY,
        currency="USD",
    ) == "1.20"
    assert portfolio_values_equal(
        "1.20",
        "1.2",
        kind=PortfolioNumericKind.MONEY,
        currency="USD",
    )
    with pytest.raises(PortfolioExactNumericError):
        normalize_portfolio_value(1.2, kind=PortfolioNumericKind.MONEY, currency="USD")
    with pytest.raises(PortfolioExactNumericError):
        normalize_portfolio_value("1.234", kind=PortfolioNumericKind.MONEY, currency="USD")
