"""Windows price service; never opens trades. pip install MetaTrader5 httpx python-dotenv"""
import os,time
import MetaTrader5 as mt5
import httpx
from dotenv import load_dotenv
load_dotenv()
if not mt5.initialize(): raise SystemExit('MT5 terminal unavailable')
account=mt5.account_info()
if account is None or account.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO: raise SystemExit('DEMO required')
bound=(account.login,account.server)
symbol=os.environ['MT5_SYMBOL']
info=mt5.symbol_info(symbol)
if not info or info.currency_base!='XAU' or info.currency_profit!='USD': raise SystemExit('XAU/USD symbol required')
mt5.symbol_select(symbol,True)
with httpx.Client(timeout=5) as client:
    while True:
        a=mt5.account_info()
        if not a or a.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO or (a.login,a.server)!=bound: raise SystemExit('Account changed')
        tick=mt5.symbol_info_tick(symbol)
        if tick and abs(time.time()-tick.time)<10:
            try:
                r=client.post(os.environ['API_URL'].rstrip('/')+'/api/feed',headers={'Authorization':'Bearer '+os.environ['FEED_TOKEN']},json={'source':'DEMO','ts':float(tick.time_msc)/1000,'bid':tick.bid,'ask':tick.ask})
                r.raise_for_status()
            except httpx.HTTPError as e: print(type(e).__name__)
        time.sleep(2)
