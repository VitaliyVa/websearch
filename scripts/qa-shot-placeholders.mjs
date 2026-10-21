/** Real panel + actual post-migration Sheets snapshot; all manager POSTs blocked. */
import assert from 'node:assert/strict';import {readFileSync,readdirSync,writeFileSync} from 'node:fs';import {chromium} from 'playwright';
const dir='workspaces/production/visual-recheck-56-2026-10-21';const file=readdirSync(dir).filter(f=>f.startsWith('sheet-after-apply-')).sort().at(-1);assert.ok(file);
const sheet=JSON.parse(readFileSync(`${dir}/${file}`));
const keys={'Leads':'leads','Ліди без сайту':'noSiteLeads','З хорошим сайтом':'upsell','Manual review':'manual','NO_SITE':'noSite','Архів':'archive'};
const tabs=sheet.sheets.filter(s=>keys[s.properties.title]).map(s=>{const grid=s.data[0].rowData;const headers=grid[0].values.map(c=>c.userEnteredValue?.stringValue??'');return {key:keys[s.properties.title],title:s.properties.title,rows:grid.slice(1).filter(r=>r.values?.[0]?.userEnteredValue?.stringValue).map(r=>({...Object.fromEntries(headers.map((h,c)=>{const v=r.values[c]?.userEnteredValue;return [h,v?.stringValue??v?.numberValue??v?.formulaValue??''];})),__tab:s.properties.title}))};});
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});
try{
 await page.route('**/*',route=>route.request().method()==='POST'?route.abort():route.continue());
 await page.route(/action=leads/,route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,user:'Read-only QA',data:{tabs,statuses:['Не опрацьовано']}})}));
 await page.addInitScript(()=>sessionStorage.setItem('websearch.code','local-read-only-qa'));
 await page.goto('http://127.0.0.1:4175/websearch/',{waitUntil:'networkidle'});
 const search=page.getByRole('textbox',{name:'Пошук',exact:true});
 await search.fill('Pro Floors Inc');
 const card=page.locator('.lead-card').filter({has:page.getByText('Pro Floors Inc',{exact:true})});
 await card.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelector('img.shot')?.naturalWidth>0);
 await card.screenshot({path:`${dir}/placeholder-site.jpg`});
 await card.locator('.shot-frame').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.lightbox img')].every(i=>i.complete&&i.naturalWidth>0));
 await page.keyboard.press('Escape');
 await search.fill('');
 await page.getByRole('button',{name:'Ліди без сайту (5)',exact:true}).click();
 const noSite=page.locator('.lead-card').first();await noSite.scrollIntoViewIfNeeded();
 assert.equal(await noSite.locator('.shot-placeholder').innerText(),'Нема сайту');
 assert.equal(await noSite.locator('img.shot').count(),0);
 await noSite.screenshot({path:`${dir}/placeholder-no-site.jpg`});
 await page.setViewportSize({width:320,height:900});
 await page.screenshot({path:`${dir}/placeholder-mobile.jpg`});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1440,height:1100});
 await page.route('**/shots/ChIJo-0j4oMts1IRbV_w9Xbqk3g-mobile.jpg',r=>r.fulfill({status:404,body:''}));
 await page.reload({waitUntil:'networkidle'});await search.fill('Pro Floors Inc');
 await card.scrollIntoViewIfNeeded();await card.getByText('Немає знімка',{exact:true}).waitFor();
 assert.equal(await card.getByText('Нема сайту',{exact:true}).count(),0);
 console.log('PASS: saved screenshot, zoom, no-site placeholder, screenshot failure, 320px overflow; all POST blocked');
}finally{await browser.close();}
