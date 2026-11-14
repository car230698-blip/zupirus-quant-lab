#property strict
#property version "0.10"
#property description "ZUPIRUS Demo-only copy client. No master EA. Ambiguous intents never resend."
input string ApiURL="https://zupirus.com";
input string PairingCode="";
input string GoldSymbol="";
input double LocalRiskPercent=0.25;
input double LocalMaxSpreadUSD=0.80;
input int LocalMaxPositions=1;
input double LocalMaxDrawdownPercent=10.0;
input double MaxPriceDriftUSD=2.0;
input int PollSeconds=3;
string credential="", gold="", prefix="", identity="";
long boundLogin=0;
string boundServer="";
int lockHandle=INVALID_HANDLE;
const ulong MAGIC_BASE=530000000000;

string Escape(string s) { StringReplace(s,"\\","\\\\"); StringReplace(s,"\"","\\\""); return s; }
string Body() { return "\"login\":\""+(string)boundLogin+"\",\"server\":\""+Escape(boundServer)+"\",\"mode\":\"DEMO\""; }
bool SafeIdentity() { return AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO && AccountInfoInteger(ACCOUNT_LOGIN)==boundLogin && AccountInfoString(ACCOUNT_SERVER)==boundServer; }
int Post(string endpoint,string body,string &out) {
   if(!SafeIdentity()) return -1;
   char data[],result[]; string headers="Content-Type: application/json\r\n";
   if(credential!="") headers+="Authorization: Bearer "+credential+"\r\n";
   StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0) ArrayResize(data,ArraySize(data)-1);
   string resultHeaders;
   int status=WebRequest("POST",ApiURL+endpoint,headers,5000,data,result,resultHeaders);
   out=CharArrayToString(result,0,-1,CP_UTF8);
   if(status<200 || status>=300) Print("ZUPIRUS HTTP ",status," endpoint ",endpoint,"; verify connectivity/account state.");
   return status;
}
bool WriteDurable(string path,string value) {
   int f=FileOpen(path,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(f==INVALID_HANDLE) return false;
   uint count=FileWriteString(f,value); FileFlush(f); FileClose(f);
   return count>0;
}
string ReadLocal(string path) {
   int f=FileOpen(path,FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(f==INVALID_HANDLE) return "";
   string value=FileReadString(f); FileClose(f); return value;
}
string DetectGold() {
   if(GoldSymbol!="") {
      if(!SymbolSelect(GoldSymbol,true)) return "";
      string base=SymbolInfoString(GoldSymbol,SYMBOL_CURRENCY_BASE);
      string profit=SymbolInfoString(GoldSymbol,SYMBOL_CURRENCY_PROFIT);
      if(base!="XAU" || profit!="USD") return "";
      return GoldSymbol;
   }
   string found=""; int count=0;
   for(int i=0;i<SymbolsTotal(false);i++) {
      string s=SymbolName(i,false);
      if(SymbolInfoString(s,SYMBOL_CURRENCY_BASE)=="XAU" && SymbolInfoString(s,SYMBOL_CURRENCY_PROFIT)=="USD" && SymbolInfoInteger(s,SYMBOL_TRADE_MODE)==SYMBOL_TRADE_MODE_FULL) { found=s; count++; }
   }
   // Ambiguous broker aliases require an explicit selection rather than guessing.
   if(count!=1 || !SymbolSelect(found,true)) return "";
   return found;
}
int OnInit() {
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO) { Print("HARD LOCK: only MT5 DEMO accepted."); return INIT_FAILED; }
   if(StringFind(ApiURL,"https://")!=0) { Print("HTTPS required."); return INIT_FAILED; }
   if(LocalRiskPercent<=0 || LocalRiskPercent>1 || LocalMaxPositions<1 || LocalMaxPositions>3 || LocalMaxSpreadUSD<=0 || LocalMaxDrawdownPercent<=0 || PollSeconds<2) return INIT_PARAMETERS_INCORRECT;
   boundLogin=AccountInfoInteger(ACCOUNT_LOGIN); boundServer=AccountInfoString(ACCOUNT_SERVER);
   uint h=2166136261; for(int j=0;j<StringLen(boundServer);j++) h=(h^(uint)StringGetCharacter(boundServer,j))*16777619;
   prefix="ZUPIRUS_"+(string)boundLogin+"_"+(string)h;
   lockHandle=FileOpen(prefix+".lock",FILE_WRITE|FILE_BIN|FILE_COMMON);
   if(lockHandle==INVALID_HANDLE) { Print("Another EA instance owns this account lock."); return INIT_FAILED; }
   gold=DetectGold(); if(gold=="") { Print("Gold symbol missing/ambiguous. Set exact GoldSymbol with XAU/USD contract metadata."); return INIT_FAILED; }
   credential=ReadLocal(prefix+".token");
   if(credential=="") {
      if(PairingCode=="") { Print("Create a one-time pairing code on the portal."); return INIT_FAILED; }
      string out; int status=Post("/api/ea/pair","{"+Body()+",\"code\":\""+Escape(PairingCode)+"\"}",out);
      if(status!=200 || StringLen(out)<32) return INIT_FAILED;
      credential=out;
      if(!WriteDurable(prefix+".token",credential)) { Print("Cannot persist credential. Revoke and pair again."); return INIT_FAILED; }
   }
   EventSetTimer(PollSeconds); Print("ZUPIRUS DEMO connected on ",gold,". Never delete journals while intents are unresolved."); return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); if(lockHandle!=INVALID_HANDLE) FileClose(lockHandle); }
