const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lZHFzaHJncWhudnBpZGdrZWN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0ODY5MTEsImV4cCI6MjA5NjA2MjkxMX0.ukbwut_BN14l8xo8q7LJI9pyoHLbECEQdvTUOZxEteI';
const BASE='https://nedqshrgqhnvpidgkect.supabase.co';
(async()=>{
  const lr=await fetch(BASE+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'apikey':ANON,'Content-Type':'application/json'},body:JSON.stringify({email:'kyc.member@miosusu.test',password:'Passw0rd!Test1'})});
  const tok=(await lr.json()).access_token;
  const H={'apikey':ANON,'Authorization':'Bearer '+tok,'Content-Type':'application/json'};
  for(const [name,path,opt] of [
    ['get_vault_summary','/rest/v1/rpc/get_vault_summary',{method:'POST',headers:H,body:'{}'}],
    ['get_kyc_status','/rest/v1/rpc/get_kyc_status',{method:'POST',headers:H,body:'{}'}],
    ['get_my_role','/rest/v1/rpc/get_my_role',{method:'POST',headers:H,body:'{}'}],
    ['own profile (RLS)','/rest/v1/profiles?select=id,email,kyc_status,role',{headers:H}],
    ['get_countries','/rest/v1/rpc/get_countries',{method:'POST',headers:H,body:'{}'}],
  ]){
    try{const r=await fetch(BASE+path,opt);const t=await r.text();console.log(`${name}: ${r.status} ${t.slice(0,180)}`);}
    catch(e){console.log(`${name}: ERR ${e.message}`);}
  }
})();
