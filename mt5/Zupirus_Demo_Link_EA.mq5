#property strict
#property version "1.00"
#property description "Links a demo account to ZUPIRUS and reports account telemetry."

input string InpServerUrl = "";
input string InpPairingCode = "";
input int InpHeartbeatSeconds = 15;

string g_url, g_login, g_server, g_token, g_file;
bool g_stopped = false;

string JsonString(string value)
{
   string escaped = "";
   for(int i = 0; i < StringLen(value); i++)
   {
      ushort c = StringGetCharacter(value, i);
      if(c == 34 || c == 92) escaped += "\\" + ShortToString(c);
      else if(c < 32) escaped += StringFormat("\\u%04X", (uint)c);
      else escaped += ShortToString(c);
   }
   return "\"" + escaped + "\"";
}

bool IsToken(string value)
{
   if(StringLen(value) != 43) return false;
   for(int i = 0; i < 43; i++)
   {
      ushort c = StringGetCharacter(value, i);
      if(!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
           (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
   }
   return true;
}

string ExtractToken(string response)
{
   int start = StringFind(response, "\"eaToken\"");
   if(start < 0) return "";
   start = StringFind(response, ":", start + 9);
   if(start < 0) return "";
   start = StringFind(response, "\"", start + 1);
   if(start < 0) return "";
   int end = StringFind(response, "\"", start + 1);
   if(end < 0) return "";
   string token = StringSubstr(response, start + 1, end - start - 1);
   return IsToken(token) ? token : "";
}

void LoadToken()
{
   int file = FileOpen(g_file, FILE_READ | FILE_TXT | FILE_UNICODE);
   if(file == INVALID_HANDLE) return;
   string url = FileReadString(file);
   string server = FileReadString(file);
   string token = FileReadString(file);
   FileClose(file);
   if(url == g_url && server == g_server && IsToken(token)) g_token = token;
}

void SaveToken()
{
   int file = FileOpen(g_file, FILE_WRITE | FILE_TXT | FILE_UNICODE);
   if(file == INVALID_HANDLE)
   {
      Print("ZUPIRUS: could not save the EA credential. Keep this session open or ask admin to reset the link.");
      return;
   }
   FileWriteString(file, g_url + "\r\n" + g_server + "\r\n" + g_token + "\r\n");
   FileClose(file);
}

int Post(string route, string json, string token, string &response)
{
   char request[], result[];
   string result_headers;
   string headers = "Content-Type: application/json\r\n";
   if(token != "") headers += "Authorization: Bearer " + token + "\r\n";
   StringToCharArray(json, request, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(request, ArraySize(request) - 1);
   ResetLastError();
   int status = WebRequest("POST", g_url + route, headers, 5000, request, result, result_headers);
   if(status == -1)
      PrintFormat("ZUPIRUS: HTTP connection failed (MT5 %d). Check the WebRequest allowlist and server URL.", GetLastError());
   if(ArraySize(result) > 0) response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return status;
}

int OnInit()
{
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("ZUPIRUS: attach this EA to an MT5 demo account.");
      return INIT_FAILED;
   }
   g_url = InpServerUrl;
   StringTrimLeft(g_url);
   StringTrimRight(g_url);
   while(StringLen(g_url) > 0 && StringSubstr(g_url, StringLen(g_url) - 1) == "/")
      g_url = StringSubstr(g_url, 0, StringLen(g_url) - 1);
   bool allowed_url = StringFind(g_url, "https://") == 0 || g_url == "http://127.0.0.1";
   string prefix = "http://127.0.0.1:";
   if(StringFind(g_url, prefix) == 0)
   {
      string port = StringSubstr(g_url, StringLen(prefix));
      allowed_url = StringLen(port) > 0 && StringLen(port) <= 5;
      for(int i = 0; i < StringLen(port); i++)
      {
         ushort c = StringGetCharacter(port, i);
         if(c < '0' || c > '9') allowed_url = false;
      }
   }
   if(!allowed_url)
   {
      Print("ZUPIRUS: use an HTTPS server URL or a local SSH tunnel at 127.0.0.1.");
      return INIT_PARAMETERS_INCORRECT;
   }
   g_login = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   g_server = AccountInfoString(ACCOUNT_SERVER);
   g_file = "Zupirus_Demo_Link_" + g_login + ".txt";
   g_token = "";
   g_stopped = false;
   LoadToken();
   if(g_token == "" && !IsToken(InpPairingCode))
   {
      Print("ZUPIRUS: enter the pairing code issued by the administrator.");
      return INIT_PARAMETERS_INCORRECT;
   }
   return EventSetTimer(InpHeartbeatSeconds < 5 ? 5 : InpHeartbeatSeconds) ? INIT_SUCCEEDED : INIT_FAILED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   if(g_stopped || !TerminalInfoInteger(TERMINAL_CONNECTED)) return;
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO ||
      IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) != g_login ||
      AccountInfoString(ACCOUNT_SERVER) != g_server) return;

   string identity = "\"mode\":\"DEMO\",\"login\":" + JsonString(g_login) +
                     ",\"server\":" + JsonString(g_server);
   string response = "";
   if(g_token == "")
   {
      int status = Post("/api/copy-demo/pair", "{" + identity +
                        ",\"pairingCode\":" + JsonString(InpPairingCode) + "}", "", response);
      if(status != 200)
      {
         if(status > 0) PrintFormat("ZUPIRUS: pairing returned HTTP %d.", status);
         if(status == 400 || status == 409) g_stopped = true;
         return;
      }
      g_token = ExtractToken(response);
      if(g_token == "")
      {
         g_stopped = true;
         Print("ZUPIRUS: pairing response did not include a valid credential. Ask admin to reset the link.");
         return;
      }
      SaveToken();
   }

   response = "";
   int status = Post("/api/copy-demo/heartbeat", "{" + identity +
      ",\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 8) +
      ",\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 8) + "}", g_token, response);
   if(status > 0 && status != 204) PrintFormat("ZUPIRUS: heartbeat returned HTTP %d.", status);
   if(status == 401 || status == 403)
   {
      FileDelete(g_file);
      g_stopped = true;
      Print("ZUPIRUS: link expired or revoked. Enter a new pairing code and reattach the EA.");
   }
}
