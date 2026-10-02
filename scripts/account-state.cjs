const {PrismaClient}=require('@prisma/client');
const {createHash}=require('node:crypto');
const db=new PrismaClient();
(async()=>{
 const [users,households,members,sessions]=await Promise.all([db.user.findMany({orderBy:{id:'asc'}}),db.household.findMany({select:{id:true,name:true,createdAt:true,updatedAt:true},orderBy:{id:'asc'}}),db.householdMember.findMany({orderBy:[{householdId:'asc'},{userId:'asc'}]}),db.session.findMany({orderBy:{id:'asc'}})]);
 console.log(JSON.stringify({users:users.length,households:households.length,members:members.length,sessions:sessions.length,digest:createHash('sha256').update(JSON.stringify({users,households,members,sessions})).digest('hex')}));
})().finally(()=>db.$disconnect());
