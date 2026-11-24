import pytest
import time
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi import Request
from app.domains.execution.metaapi_client import MetaApiClient
from app.routers.accounts import delete_account, sync_account


@pytest.mark.asyncio
async def test_emergency_close_rejected_with_position_id():
    """Verify close_all_positions treats HTTP 200 with error as failure even if positionId is present."""
    client = MetaApiClient(token="test_token_123")
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"error": "Rejected by broker", "positionId": "123456"}
    
    with patch.object(client, "get_open_positions", new_callable=AsyncMock) as mock_get_open:
        mock_get_open.return_value = [{"id": "123456", "symbol": "XAUUSD"}]
        with patch("httpx.AsyncClient") as mock_http:
            instance = mock_http.return_value.__aenter__.return_value
            instance.post = AsyncMock(return_value=mock_resp)
            
            res = await client.close_all_positions("test-acc-id")
            assert res["closed_count"] == 0
            assert res["failed_count"] == 1
            assert res["status"] == "PARTIAL_CLOSE_FAILED"


@pytest.mark.asyncio
async def test_metaapi_404_not_found_handling():
    """Verify get_account_information returns error: NOT_FOUND on 404 response."""
    client = MetaApiClient(token="test_token_123")
    p_resp = MagicMock()
    p_resp.status_code = 404
    
    with patch("httpx.AsyncClient") as mock_http:
        instance = mock_http.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=p_resp)
        
        info = await client.get_account_information("non-existent-terminal-id")
        assert info["connected"] is False
        assert info["error"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_metaapi_connected_flag_not_overridden_when_broker_disconnected():
    """Verify broker disconnection in provisioning prevents client API from falsely claiming CONNECTED."""
    client = MetaApiClient(token="test_token_123")
    
    # Provisioning says DISCONNECTED_FROM_BROKER
    p_resp = MagicMock()
    p_resp.status_code = 200
    p_resp.json.return_value = {"connectionStatus": "DISCONNECTED_FROM_BROKER", "region": "london"}
    
    # Client API returns 200
    c_resp = MagicMock()
    c_resp.status_code = 200
    c_resp.json.return_value = {"balance": 500.0, "equity": 500.0, "connected": False}
    
    with patch("httpx.AsyncClient") as mock_http:
        instance = mock_http.return_value.__aenter__.return_value
        instance.get = AsyncMock(side_effect=[p_resp, c_resp])
        
        info = await client.get_account_information("acc-123")
        assert info["connected"] is False
        assert info["connection_status"] in ("DISCONNECTED_FROM_BROKER", "DISCONNECTED")
        assert info["error"] == "BROKER_DISCONNECTED"


@pytest.mark.asyncio
async def test_delete_account_handles_request_without_name_error():
    """Verify delete_account accepts request and inspects query_params without NameError."""
    mock_request = MagicMock(spec=Request)
    mock_request.query_params = {"force": "true"}
    
    # Mock user and DB
    user = {"id": "user-test-1", "role": "user"}
    
    with patch("app.routers.accounts.tx") as mock_tx:
        # Simulate not found to trigger fast 404 without touching DB or MetaApi
        mock_cursor = MagicMock()
        mock_cursor.execute.return_value.fetchone.return_value = None
        mock_tx.return_value.__enter__.return_value = mock_cursor
        
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await delete_account("non-existent-id", request=mock_request, u=user)
        assert exc_info.value.status_code == 404
