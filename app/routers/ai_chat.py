import time, secrets, json, logging
from typing import Literal, List, Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from app.db import tx, query_timescale_candles
from app.routers.ea import dashboard
from app.routers.deps import Model, get_current_user, get_current_admin

logger = logging.getLogger("zupirus.api")
router = APIRouter()

class Ask(Model): question: str = Field(min_length=1, max_length=2000)

@router.post('/api/assistant')
def assistant(p: Ask, u=Depends(get_current_user)):
    snapshot = dashboard(u)
    local = f"Bạn có {len(snapshot['accounts'])} tài khoản, {len(snapshot['orders'])} lệnh gần nhất. Hệ thống tự động phân bổ tín hiệu theo mức quản trị rủi ro đã cấu hình. Tạm dừng copy ngăn lệnh mới; SL/TP hiện hữu vẫn do sàn xử lý."
    from app.research import ai_text
    answer = ai_text('Phân tích danh mục và dữ liệu giao dịch của khách hàng này: ' + json.dumps(snapshot, ensure_ascii=False)[:18000] + '\nCâu hỏi: ' + p.question)
    reply_text = f"Bạn có {len(snapshot['accounts'])} tài khoản. {answer['text']}" if answer['available'] else local
    return {'text': reply_text, 'ai': answer['available']}

class Vision(Model):
    image: str = Field(max_length=2_500_000, pattern=r'^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$')
    question: str = Field(default='Phân tích sự cố trên biểu đồ demo này.', max_length=2000)

@router.post('/api/admin/vision')
def vision(p: Vision, u=Depends(get_current_admin)):
    from app.research import ai_text
    return ai_text(p.question, p.image)

# ---------------------------------------------------------------------------
# Vercel AI SDK 6 Streaming & ToolLoopAgent Endpoints
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: Literal['user', 'assistant', 'system']
    content: str = Field(default='', max_length=12000)
    parts: list[dict] | None = None


class ChatPayload(BaseModel):
    messages: list[ChatMessage] = Field(max_length=200)

    def question(self):
        message = next((m for m in reversed(self.messages) if m.role == 'user'), None)
        if not message:
            return ''
        if message.parts is None:
            return message.content[:2000]
        return ' '.join(
            part['text'] for part in message.parts
            if part.get('type') == 'text' and isinstance(part.get('text'), str)
        )[:2000]

    def uses_ui_message_stream(self):
        return any(message.parts is not None for message in self.messages)


def ui_message_stream(text, data_type=None, data=None):
    def events():
        text_id = secrets.token_hex(8)
        chunks = [
            {'type': 'start'},
            {'type': 'text-start', 'id': text_id},
            {'type': 'text-delta', 'id': text_id, 'delta': text},
            {'type': 'text-end', 'id': text_id},
        ]
        if data_type:
            chunks.append({'type': f'data-{data_type}', 'data': data})
        chunks.append({'type': 'finish'})
        for chunk in chunks:
            yield f'data: {json.dumps(chunk, ensure_ascii=False)}\n\n'
        yield 'data: [DONE]\n\n'

    return StreamingResponse(events(), media_type='text/event-stream', headers={
        'x-vercel-ai-ui-message-stream': 'v1',
        'X-Accel-Buffering': 'no',
    })


