import requests, uuid, time
from datetime import datetime, timedelta

SUPA = "https://upuhjekwmtjnjksqikdu.supabase.co"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdWhqZWt3bXRqbmprc3Fpa2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTEwMTgsImV4cCI6MjA5NTY3MDE4fQ.CTarbndaugD2SXafK1BCn8WwW9oZCy0vviR-SGkhm9Y"
SVC  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdWhqZWt3bXRqbmprc3Fpa2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk5MTAxOCwiZXhwIjoyMDk1NTY3MDE4fQ.Q3uww4XtTXoqMVWNpId2k-YwXGeMWqdesqAJq9QljPU"

ANON_H = {"apikey": ANON}
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
    headers = {"apikey": ANON}
    data = {"grant_type": "password", "email": email, "password": pwd}
    r = requests.post(SUPA + "/auth/v1/token", data=data, headers=headers, timeout=30)
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

def test_notification_inbox_and_mark_as_read():
    email, pwd, uid = make_user()
    try:
        jwt, user_id = login(email, pwd)
        ah = auth_h(jwt)

        # Create a notification
        notif_payload = {"user_id": user_id, "title": "Hi", "message": "Test", "read": False}
        r = requests.post(SUPA + "/rest/v1/notifications", json=notif_payload, headers=ah, timeout=30)
        assert r.status_code in (200, 201), "notif create failed: " + r.text
        notif = r.json()
        assert isinstance(notif, list) and len(notif) > 0, "Notification create response malformed"
        nid = notif[0]["id"]

        # Get notification inbox for the user
        r2 = requests.get(f"{SUPA}/rest/v1/notifications?user_id=eq.{user_id}", headers=ah, timeout=30)
        assert r2.status_code == 200, "getting notifications failed: " + r2.text
        notifs = r2.json()
        assert any(n["id"] == nid for n in notifs), "Notification not found in inbox"

        # Mark the notification as read
        r3 = requests.patch(f"{SUPA}/rest/v1/notifications?id=eq.{nid}", json={"read": True}, headers=ah, timeout=30)
        assert r3.status_code == 200, "mark as read failed: " + r3.text
        resp_patch = r3.json()
        assert isinstance(resp_patch, list) and resp_patch[0]["read"] == True, "Notification not marked as read"

        # Verify unread notifications count (should not include this notification)
        r4 = requests.get(f"{SUPA}/rest/v1/notifications?user_id=eq.{user_id}&read=eq.false", headers=ah, timeout=30)
        assert r4.status_code == 200, "getting unread notifications failed: " + r4.text
        unread_notifs = r4.json()
        assert not any(n["id"] == nid for n in unread_notifs), "Marked notification still appears as unread"

    finally:
        del_user(uid)

test_notification_inbox_and_mark_as_read()
