//+------------------------------------------------------------------+
//|                                            ZupirusDemoBridge.mq5 |
//|                        ZUPIRUS Quant Lab - Direct MT5 EA Bridge  |
//|                                              https://zupirus.com |
//+------------------------------------------------------------------+
#property copyright "ZUPIRUS Quant Lab"
#property link      "https://zupirus.com"
#property version   "4.00"
#property strict

#include <Trade\Trade.mqh>

input string InpServerUrl    = "https://zupirus.com"; // Máy chủ ZUPIRUS (thêm vào Tools -> Options -> Expert Advisors -> Allow WebRequest)
input string InpPairingCode  = "ZUPIRUS-DEMO-2026";   // Mã ghép nối tự động (hoặc mã 1 lần từ Web Portal)
input string InpTradeSymbol  = "";                    // Mã giao dịch trên sàn (để trống = dùng mã của biểu đồ hiện tại, vd: XAUUSD / XAUUSDm)
input double InpFixedLot     = 0.0;                   // Lot cố định (để 0.0 = tự tính Lot theo % Risk từ máy chủ)
input int    InpPollSeconds  = 2;                     // Chu kỳ hỏi lệnh mới (giây)
input ulong  InpMagicNumber  = 230698;                // Magic Number của ZUPIRUS

CTrade ExtTrade;
string ExtDeviceToken = "";
string ExtLogin       = "";
string ExtBrokerSrv   = "";
string ExtTokenKey    = "";

