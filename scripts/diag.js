const fs=require('fs');
const env={};
fs.readFileSync('.env','utf8').split('\n').forEach(l=>{
  const eq=l.indexOf('=');
  if(eq>0&&!l.startsWith('#')){
    env[l.substring(0,eq).trim()]=l.substring(eq+1).trim();
  }
});
const jwt=require('jsonwebtoken');
const mysql=require('mysql2/promise');
const secret=env.JWT_SECRET;
console.log('JWT_SECRET length:',secret?secret.length:'UNDEFINED');
console.log('NODE_ENV:',env.NODE_ENV||'not set');

const token=jwt.sign({id:1,nome:'Test',email:'test@aluforce.ind.br',role:'admin',deviceId:'diag-123'},secret,{algorithm:'HS256',audience:'aluforce',expiresIn:'8h'});
console.log('Token signed OK, length:',token.length);

try{
  const d=jwt.verify(token,secret,{algorithms:['HS256']});
  console.log('Verify OK:',d.email);
}catch(e){
  console.log('Verify FAIL:',e.message);
}

const http=require('http');
const req=http.request({hostname:'localhost',port:3000,path:'/api/me',method:'GET',headers:{'Authorization':'Bearer '+token}},res=>{
  let b='';
  res.on('data',c=>b+=c);
  res.on('end',()=>{
    console.log('/api/me status:',res.statusCode);
    try{const d=JSON.parse(b);console.log('/api/me result:',res.statusCode===200?(d.email||'OK'):d.message);}catch(e){console.log('body:',b.substring(0,200));}
    process.exit(0);
  });
});
req.on('error',e=>{console.log('HTTP error:',e.message);process.exit(1);});
req.setTimeout(10000,()=>{console.log('TIMEOUT');process.exit(1);});
req.end();
