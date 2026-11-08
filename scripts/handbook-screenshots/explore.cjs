// temporary explorer
const { chromium } = require('playwright');
const mock = require('./mock-backend.cjs');
(async () => {
  const persona = process.argv[2] || 'agent';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await mock.install(ctx, persona, { log: true });
  const p = await ctx.newPage();
  p.on('console', m=>{ if(m.type()==='error') console.log('CONSOLE', m.text().slice(0,300)); });
  await p.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/claude-0/-home-user-nextdesk/b6577631-f6e5-57c6-8b66-444422a57536/scratchpad/x-'+persona+'.png' });
  console.log((await p.innerText('body')).slice(0, 1200));
  await b.close();
})();
