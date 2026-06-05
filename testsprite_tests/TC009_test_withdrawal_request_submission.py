import requests, uuid

SUPA = "https://upuhjekwmtjnjksqikdu.supabase.co"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdWhqZWt3bXRqbmprc3Fpa2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTEwMTgsImV4cCI6MjA5NTU2NzAxOH0.CTarbndaugD2SXafK1BCn8WwW9oZCy0vviR-SGkhm9Y"
SVC = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdWhqZWt3bXRqbmprc3Fpa2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk5MTAxOCwiZXhwIjoyMDk1NTY3MDE4fQ.Q3uww4XtTXoqMVWNpId2k-YwXGeMWqdesqAJq9QljPU"

ANON_H = {"apikey": ANON, "Content-Type": "application/json"}
SVC_H = {"apikey": SVC, "Authorization": "Bearer " + SVC, "Content-Type": "application/json"}

def make_user():
    email = "ts_" + uuid.uuid4().hex[:10] + "@test.example"
    pwd = "TestPass99!"
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
    try:
        requests.delete(SUPA + "/auth/v1/admin/users/" + uid, headers=SVC_H, timeout=10)
    except Exception:
        pass

def test_withdrawal_request_submission():
    email, pwd, uid = make_user()
    try:
        jwt, _ = login(email, pwd)
        headers = auth_h(jwt)
        payload = {"amount": 10000, "phone": "+23271234567", "destination_provider": "orange_money"}
        r = requests.post(SUPA + "/functions/v1/process-withdrawal",
                          json=payload, headers=headers, timeout=30)
        assert r.status_code == 200, "withdrawal request failed: " + r.text
    finally:
        del_user(uid)

test_withdrawal_request_submission()
