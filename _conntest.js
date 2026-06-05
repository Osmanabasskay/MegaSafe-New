const { Client } = require('pg');
const hosts = ['aws-0-eu-central-1.pooler.supabase.com','aws-1-eu-central-1.pooler.supabase.com'];
const projs = [
  { ref:'nedqshrgqhnvpidgkect', user:'stg_writer', pass:'Stg_Wr_2026_xR7qZ9pL' },
  { ref:'upuhjekwmtjnjksqikdu', user:'stg_replica_reader', pass:'Stg_Repl_2026_xR7qZ9pL' },
];
(async () => {
  for (const p of projs) for (const h of hosts) {
    const c = new Client({ host:h, port:5432, user:`${p.user}.${p.ref}`, password:p.pass, database:'postgres', ssl:{rejectUnauthorized:false}, connectionTimeoutMillis:12000 });
    try { await c.connect(); const r=await c.query('select current_user'); console.log(`OK  ${p.ref} @ ${h}: ${r.rows[0].current_user}`); await c.end(); }
    catch(e){ console.log(`ERR ${p.ref} @ ${h}: ${e.message}`); try{await c.end();}catch{} }
  }
})();
