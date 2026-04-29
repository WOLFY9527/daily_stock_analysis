# -*- coding: utf-8 -*-
"""Realtime market data endpoints for crypto and sentiment panels."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends

from api.deps import CurrentUser, get_optional_current_user
from src.services.market_overview_service import MarketOverviewService

router = APIRouter()


def _actor(current_user: Optional[CurrentUser]) -> Optional[Dict[str, Any]]:
    if current_user is None or not hasattr(current_user, "user_id"):
        return None
    return {
        "user_id": current_user.user_id,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "role": current_user.role,
    }


@router.get("/crypto", summary="Get realtime crypto market snapshot")
def get_crypto(current_user: Optional[CurrentUser] = Depends(get_optional_current_user)):
    return MarketOverviewService().get_crypto(actor=_actor(current_user))


@router.get("/sentiment", summary="Get realtime market sentiment snapshot")
def get_sentiment(current_user: Optional[CurrentUser] = Depends(get_optional_current_user)):
    return MarketOverviewService().get_market_sentiment(actor=_actor(current_user))
