import os
import httpx
import asyncio

async def redeploy_now():
    token = os.getenv("METAAPI_TOKEN", "")
    acc_id = "9cc35bf4-845b-4f95-9eef-6f93416874ec"
    headers = {"auth-token": token}
    base = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai"
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        print("Calling /redeploy...")
        r = await client.post(f"{base}/users/current/accounts/{acc_id}/redeploy", headers=headers)
        print("redeploy result:", r.status_code)
        
        # Wait and check status
        for i in range(1, 10):
            await asyncio.sleep(5)
            chk = await client.get(f"{base}/users/current/accounts/{acc_id}", headers=headers)
            data = chk.json()
            status = data.get("connectionStatus")
            state = data.get("state")
            print(f"Check {i}: connectionStatus={status}, state={state}")
            if status == "CONNECTED":
                print("SUCCESSFULLY CONNECTED TO EXNESS!")
                break

asyncio.run(redeploy_now())
