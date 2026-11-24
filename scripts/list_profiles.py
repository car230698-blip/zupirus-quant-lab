import os
import httpx
import json
import asyncio

async def list_profiles():
    token = os.getenv("METAAPI_TOKEN", "")
    url = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/provisioning-profiles"
    headers = {"auth-token": token}
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, headers=headers)
        print("Provisioning Profiles status:", r.status_code)
        try:
            data = r.json()
            print("Found profiles:", len(data))
            for p in data:
                print(p)
        except Exception as e:
            print("Error parsing json:", e, r.text)

asyncio.run(list_profiles())
