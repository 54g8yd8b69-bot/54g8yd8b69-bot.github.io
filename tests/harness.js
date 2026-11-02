// Tiny browser test harness: plain Node + Playwright, no test framework needed.
// Run: BASE=http://localhost:8765 node tests/smoke.js
const {chromium}=require('playwright');
const BASE=process.env.BASE||'http://localhost:8765';
const results=[];let browser;
const IGNORE=/Failed to load resource|favicon|net::ERR_|service ?worker|bad HTTP response code \(404\)/i;
async function page(path,opts={}){const ctx=await browser.newContext({viewport:{width:1300,height:900},acceptDownloads:true,...opts});const pg=await ctx.newPage();pg._errors=[];
  pg.on('pageerror',e=>pg._errors.push(e.message));pg.on('console',m=>{if(m.type()==='error'&&!IGNORE.test(m.text()))pg._errors.push(m.text())});
  await pg.goto(BASE+path);await pg.waitForTimeout(600);return pg}
function expect(cond,msg){if(!cond)throw new Error(msg)}
async function test(name,fn){const t=Date.now();try{await fn();results.push([true,name]);console.log(`  ✓ ${name} (${Date.now()-t} ms)`)}catch(e){results.push([false,name]);console.log(`  ✗ ${name}\n      ${String(e.message).split('\n')[0]}`)}}
async function noErrors(pg){expect(!pg._errors.length,'page errors: '+pg._errors.join(' | '))}
async function run(suite){browser=await chromium.launch();console.log(suite.name);try{await suite.fn()}finally{await browser.close()}
  const bad=results.filter(r=>!r[0]);console.log(`\n${results.length-bad.length} passed, ${bad.length} failed`);process.exit(bad.length?1:0)}
module.exports={page,expect,test,noErrors,run,BASE};
