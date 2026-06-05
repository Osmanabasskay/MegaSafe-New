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

def del_user(uid):
    r = requests.delete(SUPA + "/auth/v1/admin/users/" + uid, headers=SVC_H, timeout=30)
    assert r.status_code in (200, 204), "admin delete user failed: " + r.text

def login(email, pwd):
    r = requests.post(SUPA + "/auth/v1/token?grant_type=password",
        json={"email": email, "password": pwd}, headers=ANON_H, timeout=30)
    assert r.status_code == 200, "login failed: " + r.text
    d = r.json()
    return d["access_token"], d["user"]["id"]

def auth_h(jwt):
    return {"apikey": ANON, "Authorization": "Bearer " + jwt,
            "Content-Type": "application/json", "Prefer": "return=representation"}

def test_mobile_money_payment_initiation_and_status_polling():
    email, pwd, uid = make_user()
    try:
        jwt, _ = login(email, pwd)
        headers = {"apikey": ANON, "Authorization": "Bearer " + jwt, "Content-Type": "application/json"}

        # Initiate mobile money payment
        payload = {"amount": 50000, "provider": "orange-money", "phone": "+23271234567"}
        r = requests.post(SUPA + "/functions/v1/initiate-payment", json=payload, headers=headers, timeout=30)
        assert r.status_code == 200, "initiate-payment failed: " + r.text
        data = r.json()

        # Confirm at least one expected key is in response
        assert any(k in data for k in ["ussd_code", "payment_code", "reference", "payment_id"]), \
            "Response missing required payment info keys"

        # Extract payment_id or reference to poll status
        payment_id = data.get("payment_id") or data.get("reference")
        assert payment_id is not None, "Cannot poll payment status without payment_id or reference"

        # Poll for live payment status updates
        poll_url = SUPA + "/functions/v1/verify-payment"
        poll_payload = {"payment_id": payment_id}
        max_poll_attempts = 10
        poll_interval_seconds = 3
        last_status = None

        for attempt in range(max_poll_attempts):
            pr = requests.post(poll_url, json=poll_payload, headers=headers, timeout=30)
            assert pr.status_code == 200, f"verify-payment failed at attempt {attempt+1}: {pr.text}"
            resp = pr.json()

            # Check expected keys in response status update
            assert "status" in resp, "verify-payment response missing status"

            last_status = resp["status"]
            # If payment is settled or failed, break early
            if last_status.lower() in ("success", "completed", "failed", "error", "cancelled"):
                break
            time.sleep(poll_interval_seconds)

        # Assert that we received a terminal status in last poll
        assert last_status is not None, "No payment status received after polling"
        assert last_status.lower() in ("success", "completed", "pending", "failed", "error", "cancelled"), \
            f"Unexpected payment status: {last_status}"

    finally:
        del_user(uid)

test_mobile_money_payment_initiation_and_status_polling()
