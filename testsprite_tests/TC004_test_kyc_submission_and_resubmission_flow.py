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

def test_kyc_submission_and_resubmission_flow():
    email, pwd, uid = make_user()
    try:
        jwt, user_id = login(email, pwd)
        headers = auth_h(jwt)
        # Submit KYC details
        kyc_payload = {
            "user_id": user_id,
            "identity_type": "national_id",
            "national_id_number": "SL123",
            "address": "Freetown",
            "kyc_status": "pending",
            "national_id_front_url": "https://x.com/f.jpg",
            "national_id_back_url": "https://x.com/b.jpg",
            "selfie_url": "https://x.com/s.jpg",
            "guarantor_name": "Jane",
            "guarantor_phone": "+23270000000",
            "guarantor_relationship": "Friend"
        }
        r = requests.post(SUPA + "/rest/v1/kyc_submissions",
                          json=kyc_payload, headers=headers, timeout=30)
        assert r.status_code in (200,201), "kyc insert: " + r.text
        kyc_id = r.json()[0]["id"]
        
        # Confirm KYC status is pending
        r_get = requests.get(SUPA + f"/rest/v1/kyc_submissions?id=eq.{kyc_id}",
                             headers=headers, timeout=30)
        assert r_get.status_code == 200
        assert r_get.json()[0]["kyc_status"] == "pending"
        
        # Simulate rejection by patching kyc_status to rejected
        r_reject = requests.patch(SUPA + f"/rest/v1/kyc_submissions?id=eq.{kyc_id}",
                                  json={"kyc_status": "rejected"},
                                  headers=headers, timeout=30)
        assert r_reject.status_code == 200
        # Verify rejected status
        r_check_reject = requests.get(SUPA + f"/rest/v1/kyc_submissions?id=eq.{kyc_id}",
                             headers=headers, timeout=30)
        assert r_check_reject.status_code == 200
        assert r_check_reject.json()[0]["kyc_status"] == "rejected"
        
        # Resubmit updated info with kyc_status set back to pending
        updated_payload = {
            "national_id_number": "SL1234",
            "address": "Freetown Updated",
            "kyc_status": "pending"
        }
        r_resubmit = requests.patch(SUPA + f"/rest/v1/kyc_submissions?id=eq.{kyc_id}",
                                   json=updated_payload,
                                   headers=headers, timeout=30)
        assert r_resubmit.status_code == 200
        assert r_resubmit.json()[0]["kyc_status"] == "pending"
        # Validate updated fields present
        assert r_resubmit.json()[0]["national_id_number"] == "SL1234"
        assert r_resubmit.json()[0]["address"] == "Freetown Updated"
    finally:
        del_user(uid)

test_kyc_submission_and_resubmission_flow()