@router.post('/api/chat/assistant')
def chat_assistant(payload: ChatPayload, u=Depends(get_current_user)):
    question = payload.question()
    snapshot = dashboard(u)
    accounts = snapshot.get('accounts') or []
    orders = snapshot.get('orders') or []
    card_type = tool = None
    card = None
    if any(word in question.lower() for word in ('tài khoản', 'số dư', 'balance', 'equity', 'vốn', 'danh mục')):
        card_type, tool = 'portfolio', 'renderPortfolioCard'
        card = {
            'accountsCount': len(accounts),
            'accounts': [{k: a.get(k, 0 if k in ('balance', 'equity', 'positions') else '') for k in ('id', 'login', 'server', 'mode', 'balance', 'equity', 'positions')} for a in accounts[:5]],
            'totalBalance': sum(float(a.get('balance') or 0.0) for a in accounts),
            'totalEquity': sum(float(a.get('equity') or 0.0) for a in accounts),
        }
    elif any(word in question.lower() for word in ('lệnh', 'giao dịch', 'order', 'deal', 'lịch sử')):
        card_type, tool = 'orders', 'renderRecentOrdersCard'
        card = {'orders': [
            {k: o.get(k, '') for k in ('id', 'source', 'side', 'price', 'state', 'ticket', 'deal', 'created', 'created_at')}
            for o in orders[:10]
        ]}

    from app.research import ai_text
    from app.hindsight import recall_memories, store_memory
    memories = recall_memories(query=question, limit=3, user_id=u['id'])
    mem_ctx = ""
    if memories:
        mem_ctx = "\nNgữ cảnh bộ nhớ dài hạn Hindsight:\n" + "\n".join(f"- [{m.get('category')}]: {m.get('content')}" for m in memories)

    summary = {
        'accounts': len(accounts), 'orders': len(orders),
        'balance': sum(float(a.get('balance') or 0.0) for a in accounts),
        'equity': sum(float(a.get('equity') or 0.0) for a in accounts),
        'positions': sum(int(a.get('positions') or a.get('open_positions') or 0) for a in accounts),
        'recent_order_statuses': [o.get('state', '') for o in orders[:10]],
    }
    answer = ai_text('Giải thích dữ liệu danh mục cho người dùng. Dữ liệu: ' +
                     json.dumps(summary, ensure_ascii=False) + mem_ctx + '\nCâu hỏi: ' + question)

    q_low = question.lower()
    if any(k in q_low for k in ('drawdown', 'sụt giảm', 'rủi ro', 'bảo vệ', 'giáp')):
        advisor_hint = (
            "Trạng thái 4 Lớp Giáp Bảo Vệ Vốn:\n"
            "1. Idempotency Lock băm SHA-256 triệt tiêu trùng lệnh.\n"
            "2. Bắt buộc Hard Stop-Loss (100% lệnh phải có SL hợp lệ) và tự động dời hòa vốn Auto Break-Even (1R).\n"
            "3. Lá chắn Macro USD phong tỏa lệnh trước/sau 30 phút tin đỏ (CPI, NFP, FOMC).\n"
            "4. Cầu dao Drawdown Circuit-Breaker ngắt khẩn cấp khi chạm ngưỡng sụt giảm ngày 4.5%."
        )
    elif any(k in q_low for k in ('m15', 'thị trường', 'xu hướng', 'xau', 'vàng', 'gold')):
        advisor_hint = (
            "Phân tích chế độ thị trường XAU/USD (M15):\n"
            "Khung thời gian M15 ưu tiên cấu trúc thanh khoản và biến động phiên London/New York. "
            "Hệ thống kiểm tra spread động và đối chiếu trượt giá trước khi khớp lệnh qua cầu nối Zero-VPS London G2."
        )
    elif any(k in q_low for k in ('kết nối', 'mt5', 'tài khoản', 'cấu hình', 'broker')):
        advisor_hint = (
            "Hướng dẫn kết nối MT5 Cloud:\n"
            "Đăng ký tài khoản MT5 tại mục 'Tài khoản Cloud MT5' với thông tin Server Broker, Login ID và Mật khẩu. "
            "Cầu nối Cloud Bridge sẽ duy trì heartbeat và kiểm soát khối lượng lot theo đúng cấu hình rủi ro của bạn."
        )
    else:
        advisor_hint = "Hệ thống tự động phân bổ tín hiệu theo mức quản trị rủi ro đã cấu hình. Tạm dừng copy ngăn lệnh mới; SL/TP hiện hữu vẫn do sàn xử lý."

    base_summary = (
        f"Trợ lý định lượng ZUPIRUS · Danh mục có {len(accounts)} tài khoản, "
        f"{summary['positions']} vị thế đang mở và {len(orders)} lệnh gần đây.\n\n"
        f"{advisor_hint}"
    )
    text = f"{base_summary}\n\n{answer['text']}" if answer.get('available') and answer.get('text') else base_summary
    try:
        store_memory(category='episodic', content=f"User chat: '{question[:100]}' -> Response: '{text[:120]}'", user_id=u['id'], scope='user', metadata={'user': u.get('id')})
    except Exception:
        pass
    if payload.uses_ui_message_stream():
        return ui_message_stream(text, card_type, card)

    def legacy_events():
        yield f'0:{json.dumps(text, ensure_ascii=False)}\n'
        if tool:
            call_id = f"tool_{secrets.token_hex(6)}"
            yield f'9:{json.dumps({"toolCallId": call_id, "toolName": tool, "args": card})}\n'
            yield f'a:{json.dumps({"toolCallId": call_id, "result": {"rendered": True, **card}})}\n'
        yield 'd:{"finishReason":"stop"}\n'

    return StreamingResponse(legacy_events(), media_type='text/plain', headers={'x-vercel-ai-data-stream': 'v1'})


