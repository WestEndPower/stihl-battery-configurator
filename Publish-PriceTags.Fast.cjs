'use strict';
// Node 22+ built-ins only. One private Edge process, one configurator tab,
// one PDF tab. All prices and layout come from the original printPriceTag().
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    socket.addEventListener('close', () => this.fail(new Error('Edge connection closed.')));
    socket.addEventListener('error', () => this.fail(new Error('Edge connection failed.')));
  }
  fail(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(new Error('Edge connection timed out.')); }, 15000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Cannot connect to Edge.')); }, { once: true });
    });
    return new CDP(socket);
  }
  send(method, params = {}, sessionId, timeoutMs = 120000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression, sessionId, timeoutMs = 120000) {
    const result = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs - 1000
    }, sessionId, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }
}

async function main(jobPath) {
  if (typeof WebSocket !== 'function') throw new Error('Node 22 or newer is required.');
  const job = JSON.parse((await fs.readFile(jobPath, 'utf8')).replace(/^\uFEFF/, ''));
  const url = new URL(job.configuratorUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('The fast publisher requires the local configurator server.');
  }
  url.searchParams.delete('priceTagBatch');
  url.searchParams.delete('priceTagSku');
  url.searchParams.set('priceTagPublisher', '1');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'WestEndPriceTagsFast-'));
  let edge, cdp, processError;
  const failures = [];
  const started = Date.now();
  let published = 0;
  try {
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      `--user-data-dir=${profile}`, 'about:blank'
    ];
    edge = spawn(job.edgePath, args, { windowsHide: true, stdio: 'ignore' });
    edge.on('error', error => { processError = error; });
    let browserUrl;
    const launchDeadline = Date.now() + 30000;
    while (Date.now() < launchDeadline) {
      if (processError) throw processError;
      if (edge.exitCode !== null) throw new Error(`Edge exited during startup (${edge.exitCode}).`);
      try {
        const [port, endpoint] = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
        if (port && endpoint) { browserUrl = `ws://127.0.0.1:${port}${endpoint}`; break; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(100);
    }
    if (!browserUrl) throw new Error('Edge did not start its PDF service within 30 seconds.');
    cdp = await CDP.connect(browserUrl);
    async function makeTab() {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      return sessionId;
    }
    const configurator = await makeTab();
    const printer = await makeTab();
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, printer);
    const navigation = await cdp.send('Page.navigate', { url: url.href }, configurator);
    if (navigation.errorText) throw new Error(navigation.errorText);
    const readyDeadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      let status;
      try {
        status = await cdp.evaluate(`({ready: window.WestEndPriceTagPublisher?.version === 1,
          error: document.querySelector('#stihl-load-status.stihl-error')?.textContent || ''})`, configurator, 15000);
      } catch (error) {
        if (!/context|navigat/i.test(error.message)) throw error;
      }
      if (status?.error) throw new Error(status.error);
      if (status?.ready) { ready = true; break; }
      await delay(200);
    }
    if (!ready) throw new Error('Configurator not ready. Check that the fast-publisher hook was installed in the served index.html.');
    console.log(`Configurator loaded once. Publishing ${job.products.length} tags...`);
    for (const product of job.products) {
      const tagStarted = Date.now();
      let staging;
      try {
        const result = await cdp.evaluate(`window.WestEndPriceTagPublisher.render(${JSON.stringify(product.sku)})`, configurator, 180000);
        if (result.sku.toUpperCase() !== product.sku.toUpperCase()) throw new Error('Returned SKU does not match requested SKU.');
        const base = new URL('./', url).href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const html = result.html.replace(/<head>/i, `<head><base href="${base}">`);
        const { frameTree } = await cdp.send('Page.getFrameTree', {}, printer);
        await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, printer);
        await cdp.evaluate(`(async () => {
          if (!document.querySelector('.tag-sheet') || document.documentElement.getAttribute('data-price-tag-ready') !== 'true') {
            throw new Error('Price-tag document did not finish rendering.');
          }
          const ready = Promise.all([
            document.fonts.ready,
            ...Array.from(document.images, image => image.decode().catch(() => {
              throw new Error('Price-tag image or QR code failed to load: ' + image.src);
            }))
          ]);
          let timer;
          try {
            await Promise.race([ready, new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('Price-tag image loading timed out.')), 45000);
            })]);
          } finally { clearTimeout(timer); }
          return true;
        })()`, printer, 60000);
        const pdf = await cdp.send('Page.printToPDF', {
          printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true,
          paperWidth: 8.5, paperHeight: 11,
          marginTop: 0.25, marginBottom: 0.25, marginLeft: 0.25, marginRight: 0.25
        }, printer);
        const bytes = Buffer.from(pdf.data, 'base64');
        if (bytes.length <= 1000 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Edge returned an invalid PDF.');
        if (path.basename(product.fileName) !== product.fileName || !product.fileName.endsWith('.pdf')) throw new Error('Invalid output filename.');
        const localFile = path.join(profile, 'finished.pdf');
        await fs.writeFile(localFile, bytes);
        staging = path.join(job.outputFolder, `${product.fileName}.partial-${process.pid}`);
        await fs.copyFile(localFile, staging);
        await fs.rename(staging, path.join(job.outputFolder, product.fileName));
        staging = null;
        published++;
        console.log(`PASS ${published}/${job.products.length}: ${product.model} (${product.sku}) - ${((Date.now() - tagStarted) / 1000).toFixed(1)}s`);
      } catch (error) {
        if (staging) await fs.rm(staging, { force: true }).catch(() => {});
        failures.push(`${product.model} (${product.sku}): ${error.message}`);
        console.error(`FAIL ${failures.at(-1)}`);
        // A timed-out pricing evaluation may still be running: do not reuse its state.
        if (/timed out|connection|context|already being generated|execution was terminated/i.test(error.message)) break;
      }
    }
    if (failures.length) throw new Error(`${failures.length} tag(s) failed; full publish record was not changed.\n${failures.join('\n')}`);
    console.log(`Published ${published} tags in ${((Date.now() - started) / 60_000).toFixed(1)} minutes.`);
  } finally {
    if (cdp) {
      await cdp.send('Browser.close', {}, undefined, 5000).catch(() => {});
      cdp.socket.close();
    }
    if (edge && edge.exitCode === null && !processError) {
      await Promise.race([new Promise(resolve => edge.once('exit', resolve)), delay(3000)]);
      if (edge.exitCode === null) edge.kill();
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      try { await fs.rm(profile, { recursive: true, force: true }); break; }
      catch { await delay(300); }
    }
  }
}

if (require.main === module) {
  main(process.argv[2]).catch(error => { console.error(`FAILED: ${error.message}`); process.exitCode = 1; });
}
module.exports = { CDP, main };
