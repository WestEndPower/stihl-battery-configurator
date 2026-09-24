'use strict';

// Reads model/page matches from the existing catalog crawl. Run through the
// PowerShell wrapper, which starts Edge with a separate debugging profile.
const fs = require('fs');
const [port, inputPath, outputPath] = process.argv.slice(2);
const tasks = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (!this.pending.has(message.id)) return;
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result || {});
      };
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    const result = new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
    this.ws.send(JSON.stringify({id, method, params}));
    return result;
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Page evaluation failed');
  return result.result && result.result.value;
}

async function openPage(cdp, url) {
  await cdp.send('Page.navigate', {url});
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    const state = await evaluate(cdp, `({ready:document.readyState,title:document.title,text:(document.body?.innerText||'').slice(0,300)})`);
    if (!state) continue;
    if (/just a moment|verify you are human|performing security verification/i.test(state.title + ' ' + state.text)) {
      if (i === 4) process.stdout.write('\nComplete the security check in Edge; scanning will continue.\n');
      continue;
    }
    if (state.ready === 'complete') return;
  }
  throw new Error('Timed out opening ' + url);
}

// Extract only the main product image metadata; related product thumbnails
// and guessed filenames must never become catalog image links.
function imageCandidates() {
  const found = [];
  const add = (value, source) => {
    if (Array.isArray(value)) return value.forEach(item => add(item, source));
    const raw = typeof value === 'string' ? value : value && (value.url || value.contentUrl);
    if (!raw) return;
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== 'https:' || /logo|placeholder|no.?image|favicon|default/i.test(url.pathname)) return;
      if (!found.some(item => item.url === url.href)) found.push({url:url.href, source});
    } catch {}
  };
  for (const tag of document.querySelectorAll('script[type="application/ld+json"]')) {
    let root;
    try { root = JSON.parse(tag.textContent); } catch { continue; }
    const queue = [root];
    while (queue.length) {
      const item = queue.shift();
      if (Array.isArray(item)) { queue.push(...item); continue; }
      if (!item || typeof item !== 'object') continue;
      if (item['@graph']) queue.push(item['@graph']);
      if (String(item['@type'] || '').toLowerCase() === 'product') add(item.image, 'Product JSON-LD');
    }
  }
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const element = document.querySelector(selector);
    if (element) add(element.content, selector.includes('og:') ? 'Open Graph' : 'Twitter');
  }
  return {title:document.title, heading:document.querySelector('h1')?.textContent || '', images:found};
}

async function checkImage(cdp, url) {
  const expression = `(async()=>{const image=new Image();return await Promise.race([new Promise(resolve=>{image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>resolve(null);image.src=${JSON.stringify(url)}}),new Promise(resolve=>setTimeout(()=>resolve(null),12000))])})()`;
  const size = await evaluate(cdp, expression);
  return size && size.width >= 250 && size.height >= 200 ? size : null;
}

(async () => {
  let targets;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) { targets = await response.json(); break; }
    } catch {}
    await sleep(500);
  }
  if (!targets) throw new Error('Could not connect to the Edge debugging session.');
  const page = targets.find(target => target.type === 'page');
  if (!page) throw new Error('No Edge page target found.');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const results = [];
  for (const [index, task] of tasks.entries()) {
    process.stdout.write(`${index + 1}/${tasks.length} ${task.model}\n`);
    if (!task.urls.length) { results.push({...task, status:'No catalog page', image:'', source:''}); continue; }
    let result = {model:task.model, urls:task.urls, status:'No product image', image:'', source:''};
    for (const url of task.urls.slice(0, 2)) {
      try {
        await openPage(cdp, url);
        const details = await evaluate(cdp, `(${imageCandidates.toString()})()`);
        const expected = norm(task.model);
        if (!norm(details.title + ' ' + details.heading + ' ' + url).includes(expected)) {
          result.status = 'Page model mismatch';
          continue;
        }
        for (const candidate of details.images) {
          const size = await checkImage(cdp, candidate.url);
          if (!size) continue;
          result = {model:task.model, urls:task.urls, status:'Matched', image:candidate.url, source:candidate.source, page:url, width:size.width, height:size.height};
          break;
        }
        if (result.status === 'Matched') break;
      } catch (error) { result.status = 'Page error: ' + error.message; }
    }
    results.push(result);
  }
  fs.writeFileSync(outputPath, JSON.stringify({collectedAt:new Date().toISOString(), results}, null, 2));
  process.stdout.write(`\nMatched ${results.filter(item => item.status === 'Matched').length} of ${tasks.length} models.\n`);
  cdp.ws.close();
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