@router.post('/api/chat/admin-agent')
def chat_admin_agent(payload: ChatPayload, u=Depends(get_current_admin)):
    with tx() as c:
        row = c.execute("SELECT id, result FROM jobs WHERE state='waiting_approval' ORDER BY created DESC LIMIT 1").fetchone()
    proposal = None
    if row:
        result = json.loads(row['result'] or '{}')
        proposal = {'jobId': row['id'], 'report': result.get('report', {})}
    text = 'Ứng viên Walk-Forward gần nhất cần được xem xét.' if proposal else 'Không có ứng viên đang chờ phê duyệt.'
    if payload.uses_ui_message_stream():
        return ui_message_stream(text, 'approval' if proposal else None, proposal)

    def legacy_events():
        yield f'0:{json.dumps(text)}\n'
        if proposal:
            call_id = f"call_approval_{proposal['jobId']}"
            call_payload = {"toolCallId": call_id, "toolName": "requestStrategyApproval", "args": {**proposal, "needsApproval": True}}
            yield f'9:{json.dumps(call_payload)}\n'
        yield 'd:{"finishReason":"stop"}\n'

    return StreamingResponse(legacy_events(), media_type='text/plain', headers={'x-vercel-ai-data-stream': 'v1'})

@router.get('/api/timescale/candles')
def get_timescale_candles(symbol: str = 'XAUUSD', timeframe: str = 'M15', source: str = 'ALL', limit: int = 100):
    """Retrieve continuous candles aggregated by TimescaleDB.
    Strictly validates timeframe (M1, M5, M15, H1, D1) and isolates source (DEMO vs REPLAY)."""
    try:
        candles = query_timescale_candles(symbol=symbol, timeframe=timeframe, source=source, limit=limit)
        return {'symbol': symbol, 'timeframe': timeframe, 'source': source, 'candles': candles}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get('/api/quant/universe')
def quant_universe(u=Depends(get_current_user)):
    """Scans multi-asset universe (XAUUSD, EURUSD, GBPUSD, USDJPY, BTCUSD)
    and returns volatility metrics and market regime classification."""
    from app.portfolio import scan_universe, get_universe_specs
    return {
        'universe': scan_universe(),
        'specifications': get_universe_specs(),
        'scanned_at': time.time(),
    }

class SizingRequest(BaseModel):
    symbol: str = 'XAUUSD'
    equity: float = 10000.0
    risk_percent: float = 1.0
    method: str = 'atr_volatility'
    win_rate: float = 0.55
    win_loss_ratio: float = 2.0

@router.post('/api/quant/sizing')
def quant_position_sizing(req: SizingRequest, u=Depends(get_current_user)):
    """Computes dynamic volatility-adjusted position size using ATR or Half-Kelly."""
    from app.portfolio import calculate_position_size
    return calculate_position_size(
        equity=req.equity,
        symbol=req.symbol,
        risk_percent=req.risk_percent,
        method=req.method,
        win_rate=req.win_rate,
        win_loss_ratio=req.win_loss_ratio,
    )

class MonteCarloRequest(BaseModel):
    initial_equity: float = 10000.0
    iterations: int = 10000
    horizon_trades: int = 100
    ruin_drawdown_pct: float = 20.0
    trades: Optional[List[float]] = None

@router.post('/api/quant/monte-carlo')
def quant_monte_carlo(req: MonteCarloRequest, u=Depends(get_current_user)):
    """Simulates 10,000 portfolio paths using bootstrap resampling to estimate
    Risk of Ruin and 95%/99% Drawdown confidence intervals."""
    from app.portfolio import run_monte_carlo_simulation
    return run_monte_carlo_simulation(
        trades=req.trades,
        initial_equity=req.initial_equity,
        iterations=min(2000, max(100, req.iterations)),
        horizon_trades=min(250, max(10, req.horizon_trades)),
        ruin_drawdown_pct=req.ruin_drawdown_pct,
    )
