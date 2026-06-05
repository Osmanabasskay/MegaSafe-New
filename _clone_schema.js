/* Faithful public-schema clone: prod -> staging, via live catalog (no migrations). */
const { Client } = require('pg');
const fs = require('fs');

const PROD = { host:'aws-1-eu-central-1.pooler.supabase.com', port:5432, user:'stg_replica_reader.upuhjekwmtjnjksqikdu', password:'Stg_Repl_2026_xR7qZ9pL', database:'postgres', ssl:{rejectUnauthorized:false} };
const STG  = { host:'aws-1-eu-central-1.pooler.supabase.com', port:5432, user:'stg_writer.nedqshrgqhnvpidgkect', password:'Stg_Wr_2026_xR7qZ9pL', database:'postgres', ssl:{rejectUnauthorized:false} };

const q = async (c, sql, params) => (await c.query(sql, params)).rows;

(async () => {
  const prod = new Client(PROD); await prod.connect();

  const sections = {}; // name -> [stmts]
  const add = (k, s) => { (sections[k] ||= []).push(s); };

  // 1. ENUMS
  for (const r of await q(prod, `
    SELECT t.typname AS name, string_agg(quote_literal(e.enumlabel), ',' ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' GROUP BY t.typname ORDER BY t.typname`)) {
    add('enums', `CREATE TYPE public."${r.name}" AS ENUM (${r.labels});`);
  }

  // 1b. SEQUENCES (standalone; needed by column defaults like nextval)
  for (const r of await q(prod, `SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`)) {
    add('sequences', `CREATE SEQUENCE IF NOT EXISTS public."${r.sequencename}";`);
  }

  // 2. TABLES (columns only)
  const tables = await q(prod, `
    SELECT c.oid, c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`);
  for (const t of tables) {
    const cols = await q(prod, `
      SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS notnull,
             pg_get_expr(d.adbin,d.adrelid) AS def
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [t.oid]);
    const defs = cols.map(c => {
      let s = `  "${c.attname}" ${c.type}`;
      if (c.def != null) s += ` DEFAULT ${c.def}`;
      if (c.notnull) s += ' NOT NULL';
      return s;
    });
    add('tables', `CREATE TABLE public."${t.relname}" (\n${defs.join(',\n')}\n);`);
    if (t.relrowsecurity) add('rls', `ALTER TABLE public."${t.relname}" ENABLE ROW LEVEL SECURITY;`);
  }

  // 3. FUNCTIONS (before constraints/policies/views/triggers that may reference them)
  for (const r of await q(prod, `
    SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.proname`)) {
    add('functions', r.def.trim().replace(/;?\s*$/, ';'));
  }

  // 4. CONSTRAINTS: PK/UNIQUE/CHECK first, then FK
  for (const r of await q(prod, `
    SELECT con.conrelid::regclass::text AS tbl, con.conname, pg_get_constraintdef(con.oid) AS def,
           con.contype, (con.contype='f')::int AS is_fk
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND con.contype IN ('p','u','c','f')
    ORDER BY is_fk, con.conname`)) {
    if (r.contype==='f' && /\bauth\.users\b/.test(r.def)) continue; // auth FKs added via privileged MCP later
    add(r.contype==='f'?'fks':'constraints', `ALTER TABLE ${r.tbl} ADD CONSTRAINT "${r.conname}" ${r.def};`);
  }

  // 5. INDEXES (non-constraint)
  for (const r of await q(prod, `
    SELECT pg_get_indexdef(i.indexrelid) AS def
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT i.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid=i.indexrelid)`)) {
    add('indexes', r.def + ';');
  }

  // 6. VIEWS (+ security_invoker option)
  for (const r of await q(prod, `
    SELECT c.relname, pg_get_viewdef(c.oid,true) AS def,
           (SELECT string_agg(o,',') FROM unnest(c.reloptions) o) AS opts
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='v' ORDER BY c.relname`)) {
    add('views', `CREATE OR REPLACE VIEW public."${r.relname}" AS\n${r.def}`);
    if (r.opts) add('views', `ALTER VIEW public."${r.relname}" SET (${r.opts});`);
  }

  // 7. TRIGGERS (public tables only; auth.users trigger handled separately)
  for (const r of await q(prod, `
    SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`)) {
    add('triggers', r.def + ';');
  }

  // 8. POLICIES
  for (const r of await q(prod, `
    SELECT c.relname AS tbl, pol.polname,
      CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS perm,
      CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS cmd,
      pg_get_expr(pol.polqual, pol.polrelid) AS qual,
      pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck,
      ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles))::text[] AS roles
    FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'`)) {
    let rolesArr = r.roles;
    if (typeof rolesArr === 'string') rolesArr = rolesArr.replace(/^{|}$/g,'').split(',').filter(Boolean);
    const roles = (rolesArr && rolesArr.length) ? rolesArr.map(x=>`"${x}"`).join(',') : 'public';
    let s = `CREATE POLICY "${r.polname}" ON public."${r.tbl}" AS ${r.perm} FOR ${r.cmd} TO ${roles}`;
    if (r.qual != null) s += ` USING (${r.qual})`;
    if (r.withcheck != null) s += ` WITH CHECK (${r.withcheck})`;
    add('policies', s + ';');
  }

  await prod.end();

  // ---- APPLY ----
  const order = ['sequences','enums','tables','functions','constraints','fks','indexes','views','triggers','rls','policies'];
  let dump = '';
  for (const k of order) for (const s of (sections[k]||[])) dump += s + '\n\n';
  fs.writeFileSync('prod_public_clone.sql', dump);
  const counts = Object.fromEntries(order.map(k => [k, (sections[k]||[]).length]));
  console.log('generated:', JSON.stringify(counts));

  const stg = new Client(STG); await stg.connect();
  await stg.query("SET session_replication_role = 'replica';").catch(()=>{}); // reduce FK/trigger noise during load
  await stg.query("SET check_function_bodies = off;").catch(()=>{}); // allow out-of-order function/view deps
  const failures = [];
  for (const k of order) {
    for (const s of (sections[k]||[])) {
      try { await stg.query(s); }
      catch (e) { failures.push({ section:k, err:e.message, sql:s.slice(0,160) }); }
    }
  }
  await stg.query("SET session_replication_role = 'origin';").catch(()=>{});
  await stg.end();
  console.log('FAILURES:', failures.length);
  fs.writeFileSync('clone_failures.json', JSON.stringify(failures, null, 2));
  for (const f of failures.slice(0,40)) console.log(`[${f.section}] ${f.err} :: ${f.sql}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
