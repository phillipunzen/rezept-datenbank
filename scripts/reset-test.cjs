const {PrismaClient}=require('@prisma/client');
if(!process.env.DATABASE_URL||new URL(process.env.DATABASE_URL).pathname!=='/rezeptdatenbank_test')throw Error('Disposable test database required');
const db=new PrismaClient();
db.$transaction(async tx=>{
 const tables=await tx.$queryRaw`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME<>'_prisma_migrations'`;
 await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
 try{for(const {name} of tables){if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))throw Error('Unexpected table');await tx.$executeRawUnsafe(`DELETE FROM \`${name}\``);}}
 finally{await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');}
},{timeout:20000}).finally(()=>db.$disconnect());
