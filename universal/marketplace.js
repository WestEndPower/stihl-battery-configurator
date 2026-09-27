(() => {
  'use strict';

  const DATA = {
    products: [],
    batteries: [],
    chargers: [],
    compatibility: [],
    batterySystems: new Set(),
    settings: {},
    families: [],
    filtered: []
  };

  const state = {
    category: '',
    power: '',
    seriesOrEngine: '',
    width: '',
    brand: new Set(),
    availability: new Set(),
    buyOnline: false,
    search: '',
    specFilters: new Map(),
    compare: new Set()
  };

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const clean = v => String(v == null ? '' : v).trim();
  const truthy = v => /^(T|TRUE|Y|YES|1)$/i.test(clean(v));
  const num = v => {
    const n = Number(clean(v).replace(/[$,%]/g,''));
    return Number.isFinite(n) ? n : 0;
  };
  const money = v => Number(v||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const esc = v => clean(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function parseCsv(text){
    text = String(text||'').replace(/^\uFEFF/,'');
    const rows=[]; let row=[], field='', q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i], n=text[i+1];
      if(q){
        if(c==='"' && n==='"'){ field+='"'; i++; }
        else if(c==='"'){ q=false; }
        else field+=c;
      }else{
        if(c==='"') q=true;
        else if(c===','){ row.push(field); field=''; }
        else if(c==='\n'){ row.push(field.replace(/\r$/,'')); rows.push(row); row=[]; field=''; }
        else field+=c;
      }
    }
    if(field.length || row.length){ row.push(field.replace(/\r$/,'')); rows.push(row); }
    if(!rows.length) return [];
    const headers=rows.shift().map(clean);
    return rows.filter(r=>r.some(x=>clean(x)!=='')).map(r=>{
      const o={}; headers.forEach((h,i)=>{ if(h) o[h]=r[i] ?? ''; }); return o;
    });
  }

  async function csv(path){
    const r=await fetch(path,{cache:'no-store'});
    if(!r.ok) throw new Error(path+' '+r.status);
    return parseCsv(await r.text());
  }

  function groupFamilies(rows){
    const map=new Map();
    rows.filter(x=>truthy(x.Active)).forEach(p=>{
      const brand=clean(p.BrandID)||clean(p.BrandName)||'Brand';
      const model=clean(p.Model)||clean(p.Description)||clean(p.SKU);
      const key=(brand+'|'+model).toUpperCase();
      if(!map.has(key)){
        map.set(key,{
          key, brand, model,
          category:clean(p.Category)||'Other',
          subcategory:clean(p.SubCategory),
          power:clean(p.PowerType),
          series:clean(p.Series),
          system:clean(p.System),
          image:clean(p.ImageURL),
          productUrl:clean(p.ProductURL),
          sort:num(p.SortOrder)||999999,
          variants:[],
          specs:{}
        });
      }
      const f=map.get(key);
      if(!f.image && clean(p.ImageURL)) f.image=clean(p.ImageURL);
      if(!f.productUrl && clean(p.ProductURL)) f.productUrl=clean(p.ProductURL);
      for(let i=1;i<=10;i++){
        const l=clean(p['SpecLabel'+i]), v=clean(p['SpecValue'+i]);
        if(l && v && !f.specs[l]) f.specs[l]=v;
      }
      f.variants.push({
        sku:clean(p.SKU),
        description:clean(p.Description),
        type:clean(p.ProductType),
        msrp:num(p.MSRP),
        sale:num(p.SalePrice),
        price:num(p.SalePrice)>0 ? num(p.SalePrice) : num(p.MSRP),
        qtyDanbury:num(p.QtyDanbury),
        qtyNewMilford:num(p.QtyNewMilford),
        buyOnline:truthy(p.BuyOnlineEligible),
        localDelivery:truthy(p.LocalDelivery),
        assembly:num(p.AssemblyAmount),
        productUrl:clean(p.ProductURL)
      });
    });
    return Array.from(map.values()).map(f=>{
      f.variants.sort((a,b)=>a.price-b.price || a.type.localeCompare(b.type));
      const positivePrices=f.variants.map(v=>v.price).filter(v=>v>0);
      f.price=positivePrices.length ? Math.min(...positivePrices) : 0;
      f.stock=f.variants.reduce((n,v)=>n+v.qtyDanbury+v.qtyNewMilford,0);
      f.buyOnline=f.variants.some(v=>v.buyOnline);
      f.setup=f.variants.some(v=>v.localDelivery || v.assembly>0);
      return f;
    }).sort((a,b)=>a.sort-b.sort || a.model.localeCompare(b.model,undefined,{numeric:true,sensitivity:'base'}));
  }

  const distinct = a => Array.from(new Set(a.map(clean).filter(Boolean))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));

  function currentPrice(row){
    const sale=num(row && row.SalePrice), msrp=num(row && row.MSRP);
    return sale>0 ? sale : msrp;
  }

  function componentName(row){
    return clean(row && (row.Model||row.BatteryID||row.ChargerID||row.ChargerName||row.Description||row.SKU))
      .replace(/\s+/g,' ').trim();
  }

  function enrichRecommendedPackages(families){
    const compatBySku=new Map(DATA.compatibility.map(x=>[clean(x.ToolSKU).toUpperCase(),x]));
    const batteryById=new Map(DATA.batteries.map(x=>[clean(x.BatteryID).toUpperCase(),x]));
    const chargerById=new Map(DATA.chargers.map(x=>[clean(x.ChargerID).toUpperCase(),x]));

    families.forEach(f=>{
      if(!/battery/i.test(f.power)) return;
      const hasKit=f.variants.some(v=>/kit|package/i.test(v.type));
      if(hasKit) return;
      const tool=f.variants.find(v=>!/kit|package/i.test(v.type));
      if(!tool || !(tool.price>0)) return;
      const compat=compatBySku.get(clean(tool.sku).toUpperCase());
      if(!compat) return;

      const batteryId=clean(compat.RecommendedBatteryID1).toUpperCase();
      const chargerId=clean(compat.RecommendedChargerID1).toUpperCase();
      const battery=batteryById.get(batteryId);
      const charger=chargerById.get(chargerId);
      if(!battery || !charger) return;

      const batteryPrice=currentPrice(battery), chargerPrice=currentPrice(charger);
      if(!(batteryPrice>0 && chargerPrice>0)) return;

      const batteryQty=Math.max(1,num(compat.RecommendedBatteryQty1)||1);
      const chargerQty=Math.max(1,num(compat.RecommendedChargerQty1)||1);
      const batteryLabel=(clean(battery.BatteryID)||componentName(battery))+' '+(batteryQty>1?'Batteries':'Battery');
      const chargerLabel=(clean(charger.ChargerID)||componentName(charger))+' '+(chargerQty>1?'Chargers':'Charger');

      f.variants.push({
        sku:tool.sku,
        description:tool.description,
        type:'Package',
        msrp:0,
        sale:0,
        price:tool.price+(batteryPrice*batteryQty)+(chargerPrice*chargerQty),
        qtyDanbury:tool.qtyDanbury,
        qtyNewMilford:tool.qtyNewMilford,
        buyOnline:tool.buyOnline,
        localDelivery:tool.localDelivery,
        assembly:tool.assembly,
        productUrl:tool.productUrl,
        recommendedPackage:true,
        packageItems:[
          {sku:clean(battery.SKU),name:batteryLabel,quantity:batteryQty,price:batteryPrice},
          {sku:clean(charger.SKU),name:chargerLabel,quantity:chargerQty,price:chargerPrice}
        ],
        packageIncludes:[
          (batteryQty>1?batteryQty+' ':'')+batteryLabel,
          (chargerQty>1?chargerQty+' ':'')+chargerLabel
        ].join(' and ')+' included'
      });
    });
    return families;
  }

  function enrichFactoryPackageSavings(families){
    const batteryById=new Map(DATA.batteries.map(x=>[clean(x.BatteryID).replace(/\s+/g,'').toUpperCase(),x]));
    const chargerById=new Map(DATA.chargers.map(x=>[clean(x.ChargerID).replace(/\s+/g,'').toUpperCase(),x]));

    families.forEach(f=>{
      const tool=f.variants.find(v=>!/kit|package/i.test(v.type));
      if(!tool || !(tool.price>0)) return;

      f.variants.filter(v=>/kit|package/i.test(v.type) && !v.recommendedPackage).forEach(v=>{
        const d=clean(v.description);
        const batt=d.match(/\b(?:(\d+)\s*[-x]?\s*)?((?:AS|AK|AP|AR)\s*\d+(?:\.\d+)?\s*[A-Z]?)\s*Batter(?:y|ies)?\b/i);
        const charger=d.match(/\b(AL\s*\d+(?:-\d+)?)\b/i);
        if(!batt && !charger) return;

        const parts=[];
        let components=0;

        if(batt){
          const qty=Math.max(1,Number(batt[1])||1);
          const id=batt[2].replace(/\s+/g,'').toUpperCase();
          const row=batteryById.get(id);
          const price=row?currentPrice(row):0;
          const display=(clean(row && row.BatteryID)||batt[2].replace(/\s+/g,' ').toUpperCase());
          if(price>0){
            components+=price*qty;
            parts.push((qty>1?qty+' ':'')+display+' '+(qty>1?'Batteries':'Battery'));
          }
        }

        if(charger){
          const id=charger[1].replace(/\s+/g,'').toUpperCase();
          const row=chargerById.get(id);
          const price=row?currentPrice(row):0;
          const display=clean(row && row.ChargerID)||id;
          if(price>0){
            components+=price;
            parts.push(display+' Charger');
          }
        }

        if(parts.length) v.packageIncludes=parts.join(' and ')+' included';
        if(components>0){
          v.packageValue=tool.price+components;
          v.packageSavings=Math.max(0,v.packageValue-v.price);
        }
      });
    });
    return families;
  }

  function engineValue(f){
    for(const [k,v] of Object.entries(f.specs)){
      if(/engine\s*(brand|make|manufacturer)?$/i.test(k) || /^engine$/i.test(k)) return v;
    }
    return '';
  }

  function widthPair(f){
    const patterns=[/cut(ting)?\s*width/i,/deck\s*width/i,/clearing\s*width/i,/working\s*width/i,/mower\s*width/i];
    for(const [k,v] of Object.entries(f.specs)){
      if(patterns.some(rx=>rx.test(k))) return [k,v];
    }
    return null;
  }

  function filterFamilies(){
    const q=state.search.toLowerCase();
    const out=DATA.families.filter(f=>{
      if(state.category && f.category!==state.category) return false;
      if(state.power && f.power!==state.power) return false;
      if(state.seriesOrEngine){
        const target=/battery/i.test(state.power) ? f.system : engineValue(f);
        if(clean(target)!==state.seriesOrEngine) return false;
      }
      if(state.width){
        const wp=widthPair(f); if(!wp || clean(wp[1])!==state.width) return false;
      }
      if(state.brand.size && !state.brand.has(f.brand)) return false;
      if(state.availability.size){
        const labels=[];
        if(f.stock>0) labels.push('In Stock');
        else labels.push('Available to Order');
        if(!labels.some(x=>state.availability.has(x))) return false;
      }
      if(state.buyOnline && !f.buyOnline) return false;
      for(const [label, values] of state.specFilters){
        if(values.size && !values.has(clean(f.specs[label]))) return false;
      }
      if(q){
        const hay=[f.brand,f.model,f.category,f.subcategory,f.power,f.series,Object.values(f.specs).join(' ')].join(' ').toLowerCase();
        if(!hay.includes(q)) return false;
      }
      return true;
    });
    DATA.filtered=out;
    renderCards();
    renderResultMeta();
    updateCompareButton();
  }

  function button(label,value,kind,active){
    return '<button type="button" class="market-chip'+(active?' active':'')+'" data-'+kind+'="'+esc(value)+'">'+esc(label)+'</button>';
  }

  function renderTopFilters(){
    const categoryHost=$('#market-categories');
    const categories=distinct(DATA.families.map(f=>f.category));
    categoryHost.innerHTML=button('All Products','', 'category', !state.category)+categories.map(x=>button(x,x,'category',state.category===x)).join('');

    const powerHost=$('#market-power');
    const scoped=DATA.families.filter(f=>!state.category || f.category===state.category);
    const powers=distinct(scoped.map(f=>f.power));
    const rank={ELECTRIC:1,BATTERY:2,GAS:3,PETROL:3,DIESEL:4};
    powers.sort((a,b)=>(rank[a.toUpperCase()]||99)-(rank[b.toUpperCase()]||99)||a.localeCompare(b));
    powerHost.innerHTML=powers.map(x=>button(x,x,'power',state.power===x)).join('');

    const context=$('#market-context');
    if(!state.power){ context.innerHTML=''; context.hidden=true; }
    else {
      const vals=/battery/i.test(state.power)
        ? distinct(scoped.filter(f=>f.power===state.power).map(f=>f.system).filter(v=>DATA.batterySystems.has(clean(v).toUpperCase())))
        : distinct(scoped.filter(f=>f.power===state.power).map(engineValue));
      context.hidden=!vals.length;
      context.innerHTML=vals.length ? '<span class="market-context-label">'+(/battery/i.test(state.power)?'Series':'Engine')+'</span>'+vals.map(x=>button(x,x,'context',state.seriesOrEngine===x)).join('') : '';
    }

    const widths=distinct(scoped.map(f=>{const p=widthPair(f); return p?p[1]:'';}));
    const widthHost=$('#market-width');
    widthHost.hidden=!widths.length;
    widthHost.innerHTML=widths.length?'<span class="market-context-label">Width</span>'+widths.map(x=>button(x,x,'width',state.width===x)).join(''):'';
  }

  function renderSidebar(){
    const brands=distinct(DATA.families.map(f=>f.brand));
    $('#filter-brand').innerHTML=brands.map(b=>'<label><input type="checkbox" data-brand="'+esc(b)+'"> <span>'+esc(b)+'</span></label>').join('');
    $('#filter-availability').innerHTML=['In Stock','Available to Order'].map(x=>'<label><input type="checkbox" data-availability="'+esc(x)+'"> <span>'+esc(x)+'</span></label>').join('');

    const scoped=DATA.families.filter(f=>(!state.category||f.category===state.category)&&(!state.power||f.power===state.power));
    const labels=new Map();
    scoped.forEach(f=>Object.entries(f.specs).slice(0,5).forEach(([l,v])=>{
      if(!l||!v||/width/i.test(l)) return;
      if(!labels.has(l)) labels.set(l,new Set());
      labels.get(l).add(v);
    }));
    const useful=Array.from(labels.entries()).filter(([,s])=>s.size>1 && s.size<=12).slice(0,5);
    $('#filter-specs-wrap').hidden=!useful.length;
    $('#filter-specs').innerHTML=useful.map(([l,s])=>
      '<details><summary>'+esc(l)+'</summary><div class="market-checks">'+Array.from(s).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(v=>'<label><input type="checkbox" data-spec-label="'+esc(l)+'" data-spec-value="'+esc(v)+'"> <span>'+esc(v)+'</span></label>').join('')+'</div></details>'
    ).join('');
  }

  function familySpecs(f){
    return Object.entries(f.specs).filter(([,v])=>clean(v)).slice(0,5);
  }

  function availabilityText(f){
    if(f.stock>0) return 'In Stock';
    return 'Available to Order';
  }

  function cartMarkup(f){
    const eligible=f.variants.filter(v=>v.buyOnline && v.price>0);
    if(!eligible.length) return '';
    const options=eligible.map((v,i)=>'<option value="'+esc(v.sku+'|'+f.variants.indexOf(v))+'">'+esc((/kit|package/i.test(v.type)?'Package':'Tool Only')+' — '+money(v.price))+'</option>').join('');
    return '<div class="market-cart-controls">'+
      '<select data-cart-variant="'+esc(f.key)+'" aria-label="Choose Purchase Option"><option value="" selected disabled>Choose Purchase Option</option>'+options+'</select>'+
      '<input data-cart-qty="'+esc(f.key)+'" type="number" min="1" max="99" value="1" aria-label="Quantity">'+
      '<button type="button" data-add-cart="'+esc(f.key)+'">Add to Cart</button>'+
    '</div>';
  }

  function addFamilyToCart(key,buttonEl){
    const f=DATA.families.find(x=>x.key===key);
    if(!f) return;
    const select=document.querySelector('[data-cart-variant="'+CSS.escape(key)+'"]');
    const qtyInput=document.querySelector('[data-cart-qty="'+CSS.escape(key)+'"]');
    const selected=select ? select.value : '';
    const qty=Math.max(1,Math.min(99,parseInt(qtyInput && qtyInput.value,10)||1));
    const v=f.variants.find((x,i)=>(x.sku+'|'+i)===selected && x.buyOnline && x.price>0);
    if(!v) return;

    let cart=[];
    try{ cart=JSON.parse(localStorage.getItem('wepCart')||'[]'); if(!Array.isArray(cart)) cart=[]; }catch(e){ cart=[]; }

    const addLine=(sku,name,lineQty,price)=>{
      const existing=cart.find(x=>x.sku===sku);
      if(existing) existing.quantity=Math.min(99,(Number(existing.quantity)||0)+lineQty);
      else cart.push({sku,productName:name,description:'',quantity:lineQty,itemPrice:price,shipping:null});
    };

    if(v.recommendedPackage && Array.isArray(v.packageItems)){
      const componentTotal=v.packageItems.reduce((sum,x)=>sum+(Number(x.price)||0)*(Number(x.quantity)||1),0);
      addLine(v.sku,f.model+' — Tool Only',qty,Math.max(0,v.price-componentTotal));
      v.packageItems.forEach(x=>addLine(x.sku,x.name,qty*(Number(x.quantity)||1),Number(x.price)||0));
    }else{
      addLine(v.sku,v.description||f.brand+' '+f.model,qty,v.price);
    }

    localStorage.setItem('wepCart',JSON.stringify(cart));
    updateCartFloat();
    if(buttonEl){
      const old=buttonEl.textContent;
      buttonEl.textContent='Added ✓';
      setTimeout(()=>{buttonEl.textContent=old;},1200);
    }
    track('marketplace_add_to_cart',{sku:v.sku,model:f.model,quantity:qty,value:v.price*qty});
  }

  function packageSummary(v){
    if(clean(v && v.packageIncludes)) return clean(v.packageIncludes);
    const d=clean(v && v.description);
    if(!d) return '';
    const parts=[];
    const batt=d.match(/\b(?:(\d+)\s*[-x]?\s*)?((?:AS|AK|AP|AR)\s*\d+(?:\.\d+)?\s*[A-Z]?)\s*Batter(?:y|ies)?\b/i);
    const charger=d.match(/\b(AL\s*\d+(?:-\d+)?)\s*Charger\b/i) || d.match(/\b(AL\s*\d+(?:-\d+)?)\b/i);
    if(batt){
      const qty=Math.max(1,Number(batt[1])||1);
      const name=batt[2].replace(/\s+/g,' ').trim().toUpperCase();
      parts.push((qty>1?qty+' ':'')+name+' '+(qty>1?'batteries':'battery'));
    }
    if(charger) parts.push(charger[1].replace(/\s+/g,'').toUpperCase()+' charger');
    return parts.length ? parts.join(' and ')+' included' : '';
  }

  function pricePanel(label,v,isPackage,f){
    if(!v) return '';
    const regular=v.msrp>0 ? v.msrp : v.price;
    const onSale=v.sale>0 && regular>v.sale;
    const include=isPackage ? packageSummary(v) : '';
    const savings=isPackage && Number(v.packageSavings||0)>0 && Number(v.packageValue||0)>0
      ? 'Package Value '+money(v.packageValue)+' · Save '+money(v.packageSavings)
      : '';
    return '<div class="market-price-choice'+(isPackage?' market-package-choice':'')+'">'+
      '<div class="market-price-heading"><span>'+esc(label)+'</span><span class="market-price-pair">'+
        (onSale?'<del>'+money(regular)+'</del>':'')+
        '<strong>'+(v.price>0?money(v.price):'Pricing Coming Soon')+'</strong>'+
      '</span></div>'+
      (!isPackage && /battery/i.test(f.power)?'<small class="market-sold-separate">Battery and charger sold separately</small>':'')+
      (include?'<small class="market-package-includes">'+esc(include)+'</small>':'')+
      (savings?'<small class="market-package-savings">'+esc(savings)+'</small>':'')+
    '</div>';
  }

  function familyPriceMarkup(f){
    const tool=f.variants.find(v=>!/kit|package/i.test(v.type));
    const kit=f.variants.find(v=>/kit|package/i.test(v.type));
    const rows=[];
    if(tool) rows.push(pricePanel('Tool Only',tool,false,f));
    if(kit) rows.push(pricePanel('Package',kit,true,f));
    if(!rows.length && f.variants[0]) rows.push(pricePanel('Price',f.variants[0],false,f));
    return '<div class="market-price-lines">'+rows.join('')+'</div>';
  }

  function card(f){
    const first=f.variants[0]||{};
    const specs=familySpecs(f).slice(0,4);
    const description=[f.power,f.subcategory].filter(Boolean).join(' - ');
    const optionsUrl='product-options.html?sku='+encodeURIComponent(first.sku||'')+'&category='+encodeURIComponent(f.category);
    const runtimeUrl='index.html?category='+encodeURIComponent(f.category)+'&sku='+encodeURIComponent(first.sku||'');
    return '<article class="market-card" data-key="'+esc(f.key)+'">'+
      '<header class="market-card-head"><h3><strong>'+esc(f.model)+'</strong>'+(description?'<span>'+esc(description)+'</span>':'')+'</h3>'+
        '<label class="market-compare-pick"><input type="checkbox" data-compare="'+esc(f.key)+'" '+(state.compare.has(f.key)?'checked':'')+'> <span>Compare</span></label>'+
      '</header>'+
      '<div class="market-card-body">'+
        '<section class="market-card-left">'+
          '<a class="market-image" href="'+esc(first.productUrl||f.productUrl||'#')+'" target="_blank" rel="noopener">'+
            (f.image?'<img src="'+esc(f.image)+'" alt="'+esc(f.brand+' '+f.model)+'" loading="lazy">':'<span>Image Coming Soon</span>')+
          '</a>'+
          ((first.productUrl||f.productUrl)?'<a class="market-product-details" href="'+esc(first.productUrl||f.productUrl)+'" target="_blank" rel="noopener">View Details ↗</a>':'')+
        '</section>'+
        '<section class="market-buy">'+
          familyPriceMarkup(f)+
          '<div class="market-actions"><a href="'+optionsUrl+'">'+(/battery/i.test(f.power)?'View Accessories':'View Options')+'</a>'+
            (/battery/i.test(f.power)?'<a href="'+runtimeUrl+'">Run/Charge Times</a>':'')+
          '</div>'+
          cartMarkup(f)+
        '</section>'+
      '</div>'+
      (specs.length?'<dl class="market-specs">'+specs.map(([l,v])=>'<div><dt>'+esc(l)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>':'')+
    '</article>';
  }

  function renderCards(){
    $('#market-grid').innerHTML=DATA.filtered.length ? DATA.filtered.map(card).join('') : '<div class="market-empty"><h2>No products match those filters.</h2><p>Clear one or more filters to see additional options.</p></div>';
  }

  function renderResultMeta(){
    $('#market-result-count').textContent=DATA.filtered.length;
    const bits=[];
    if(state.category) bits.push(state.category);
    if(state.power) bits.push(state.power);
    if(state.seriesOrEngine) bits.push(state.seriesOrEngine);
    if(state.width) bits.push(state.width);
    $('#market-result-context').textContent=bits.length?' — '+bits.join(' · '):'';
  }

  function compareTable(){
    const selected=DATA.families.filter(f=>state.compare.has(f.key));
    const fams=(selected.length?selected:DATA.filtered).slice(0,24);
    if(!fams.length) return '<p>No products to compare.</p>';
    const labels=[];
    fams.forEach(f=>Object.keys(f.specs).forEach(l=>{if(!labels.includes(l)) labels.push(l);}));
    const rows=['Brand','Power','Series','Starting Price','Availability'].concat(labels.slice(0,10));
    return '<div class="market-compare-scroll"><table><thead><tr><th>Specification</th>'+fams.map(f=>'<th>'+esc(f.brand+' '+f.model)+'</th>').join('')+'</tr></thead><tbody>'+
      rows.map(r=>'<tr><th>'+esc(r)+'</th>'+fams.map(f=>{
        let v='';
        if(r==='Brand') v=f.brand;
        else if(r==='Power') v=f.power;
        else if(r==='Series') v=f.series;
        else if(r==='Starting Price') v=f.price?money(f.price):'Contact Us';
        else if(r==='Availability') v=availabilityText(f);
        else v=f.specs[r]||'';
        return '<td>'+esc(v)+'</td>';
      }).join('')+'</tr>').join('')+'</tbody></table></div>';
  }

  function updateCompareButton(){
    const b=$('#market-compare-float');
    const n=state.compare.size;
    b.textContent=n ? 'Compare Selected ('+n+')' : 'Compare Visible ('+DATA.filtered.length+')';
    b.disabled=n ? n<2 : DATA.filtered.length<2;
  }

  function updateCartFloat(){
    let cart=[];
    try{ cart=JSON.parse(localStorage.getItem('wepCart')||'[]'); if(!Array.isArray(cart)) cart=[]; }catch(e){ cart=[]; }
    const n=cart.reduce((sum,x)=>sum+(Number(x.quantity)||0),0);
    const count=$('#market-cart-count');
    if(count) count.textContent=n ? String(n) : '';
  }

  function resetContext(){
    state.seriesOrEngine=''; state.width=''; state.specFilters.clear();
  }

  function track(name,params={}){
    try{
      if(typeof window.gtag==='function') window.gtag('event',name,Object.assign({device_type:matchMedia('(max-width: 800px)').matches?'mobile':'desktop'},params));
      window.dataLayer=window.dataLayer||[];
      window.dataLayer.push(Object.assign({event:name},params));
    }catch(e){}
  }

  function wire(){
    document.addEventListener('click',e=>{
      const c=e.target.closest('[data-category]');
      if(c){ state.category=c.dataset.category||''; state.power=''; resetContext(); renderTopFilters(); renderSidebar(); filterFamilies(); track('marketplace_category',{category:state.category||'all'}); return; }
      const p=e.target.closest('[data-power]');
      if(p){ const v=p.dataset.power||''; state.power=state.power===v?'':v; resetContext(); renderTopFilters(); renderSidebar(); filterFamilies(); track('marketplace_power',{power:state.power||'all'}); return; }
      const x=e.target.closest('[data-context]');
      if(x){ const v=x.dataset.context||''; state.seriesOrEngine=state.seriesOrEngine===v?'':v; renderTopFilters(); filterFamilies(); return; }
      const w=e.target.closest('[data-width]');
      if(w){ const v=w.dataset.width||''; state.width=state.width===v?'':v; renderTopFilters(); filterFamilies(); return; }
      const add=e.target.closest('[data-add-cart]');
      if(add){ addFamilyToCart(add.dataset.addCart||'',add); return; }
    });

    document.addEventListener('change',e=>{
      const el=e.target;
      if(el.matches('[data-brand]')){ el.checked?state.brand.add(el.dataset.brand):state.brand.delete(el.dataset.brand); filterFamilies(); }
      else if(el.matches('[data-availability]')){ el.checked?state.availability.add(el.dataset.availability):state.availability.delete(el.dataset.availability); filterFamilies(); }
      else if(el.id==='filter-buy-online'){ state.buyOnline=el.checked; filterFamilies(); }
      else if(el.matches('[data-compare]')){
        const key=el.dataset.compare||'';
        el.checked ? state.compare.add(key) : state.compare.delete(key);
        updateCompareButton();
      }
      else if(el.matches('[data-spec-label]')){
        const l=el.dataset.specLabel,v=el.dataset.specValue;
        if(!state.specFilters.has(l)) state.specFilters.set(l,new Set());
        el.checked?state.specFilters.get(l).add(v):state.specFilters.get(l).delete(v);
        filterFamilies();
      }
    });

    $('#market-search').addEventListener('input',e=>{ state.search=e.target.value; filterFamilies(); });
    $('#market-clear').addEventListener('click',()=>{
      state.category='';state.power='';state.seriesOrEngine='';state.width='';state.brand.clear();state.availability.clear();state.buyOnline=false;state.search='';state.specFilters.clear();
      $('#market-search').value=''; $('#filter-buy-online').checked=false;
      renderTopFilters();renderSidebar();filterFamilies();
      track('marketplace_clear_filters');
    });

    $('#market-compare-float').addEventListener('click',()=>{
      $('#market-compare-content').innerHTML=compareTable();
      $('#market-compare-dialog').showModal();
      track('marketplace_compare',{visible_products:DATA.filtered.length});
    });
    $('#market-compare-close').addEventListener('click',()=>$('#market-compare-dialog').close());
  }

  function installAnalytics(settings){
    const ga=clean(settings.GA4MeasurementID), gtm=clean(settings.GoogleTagManagerID);
    if(gtm){
      window.dataLayer=window.dataLayer||[];
      const s=document.createElement('script');
      s.async=true;s.src='https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(gtm);
      document.head.appendChild(s);
    }
    if(ga){
      const s=document.createElement('script');
      s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(ga);
      document.head.appendChild(s);
      window.dataLayer=window.dataLayer||[];
      window.gtag=window.gtag||function(){dataLayer.push(arguments);};
      gtag('js',new Date());gtag('config',ga);
    }
  }

  function applyDealer(settings){
    const name=clean(settings.DealerName)||clean(settings.DefaultSEOName)||'Equipment Dealer';
    $('#market-dealer-name').textContent=name;
    const logo=clean(settings.DealerLogoURL);
    if(logo){ const img=$('#market-dealer-logo'); img.src=logo; img.alt=name; img.hidden=false; }
    document.title=(clean(settings.DefaultSEOName)||name)+' | Shop Equipment';
    const meta=$('meta[name="description"]');
    if(meta) meta.content='Shop and compare equipment by category, brand, power source, availability and specifications at '+name+'.';
    installAnalytics(settings);
  }

  async function init(){
    try{
      const [products,batteries,chargers,compatibility,settingsRows]=await Promise.all([
        csv('data/products.csv'),
        csv('data/batteries.csv'),
        csv('data/chargers.csv'),
        csv('data/compatibility-runtime.csv'),
        csv('data/dealer-settings.csv')
      ]);
      DATA.products=products;
      DATA.batteries=batteries;
      DATA.chargers=chargers;
      DATA.compatibility=compatibility;
      DATA.batterySystems=new Set(
        batteries.filter(x=>truthy(x.Active)).map(x=>clean(x.BatteryID).match(/^[A-Za-z]+/)?.[0]||'').filter(Boolean).map(x=>x.toUpperCase())
      );
      DATA.settings=settingsRows[0]||{};
      DATA.families=enrichFactoryPackageSavings(enrichRecommendedPackages(groupFamilies(products)));
      DATA.filtered=DATA.families.slice();
      applyDealer(DATA.settings);
      renderTopFilters(); renderSidebar(); filterFamilies(); wire(); updateCartFloat();
      $('#market-loading').hidden=true; $('#market-app').hidden=false;
    }catch(err){
      console.error(err);
      $('#market-loading').innerHTML='<strong>Unable to load product data.</strong><br>'+esc(err.message||err);
    }
  }

  document.addEventListener('DOMContentLoaded',init);
})();