void Report(long id,string nonce,string state,ulong order,ulong deal,string reason) {
   string out;
   Post("/api/ea/report","{"+Body()+",\"dispatch\":"+(string)id+",\"nonce\":\""+Escape(nonce)+"\",\"state\":\""+state+"\",\"ticket\":\""+(order>0?(string)order:"")+"\",\"deal\":\""+(deal>0?(string)deal:"")+"\",\"reason\":\""+Escape(reason)+"\"}",out);
}
bool Reconcile(long id,string nonce) {
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) || !HistorySelect(0,TimeCurrent())) return false;
   ulong magic=MAGIC_BASE+(ulong)id;
   ulong bestDeal=0,order=0;
   for(int i=0;i<HistoryDealsTotal();i++) {
      ulong d=HistoryDealGetTicket(i);
      if((ulong)HistoryDealGetInteger(d,DEAL_MAGIC)==magic && HistoryDealGetString(d,DEAL_SYMBOL)==gold && (HistoryDealGetInteger(d,DEAL_ENTRY)==DEAL_ENTRY_IN || HistoryDealGetInteger(d,DEAL_ENTRY)==DEAL_ENTRY_INOUT)) {
         if(bestDeal==0 || d<bestDeal) { bestDeal=d; order=(ulong)HistoryDealGetInteger(d,DEAL_ORDER); }
      }
   }
   if(bestDeal>0 && order>0) { Report(id,nonce,"filled",order,bestDeal,"broker_history"); return true; }
   // An order/position can exist before a deal is available. Do not submit again.
   for(int i=0;i<OrdersTotal();i++) { ulong o=OrderGetTicket(i); if(o>0 && (ulong)OrderGetInteger(ORDER_MAGIC)==magic) return false; }
   for(int i=0;i<PositionsTotal();i++) { ulong p=PositionGetTicket(i); if(p>0 && (ulong)PositionGetInteger(POSITION_MAGIC)==magic) return false; }
   return false; // Absence in history is NOT proof a timed-out request never executed.
}
bool NoBrokerEvidence(long id) {
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) || !HistorySelect(0,TimeCurrent())) return false;
   ulong magic=MAGIC_BASE+(ulong)id;
   for(int i=0;i<HistoryDealsTotal();i++) {
      ulong ticket=HistoryDealGetTicket(i);
      if((ulong)HistoryDealGetInteger(ticket,DEAL_MAGIC)==magic) return false;
   }
   for(int i=0;i<HistoryOrdersTotal();i++) {
      ulong ticket=HistoryOrderGetTicket(i);
      if((ulong)HistoryOrderGetInteger(ticket,ORDER_MAGIC)==magic) return false;
   }
   for(int i=0;i<PositionsTotal();i++) {
      if(PositionGetTicket(i)>0 && (ulong)PositionGetInteger(POSITION_MAGIC)==magic) return false;
   }
   for(int i=0;i<OrdersTotal();i++) {
      if(OrderGetTicket(i)>0 && (ulong)OrderGetInteger(ORDER_MAGIC)==magic) return false;
   }
   return true;
}
bool Checks(string &fields[],MqlTradeRequest &req) {
   if(!SafeIdentity() || !TerminalInfoInteger(TERMINAL_CONNECTED) || !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED) || !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) || !AccountInfoInteger(ACCOUNT_TRADE_EXPERT)) return false;
   if((long)TimeGMT()>(long)StringToInteger(fields[6])) return false;
   MqlTick tick; if(!SymbolInfoTick(gold,tick) || TimeCurrent()-tick.time>10) return false;
   double spread=tick.ask-tick.bid;
   if(spread>MathMin(LocalMaxSpreadUSD,StringToDouble(fields[8]))) return false;
   if(PositionsTotal()+OrdersTotal()>=(int)MathMin(LocalMaxPositions,(int)StringToInteger(fields[9]))) return false;
   double equity=AccountInfoDouble(ACCOUNT_EQUITY),peak=StringToDouble(fields[12]);
   if(equity<=0 || peak<=0 || (peak-equity)/peak*100>=MathMin(LocalMaxDrawdownPercent,StringToDouble(fields[10]))) return false;
   bool buy=fields[2]=="BUY"; double price=buy?tick.ask:tick.bid;
   if(MathAbs(price-StringToDouble(fields[3]))>MaxPriceDriftUSD) return false;
   double sl=StringToDouble(fields[4]),tp=StringToDouble(fields[5]);
   double point=SymbolInfoDouble(gold,SYMBOL_POINT),stepPrice=SymbolInfoDouble(gold,SYMBOL_TRADE_TICK_SIZE);
   if(point<=0 || stepPrice<=0) return false;
   int digits=(int)SymbolInfoInteger(gold,SYMBOL_DIGITS);
   sl=NormalizeDouble(MathRound(sl/stepPrice)*stepPrice,digits); tp=NormalizeDouble(MathRound(tp/stepPrice)*stepPrice,digits);
   double minDistance=SymbolInfoInteger(gold,SYMBOL_TRADE_STOPS_LEVEL)*point;
   double reference=buy?tick.bid:tick.ask;
   if((buy && (reference-sl<=minDistance || tp-reference<=minDistance)) || (!buy && (sl-reference<=minDistance || reference-tp<=minDistance))) return false;
   double loss=0; ENUM_ORDER_TYPE side=buy?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   if(!OrderCalcProfit(side,gold,1,price,sl,loss) || loss>=0) return false;
   double step=SymbolInfoDouble(gold,SYMBOL_VOLUME_STEP),minLot=SymbolInfoDouble(gold,SYMBOL_VOLUME_MIN),maxLot=SymbolInfoDouble(gold,SYMBOL_VOLUME_MAX);
   if(step<=0) return false;
   double budget=equity*MathMin(LocalRiskPercent,StringToDouble(fields[7]))/100;
   // 10% headroom for commission and execution slippage; broker gaps can still exceed planned risk.
   double lots=MathFloor(MathMin(maxLot,budget*.90/MathAbs(loss))/step)*step;
   lots=NormalizeDouble(lots,8); if(lots<minLot) return false;
   double margin=0; if(!OrderCalcMargin(side,gold,lots,price,margin) || margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE)*.8) return false;
   ZeroMemory(req); req.action=TRADE_ACTION_DEAL; req.magic=MAGIC_BASE+(ulong)StringToInteger(fields[0]); req.symbol=gold;
   req.type=side; req.volume=lots; req.price=price; req.sl=sl; req.tp=tp; req.deviation=20; req.comment="ZQ:"+fields[0];
   long fill=SymbolInfoInteger(gold,SYMBOL_FILLING_MODE);
   if((fill&SYMBOL_FILLING_FOK)==SYMBOL_FILLING_FOK) req.type_filling=ORDER_FILLING_FOK;
   else if((fill&SYMBOL_FILLING_IOC)==SYMBOL_FILLING_IOC) req.type_filling=ORDER_FILLING_IOC;
   else return false;
   MqlTradeCheckResult check={};
   if(!OrderCheck(req,check)) return false;
   return true;
}
void OnTimer() {
   if(!SafeIdentity()) { EventKillTimer(); Print("Account identity changed. EA halted."); return; }
   string out;
   string hb="{"+Body()+",\"balance\":"+DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),2)+",\"equity\":"+DoubleToString(MathMax(0,AccountInfoDouble(ACCOUNT_EQUITY)),2)+",\"positions\":"+(string)(PositionsTotal()+OrdersTotal())+"}";
   if(Post("/api/ea/heartbeat",hb,out)!=200) return;
   if(Post("/api/ea/next","{"+Body()+"}",out)!=200 || out=="NONE") return;
   string fields[]; if(StringSplit(out,'|',fields)!=13) return;
   long id=StringToInteger(fields[0]); if(id<=0) return;
   string journal=prefix+"_"+(string)id+".intent";
   string saved=ReadLocal(journal),nonce=fields[11];
   if(fields[1]!="queued") {
      if(nonce=="-" || nonce=="") return;
      if(!Reconcile(id,nonce)) Report(id,nonce,"unknown",0,0,"await_broker_reconciliation_no_resend");
      return;
   }
   if(saved!="") { Print("Local intent exists for queued dispatch. Fail closed: ",id); return; }
   if(!NoBrokerEvidence(id)) { Print("Broker evidence exists or history unavailable. Refusing new send: ",id); return; }
   MqlTradeRequest req={}; if(!Checks(fields,req)) return;
   double authorizedLoss=0;
   if(!OrderCalcProfit(req.type,gold,req.volume,req.price,req.sl,authorizedLoss) || authorizedLoss>=0) return;
   authorizedLoss=MathAbs(authorizedLoss);
   nonce=(string)boundLogin+"-"+(string)TimeGMT()+"-"+(string)GetMicrosecondCount();
   // Write-before-send journal. Kept forever; even a failed authorization does not retry this dispatch.
   if(!WriteDurable(journal,nonce)) return;
   MqlTick tick; if(!SymbolInfoTick(gold,tick)) return;
   string body="{"+Body()+",\"dispatch\":"+(string)id+",\"nonce\":\""+nonce+"\",\"spread\":"+DoubleToString(tick.ask-tick.bid,5)+",\"risk_amount\":"+DoubleToString(authorizedLoss,8)+"}";
   if(Post("/api/ea/intent",body,out)!=200 || out!="SEND_ONCE") return;
   // Recheck after HTTP round trip. A cancelled local send is reported as rejected, never retried.
   if(!Checks(fields,req)) { Report(id,nonce,"rejected",0,0,"local_risk_changed_before_send"); return; }
   double finalLoss=0;
   if(!OrderCalcProfit(req.type,gold,req.volume,req.price,req.sl,finalLoss) || finalLoss>=0 || MathAbs(finalLoss)>authorizedLoss+0.000001) { Report(id,nonce,"rejected",0,0,"risk_exceeds_authorized_amount"); return; }
   MqlTradeResult result={}; bool sent=OrderSend(req,result);
   // Both bool return and retcode are diagnostics, NOT an execution receipt.
   Print("ZUPIRUS dispatch ",id," sent=",sent," retcode=",result.retcode," order=",result.order," deal=",result.deal);
   if(!Reconcile(id,nonce)) Report(id,nonce,"unknown",0,0,"retcode_"+(string)result.retcode);
}
