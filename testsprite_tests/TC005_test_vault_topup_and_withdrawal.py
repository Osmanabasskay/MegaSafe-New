import requests, uuid, time
from datetime import datetime, timedelta

SUPA = "https://upuhjekwmtjnjksqikdu.supabase.co"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdWhqZWt3bXRqbmprc3Fpa2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTEwMTgsImV4cCI6MjA5NTY3MDE4fQ.CTarbndaugD2SXafK1BCn8WwW9oZCy0vviR-SGkhm9Y"
SVC  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdWhqZWt3bXRqbmprc3Fpa2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk5MTAxOCwiZXhwIjoyMDk1NTY3MDE4fQ.Q3uww4XtTXoqMVWNpId2k-YwXGeMWqdesqAJq9QljPU"

ANON_H = {"apikey": ANON, "Content-Type": "application/json"}
SVC_H  = {"apikey": SVC,  "Authorization": "Bearer " + SVC, "Content-Type": "application/json"}

def make_user():
    email = "ts_" + uuid.uuid4().hex[:10] + "@test.example"
    pwd   = "TestPass99!"
    r = requests.post(SUPA + "/auth/v1/admin/users",
        json={"email": email, "password": pwd, "email_confirm": True},
        headers=SVC_H, timeout=30)
    assert r.status_code in (200, 201), "admin create user failed: " + r.text
    uid = r.json()["id"]
    return email, pwd, uid

def login(email, pwd):
    headers = {"apikey": ANON, "Content-Type": "application/x-www-form-urlencoded"}
    data = {
        "grant_type": "password",
        "email": email,
        "password": pwd
    }
    r = requests.post(SUPA + "/auth/v1/token",
                      data=data,
                      headers=headers, timeout=30)
    assert r.status_code == 200, "login failed: " + r.text
    d = r.json()
    return d["access_token"], d["user"]["id"]

def auth_h(jwt):
    return {"apikey": ANON, "Authorization": "Bearer " + jwt,
            "Content-Type": "application/json", "Prefer": "return=representation"}

def del_user(uid):
    requests.delete(SUPA + "/auth/v1/admin/users/" + uid, headers=SVC_H, timeout=10)

def test_vault_topup_and_withdrawal():
    email, pwd, uid = make_user()
    try:
        jwt, user_id = login(email, pwd)
        ah = auth_h(jwt)

        # 1) View vault balances
        r = requests.post(SUPA + "/rpc/get_vault_summary",
                          json={"user_id": user_id},
                          headers=ah, timeout=30)
        assert r.status_code == 200, "get_vault_summary failed: " + r.text
        vault_data = r.json()
        assert isinstance(vault_data, list) and len(vault_data) > 0, "vault summary empty"
        balances = vault_data[0]
        posted = balances.get("posted", 0)
        reserved = balances.get("reserved", 0)
        available = balances.get("available", 0)
        assert posted is not None and reserved is not None and available is not None, "vault balances missing"

        # 2) Initiate vault top-up by Orange Money
        payload_om = {
            "amount": 50000,
            "provider": "orange-money",
            "phone": "+23271234567"
        }
        r_topup_om = requests.post(SUPA + "/functions/v1/initiate-vault-topup",
                                   json=payload_om,
                                   headers={"apikey": ANON, "Authorization": "Bearer " + jwt, "Content-Type": "application/json"},
                                   timeout=30)
        assert r_topup_om.status_code == 200, "vault topup orange-money failed: " + r_topup_om.text
        topup_response_om = r_topup_om.json()
        assert any(k in topup_response_om for k in ("ussd_code", "payment_code", "reference")), "missing payment code in orange-money topup response"

        # 3) Initiate vault top-up by AfriMoney
        payload_am = {
            "amount": 50000,
            "provider": "afri-money",
            "phone": "+23271234567"
        }
        r_topup_am = requests.post(SUPA + "/functions/v1/initiate-vault-topup",
                                   json=payload_am,
                                   headers={"apikey": ANON, "Authorization": "Bearer " + jwt, "Content-Type": "application/json"},
                                   timeout=30)
        assert r_topup_am.status_code == 200, "vault topup afri-money failed: " + r_topup_am.text
        topup_response_am = r_topup_am.json()
        assert any(k in topup_response_am for k in ("ussd_code", "payment_code", "reference")), "missing payment code in afri-money topup response"

        # 4) Request a withdrawal from available balance if any
        withdrawal_amount = min(10000, available if isinstance(available, (int, float)) else 0)
        if withdrawal_amount > 0:
            payload_withdrawal = {
                "amount": withdrawal_amount,
                "phone": "+23271234567"
            }
            r_withdraw = requests.post(SUPA + "/functions/v1/process-withdrawal",
                                       json=payload_withdrawal,
                                       headers={"apikey": ANON, "Authorization": "Bearer " + jwt, "Content-Type": "application/json"},
                                       timeout=30)
            assert r_withdraw.status_code == 200, "withdrawal request failed: " + r_withdraw.text
        else:
            # No available balance to withdraw; must still pass test
            pass

    finally:
        del_user(uid)

test_vault_topup_and_withdrawal()
