import requests, uuid
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

def test_savings_goal_creation_and_transactions():
    email, pwd, uid = make_user()
    try:
        jwt, _ = login(email, pwd)
        ah = auth_h(jwt)
        deadline_date = (datetime.utcnow() + timedelta(days=30)).strftime('%Y-%m-%d')

        # Create savings goal with required fields per PRD
        r_goal = requests.post(
            SUPA + "/rest/v1/savings_goals",
            json={
                "user_id": uid,
                "target_amount": 100000,
                "deadline": deadline_date
            },
            headers=ah,
            timeout=30
        )
        assert r_goal.status_code in (200, 201), "savings goal creation failed: " + r_goal.text
        json_response = r_goal.json()
        # When Prefer=return=representation, response is a list of created rows
        assert isinstance(json_response, list) and len(json_response) > 0, "No goal returned in response"
        gid = json_response[0]["id"]

        # Deposit funds toward goal
        r_deposit = requests.post(
            SUPA + "/rest/v1/savings_transactions",
            json={
                "goal_id": gid,
                "user_id": uid,
                "amount": 50000,
                "type": "deposit"
            },
            headers=ah,
            timeout=30
        )
        assert r_deposit.status_code in (200, 201), "deposit transaction failed: " + r_deposit.text

        # Verify saved amount updated
        r_goal_get = requests.get(
            SUPA + f"/rest/v1/savings_goals?id=eq.{gid}",
            headers=ah,
            timeout=30
        )
        assert r_goal_get.status_code == 200, "failed fetching savings goal after deposit"
        saved_amount = r_goal_get.json()[0].get("saved_amount", 0)
        assert saved_amount >= 50000, f"saved_amount {saved_amount} less than deposited 50000"

        # Request withdrawal from savings goal
        r_withdraw = requests.post(
            SUPA + "/rest/v1/savings_transactions",
            json={
                "goal_id": gid,
                "user_id": uid,
                "amount": 10000,
                "type": "withdrawal"
            },
            headers=ah,
            timeout=30
        )
        assert r_withdraw.status_code in (200, 201), "withdrawal transaction failed: " + r_withdraw.text

        # Verify saved amount decreased accordingly
        r_goal_after_withdraw = requests.get(
            SUPA + f"/rest/v1/savings_goals?id=eq.{gid}",
            headers=ah,
            timeout=30
        )
        assert r_goal_after_withdraw.status_code == 200, "failed fetching savings goal after withdrawal"
        saved_amount_after_withdraw = r_goal_after_withdraw.json()[0].get("saved_amount", 0)
        assert saved_amount_after_withdraw <= saved_amount - 10000 + 1, (
            f"saved_amount after withdrawal {saved_amount_after_withdraw} not decreased by withdrawal amount"
        )
    finally:
        del_user(uid)

test_savings_goal_creation_and_transactions()