//+------------------------------------------------------------------+
//| Helper: HTTP POST JSON using MQL5 WebRequest                     |
//+------------------------------------------------------------------+
int HttpPostJson(const string path, const string jsonBody, const string bearerToken, string &outResponse)
{
   string url = InpServerUrl + path;
   string headers = "Content-Type: application/json\r\n";
   if(StringLen(bearerToken) > 0)
      headers += "Authorization: Bearer " + bearerToken + "\r\n";

   char postData[];
   int bodyLen = StringToCharArray(jsonBody, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(bodyLen > 0)
      ArrayResize(postData, bodyLen - 1); // Bỏ byte null kết thúc chuỗi

   char resultData[];
   string resultHeaders = "";
   ResetLastError();
   int res = WebRequest("POST", url, headers, 8000, postData, resultData, resultHeaders);
   if(res == -1)
   {
      int err = GetLastError();
      PrintFormat("[ZUPIRUS EA] Lỗi WebRequest (%d) khi gọi %s. Hãy vào Tools -> Options -> Expert Advisors -> tích 'Allow WebRequest for listed URL' và thêm: %s",
                  err, url, InpServerUrl);
      return -1;
   }
   outResponse = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
   return res;
}

//+------------------------------------------------------------------+
//| Bước 2: Ghép nối thiết bị (/api/ea/pair)                         |
//+------------------------------------------------------------------+
bool PairDevice()
{
   string payload = StringFormat(
      "{\"login\":\"%s\",\"server\":\"%s\",\"mode\":\"DEMO\",\"code\":\"%s\"}",
      ExtLogin, ExtBrokerSrv, InpPairingCode
   );
   string resp = "";
   int code = HttpPostJson("/api/ea/pair", payload, "", resp);
   if(code == 200 && StringLen(resp) >= 16)
   {
      ExtDeviceToken = resp;
      StringTrimLeft(ExtDeviceToken);
      StringTrimRight(ExtDeviceToken);
      PrintFormat("[ZUPIRUS EA] Ghép nối THÀNH CÔNG với %s! Login=%s | Server=%s", InpServerUrl, ExtLogin, ExtBrokerSrv);
      return true;
   }
   PrintFormat("[ZUPIRUS EA] Ghép nối thất bại (HTTP %d): %s", code, resp);
   return false;
}

//+------------------------------------------------------------------+
//| Bước 3: Gửi nhịp tim, số dư & danh sách lệnh đang mở trên MT5    |
//+------------------------------------------------------------------+
bool SendHeartbeat()
{
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   int posCnt = PositionsTotal();

   string sym = (StringLen(InpTradeSymbol) > 0) ? InpTradeSymbol : _Symbol;
   MqlTick tick;
   double bid = 0.0, ask = 0.0;
   if(SymbolInfoTick(sym, tick))
   {
      bid = tick.bid;
      ask = tick.ask;
   }

   string posJson = "[";
   int added = 0;
   for(int i = 0; i < posCnt; i++)
   {
      ulong pTicket = PositionGetTicket(i);
      if(pTicket == 0) continue;
      string pSym   = PositionGetString(POSITION_SYMBOL);
      long   pType  = PositionGetInteger(POSITION_TYPE);
      string pSide  = (pType == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      double pVol   = PositionGetDouble(POSITION_VOLUME);
      double pOpen  = PositionGetDouble(POSITION_PRICE_OPEN);
      double pSl    = PositionGetDouble(POSITION_SL);
      double pTp    = PositionGetDouble(POSITION_TP);
      double pCur   = PositionGetDouble(POSITION_PRICE_CURRENT);
      double pProf  = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);

      if(added > 0) posJson += ",";
      posJson += StringFormat(
         "{\"ticket\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.2f,\"open_price\":%.3f,\"sl\":%.3f,\"tp\":%.3f,\"current_price\":%.3f,\"profit\":%.2f}",
         pTicket, pSym, pSide, pVol, pOpen, pSl, pTp, pCur, pProf
      );
      added++;
   }
   posJson += "]";

   string payload = StringFormat(
      "{\"login\":\"%s\",\"server\":\"%s\",\"mode\":\"DEMO\",\"balance\":%.2f,\"equity\":%.2f,\"positions\":%d,\"bid\":%.3f,\"ask\":%.3f,\"open_positions\":%s}",
      ExtLogin, ExtBrokerSrv, bal, eq, posCnt, bid, ask, posJson
   );
   string resp = "";
   int code = HttpPostJson("/api/ea/heartbeat", payload, ExtDeviceToken, resp);
   if(code == 401)
   {
      Print("[ZUPIRUS EA] Device token hết hiệu lực, đang tự động ghép nối lại...");
      if(PairDevice())
         code = HttpPostJson("/api/ea/heartbeat", payload, ExtDeviceToken, resp);
   }
   return (code == 200);
}

//+------------------------------------------------------------------+
//| Bước 4 & 5: Nhận lệnh (/api/ea/next -> /intent -> /report)       |
//+------------------------------------------------------------------+
void PollAndExecuteNextSignal()
{
   string payload = StringFormat(
      "{\"login\":\"%s\",\"server\":\"%s\",\"mode\":\"DEMO\"}",
      ExtLogin, ExtBrokerSrv
   );
   string resp = "";
   int code = HttpPostJson("/api/ea/next", payload, ExtDeviceToken, resp);
   if(code != 200)
      return;

   StringTrimLeft(resp);
   StringTrimRight(resp);
   if(resp == "NONE" || StringLen(resp) < 5)
      return;

   // Định dạng trả về: dispatch_id|state|side|price|sl|tp|expires|risk|max_spread|max_positions|max_dd|nonce|peak
   string parts[];
   int cnt = StringSplit(resp, '|', parts);
   if(cnt < 8)
      return;

   long   dispatchId = StringToInteger(parts[0]);
   string dispState  = parts[1];
   string side       = parts[2];
   double sigPrice   = StringToDouble(parts[3]);
   double sigSl      = StringToDouble(parts[4]);
   double sigTp      = StringToDouble(parts[5]);
   double riskPct    = StringToDouble(parts[7]);

   if(dispState != "queued")
      return;

   string sym = (StringLen(InpTradeSymbol) > 0) ? InpTradeSymbol : _Symbol;
   MqlTick tick;
   if(!SymbolInfoTick(sym, tick))
   {
      PrintFormat("[ZUPIRUS EA] Không đọc được giá của mã %s trên MT5!", sym);
      return;
   }

   double spreadPrice = MathAbs(tick.ask - tick.bid);
   double equity      = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskDollars = MathMax(1.0, equity * (riskPct / 100.0) * 0.95);
   string nonce       = StringFormat("mt5_%I64d_%u_%d", dispatchId, GetTickCount(), MathRand());

   // Bước 5a: Xin cấp quyền SEND_ONCE từ Risk Gate + Redis Lock (/api/ea/intent)
   string intentPayload = StringFormat(
      "{\"login\":\"%s\",\"server\":\"%s\",\"mode\":\"DEMO\",\"dispatch\":%I64d,\"nonce\":\"%s\",\"spread\":%.4f,\"risk_amount\":%.2f}",
      ExtLogin, ExtBrokerSrv, dispatchId, nonce, spreadPrice, riskDollars
   );
   string intentResp = "";
   int intentCode = HttpPostJson("/api/ea/intent", intentPayload, ExtDeviceToken, intentResp);
   StringTrimLeft(intentResp);
   StringTrimRight(intentResp);

   if(intentCode != 200 || intentResp != "SEND_ONCE")
   {
      PrintFormat("[ZUPIRUS EA] Risk Gate từ chối hoặc lệnh đã khóa (HTTP %d): %s", intentCode, intentResp);
      return;
   }

   // Tính khối lượng Lot có nhận diện tài khoản Cent và Contract Size chuẩn
   double lot = InpFixedLot;
   if(lot <= 0.0)
   {
      double slDist = MathAbs(sigPrice - sigSl);
      if(slDist <= 0.0) slDist = 5.0;

      // Nhận diện tài khoản Cent (USC, EUC) để chuẩn hóa rủi ro về USD, tránh vào lệnh gấp 100 lần
      string accCurr = AccountInfoString(ACCOUNT_CURRENCY);
      bool isCent = (accCurr == "USC" || accCurr == "EUC" || StringFind(accCurr, "cent") >= 0 || StringFind(accCurr, "Cent") >= 0);
      double adjustedRiskDollars = riskDollars;
      if(isCent)
      {
         adjustedRiskDollars = riskDollars / 100.0;
      }

      double contractSize = SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);
      if(contractSize <= 0) contractSize = 100.0;
      double tickValue = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
      double tickSize  = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
      if(tickValue <= 0) tickValue = 1.0;
      if(tickSize <= 0)  tickSize = SymbolInfoDouble(sym, SYMBOL_POINT);
      if(tickSize <= 0)  tickSize = 0.01;

      double riskPerLot = (slDist / tickSize) * tickValue;
      if(riskPerLot <= 0) riskPerLot = slDist * contractSize;

      lot = (riskPerLot > 0) ? (adjustedRiskDollars / riskPerLot) : 0.01;
   }
   double minLot  = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   double stepLot = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   if(minLot <= 0)  minLot = 0.01;
   if(maxLot <= 0)  maxLot = 10.0;
   if(stepLot <= 0) stepLot = 0.01;
   lot = MathFloor(lot / stepLot) * stepLot;
   lot = MathMax(minLot, MathMin(lot, maxLot));
   lot = NormalizeDouble(lot, 2);

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double execPrice = (side == "BUY") ? tick.ask : tick.bid;
   // Điều chỉnh khoảng cách SL/TP theo giá khớp thực tế trên sàn Demo của bạn để không bị lỗi Invalid Stops
   double slOffset = MathAbs(sigPrice - sigSl);
   double tpOffset = MathAbs(sigTp - sigPrice);
   double realSl = (side == "BUY") ? NormalizeDouble(execPrice - slOffset, digits) : NormalizeDouble(execPrice + slOffset, digits);
   double realTp = (side == "BUY") ? NormalizeDouble(execPrice + tpOffset, digits) : NormalizeDouble(execPrice - tpOffset, digits);

   ExtTrade.SetExpertMagicNumber(InpMagicNumber);
   ExtTrade.SetDeviationInPoints(50);

   bool ok = false;
   if(side == "BUY")
      ok = ExtTrade.Buy(lot, sym, execPrice, realSl, realTp, StringFormat("ZUPIRUS #%I64d", dispatchId));
   else
      ok = ExtTrade.Sell(lot, sym, execPrice, realSl, realTp, StringFormat("ZUPIRUS #%I64d", dispatchId));

   ulong orderTicket = ExtTrade.ResultOrder();
   ulong dealTicket  = ExtTrade.ResultDeal();
   double fillPrice  = ExtTrade.ResultPrice();
   if(fillPrice <= 0) fillPrice = execPrice;

   // Bước 5b: Gửi biên lai kết quả khớp lệnh về máy chủ (/api/ea/report)
   string reportPayload = "";
   if(ok && orderTicket > 0)
   {
      if(dealTicket == 0) dealTicket = orderTicket;
      reportPayload = StringFormat(
         "{\"login\":\"%s\",\"server\":\"%s\",\"mode\":\"DEMO\",\"dispatch\":%I64d,\"nonce\":\"%s\",\"state\":\"filled\",\"ticket\":\"%I64u\",\"deal\":\"%I64u\",\"reason\":\"MT5 Live Demo Executed %.2f lot %s\",\"price\":%.2f}",
         ExtLogin, ExtBrokerSrv, dispatchId, nonce, orderTicket, dealTicket, lot, sym, fillPrice
      );
      PrintFormat("[ZUPIRUS EA] ĐÃ KHỚP LỆNH THÀNH CÔNG TRÊN MT5! %s %.2f lot %s @ %.2f (Ticket #%I64u, Deal #%I64u)",
                  side, lot, sym, fillPrice, orderTicket, dealTicket);
   }
   else
   {
      string errDesc = ExtTrade.ResultRetcodeDescription();
      reportPayload = StringFormat(
         "{\"login\":\"%s\",\"server\":\"%s\",\"mode\":\"DEMO\",\"dispatch\":%I64d,\"nonce\":\"%s\",\"state\":\"rejected\",\"ticket\":\"\",\"deal\":\"\",\"reason\":\"MT5 Reject: %s\"}",
         ExtLogin, ExtBrokerSrv, dispatchId, nonce, errDesc
      );
      PrintFormat("[ZUPIRUS EA] Sàn MT5 từ chối lệnh #%I64d: %s (Retcode=%u)", dispatchId, errDesc, ExtTrade.ResultRetcode());
   }

   string repResp = "";
   HttpPostJson("/api/ea/report", reportPayload, ExtDeviceToken, repResp);
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   ExtLogin     = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   ExtBrokerSrv = AccountInfoString(ACCOUNT_SERVER);

   PrintFormat("[ZUPIRUS EA] Khởi động ZupirusDemoBridge v4.0 cho tài khoản MT5 Login=%s | Server=%s", ExtLogin, ExtBrokerSrv);
   PairDevice();
   SendHeartbeat();
   EventSetTimer(MathMax(1, InpPollSeconds));
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
//| Timer function                                                   |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(StringLen(ExtDeviceToken) == 0)
   {
      if(!PairDevice())
         return;
   }
   SendHeartbeat();
   PollAndExecuteNextSignal();
}
//+------------------------------------------------------------------+
