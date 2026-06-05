const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lZHFzaHJncWhudnBpZGdrZWN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0ODY5MTEsImV4cCI6MjA5NjA2MjkxMX0.ukbwut_BN14l8xo8q7LJI9pyoHLbECEQdvTUOZxEteI';
const URL='https://nedqshrgqhnvpidgkect.supabase.co/auth/v1/token?grant_type=password';
(async()=>{
  for(const email of ['kyc.member@miosusu.test','admin@miosusu.test']){
    const r=await fetch(URL,{method:'POST',headers:{'apikey':ANON,'Content-Type':'application/json'},body:JSON.stringify({email,password:'Passw0rd!Test1'})});
    const j=await r.json();
    console.log(email, r.status, j.access_token?('OK token len '+j.access_token.length+' user='+j.user?.id):JSON.stringify(j));
  }
})();
