import requests, uuid, time
from datetime import datetime, timedelta

SUPA = "https://upuhjekwmtjnjksqikdu.supabase.co"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdWhqZWt3bXRqbmprc3Fpa2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTEwMTgsImV4cCI6MjA5NTU2NzAxOH0.CTarbndaugD2SXafK1BCn8WwW9oZCy0vviR-SGkhm9Y"
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
    r = requests.post(SUPA + "/auth/v1/token?grant_type=password",
        json={"email": email, "password": pwd}, headers=ANON_H, timeout=30)
    assert r.status_code == 200, "login failed: " + r.text
    d = r.json()
    return d["access_token"], d["user"]["id"]

def auth_h(jwt):
    return {"apikey": ANON, "Authorization": "Bearer " + jwt,
            "Content-Type": "application/json", "Prefer": "return=representation"}

def del_user(uid):
    requests.delete(SUPA + "/auth/v1/admin/users/" + uid, headers=SVC_H, timeout=10)

def test_osusu_group_creation_and_management():
    email, pwd, uid = make_user()
    try:
        jwt, _ = login(email, pwd)
        ah = auth_h(jwt)

        # Create Osusu group
        group_payload = {
            "name": "TestGroup_" + uuid.uuid4().hex[:6],
            "contribution_amount": 50000,
            "frequency": "weekly",
            "payout_order": "rotational",
            "created_by": uid
        }
        r = requests.post(SUPA + "/rest/v1/osusu_groups", json=group_payload, headers=ah, timeout=30)
        assert r.status_code in (200, 201), "group create failed: " + r.text
        gid = r.json()[0]["id"]

        # Assign collector (self)
        r2 = requests.patch(SUPA + f"/rest/v1/osusu_groups?id=eq.{gid}", json={"collector_id": uid}, headers=ah, timeout=30)
        assert r2.status_code == 200, "assign collector failed: " + r2.text

        # Record physical collection (contribution)
        collection_payload = {
            "group_id": gid,
            "user_id": uid,
            "amount": 50000,
            "method": "cash",
            "collected_at": datetime.utcnow().strftime("%Y-%m-%d")
        }
        r3 = requests.post(SUPA + "/rest/v1/contributions", json=collection_payload, headers=ah, timeout=30)
        assert r3.status_code in (200, 201), "physical collection failed: " + r3.text

        # Initiate contribution payment via USSD code
        payment_payload = {
            "amount": 50000,
            "provider": "orange-money",
            "phone": "+23270000000",
            "group_id": gid,
            "user_id": uid
        }
        r4 = requests.post(SUPA + "/functions/v1/initiate-payment", json=payment_payload,
                           headers={"apikey": ANON, "Authorization": "Bearer " + jwt, "Content-Type": "application/json"},
                           timeout=30)
        assert r4.status_code == 200, "initiate payment failed: " + r4.text
        pay_resp = r4.json()
        assert any(k in pay_resp for k in ["ussd_code", "payment_code", "reference", "payment_id"]), "No USSD/payment code returned"

    finally:
        del_user(uid)

test_osusu_group_creation_and_management()
