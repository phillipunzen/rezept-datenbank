const {PrismaClient}=require('@prisma/client');
const {createHash}=require('node:crypto');
const db=new PrismaClient();
(async()=>{
 const tables=await db.$queryRaw`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME<>'_prisma_migrations' ORDER BY TABLE_NAME`;
 const rows={},counts={};
 for(const {name} of tables){
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))throw Error('Unexpected table name');
  const result=await db.$queryRawUnsafe(`SELECT * FROM \`${name}\``);
  // New empty tables do not change the fingerprint; every existing row and column does.
  if(!result.length)continue;
  rows[name]=result.map(row=>JSON.stringify(row,(_,v)=>typeof v==='bigint'?v.toString():v)).sort();counts[name]=result.length;
 }
 console.log(JSON.stringify({counts,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}));
})().finally(()=>db.$disconnect());
