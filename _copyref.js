const { Client } = require('pg');
const PROD = { host:'aws-1-eu-central-1.pooler.supabase.com', port:5432, user:'stg_replica_reader.upuhjekwmtjnjksqikdu', password:'Stg_Repl_2026_xR7qZ9pL', database:'postgres', ssl:{rejectUnauthorized:false} };
const STG  = { host:'aws-1-eu-central-1.pooler.supabase.com', port:5432, user:'stg_writer.nedqshrgqhnvpidgkect', password:'Stg_Wr_2026_xR7qZ9pL', database:'postgres', ssl:{rejectUnauthorized:false} };
const tables = ['countries','country_regions','app_settings','commission_rules'];
(async()=>{
  const prod=new Client(PROD); await prod.connect();
  const stg=new Client(STG); await stg.connect();
  await stg.query("SET session_replication_role='replica';");
  for(const t of tables){
    const rows=(await prod.query(`SELECT * FROM public.${t}`)).rows;
    if(!rows.length){ console.log(`${t}: 0 rows on prod`); continue; }
    const cols=Object.keys(rows[0]);
    let ins=0;
    for(const r of rows){
      const vals=cols.map((_,i)=>`$${i+1}`).join(',');
      const params=cols.map(c=>r[c]);
      try{ await stg.query(`INSERT INTO public.${t} (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${vals}) ON CONFLICT DO NOTHING`, params); ins++; }
      catch(e){ console.log(`  ${t} row err: ${e.message}`); }
    }
    console.log(`${t}: copied ${ins}/${rows.length}`);
  }
  await stg.query("SET session_replication_role='origin';");
  await prod.end(); await stg.end();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
