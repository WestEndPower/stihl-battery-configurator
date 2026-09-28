(() => {
  'use strict';

  const DATA = {
    products: [],
    batteries: [],
    chargers: [],
    compatibility: [],
    financePrograms: [],
    batterySystems: new Set(),
    settings: {},
    equipmentFamilies: [],
    batteryFamilies: [],
    chargerFamilies: [],
    families: [],
    filtered: []
  };

  const state = {
    shopMode: 'equipment',
    category: '',
    subcategory: '',
    power: '',
    seriesOrEngine: '',
    width: '',
    brand: new Set(),
    availability: new Set(),
    buyOnline: false,
    promoOnly: false,
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
          financingEligible:truthy(p.FinancingEligible),
          variants:[],
          specs:{}
        });
      }
      const f=map.get(key);
      if(!f.image && clean(p.ImageURL)) f.image=clean(p.ImageURL);
      if(!f.productUrl && clean(p.ProductURL)) f.productUrl=clean(p.ProductURL);
      if(truthy(p.FinancingEligible)) f.financingEligible=true;
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
        saleStart:clean(p.SaleStartDate),
        saleEnd:clean(p.SaleEndDate),
        promoName:clean(p.PromoName),
        rebate:num(p.RebateToCustomer),
        rebateStart:clean(p.RebateStartDate),
        rebateEnd:clean(p.RebateEndDate),
        price:num(p.MSRP),
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
      f.variants.forEach(v=>{ v.price=effectivePrice(v); });
      const positivePrices=f.variants.map(v=>v.price).filter(v=>v>0);
      f.price=positivePrices.length ? Math.min(...positivePrices) : 0;
      f.stock=f.variants.reduce((n,v)=>n+v.qtyDanbury+v.qtyNewMilford,0);
      f.buyOnline=f.variants.some(v=>v.buyOnline);
      f.setup=f.variants.some(v=>v.localDelivery || v.assembly>0);
      return f;
    }).sort((a,b)=>a.sort-b.sort || a.model.localeCompare(b.model,undefined,{numeric:true,sensitivity:'base'}));
  }

  function groupComponents(rows,kind){
    return rows.filter(x=>truthy(x.Active)).map((p,index)=>{
      const brand=clean(p.BrandID)||'STIHL';
      const model=clean(p.Model)||clean(p.BatteryID)||clean(p.ChargerID)||clean(p.ChargerName)||clean(p.Description)||clean(p.SKU);
      const price=currentPrice(p);
      const specs={};
      const pairs=kind==='battery'
        ? [['Voltage',clean(p.Voltage)||clean(p.MaxVoltage)],['Capacity',clean(p.Ah)?clean(p.Ah)+' Ah':''],['Energy',clean(p.Wh)?clean(p.Wh)+' Wh':''],['Weight',clean(p.Weight)?clean(p.Weight)+' '+clean(p.WeightUnit):'']]
        : [['System',clean(p.System)],['Voltage',clean(p.Voltage)],['Output',clean(p.OutputAmps)?clean(p.OutputAmps)+' A':''],['Input',clean(p.InputWatts)?clean(p.InputWatts)+' W':'']];
      pairs.forEach(([k,v])=>{ if(v) specs[k]=v; });
      const qty=num(p.QtyDanbury)+num(p.QtyNewMilford);
      return {
        key:(brand+'|'+kind+'|'+clean(p.SKU||model)).toUpperCase(),
        brand, model,
        category:kind==='battery'?'Batteries':'Chargers',
        subcategory:kind==='battery'?'Battery':'Charger',
        power:'Battery',
        series:kind==='battery'
          ? ((clean(p.BatteryID).match(/^(AS|AK|AP|AR)/i)||[])[1]||'').toUpperCase()
          : '',
        system:clean(p.System),
        image:clean(p.ImageURL),
        productUrl:clean(p.ProductURL),
        sort:num(p.SortOrder)||index+1,
        variants:[{
          sku:clean(p.SKU),description:clean(p.Description)||model,type:kind==='battery'?'Battery':'Charger',
          msrp:num(p.MSRP),sale:num(p.SalePrice),price,
          qtyDanbury:num(p.QtyDanbury),qtyNewMilford:num(p.QtyNewMilford),
          buyOnline:price>0,localDelivery:false,assembly:0,productUrl:clean(p.ProductURL)
        }],
        specs,
        price,
        stock:qty,
        buyOnline:price>0,
        financingEligible:truthy(p.FinancingEligible),
        setup:false
      };
    }).sort((a,b)=>a.sort-b.sort || a.model.localeCompare(b.model,undefined,{numeric:true,sensitivity:'base'}));
  }

  function activeFamilies(){
    if(state.shopMode==='batteries') return DATA.batteryFamilies;
    if(state.shopMode==='chargers') return DATA.chargerFamilies;
    return DATA.equipmentFamilies;
  }

    function dateActive(startRaw,endRaw){
    const now=new Date();
    const parse=(raw,endOfDay)=>{
      raw=clean(raw);
      if(!raw) return null;
      const p=raw.split('-').map(Number);
      if(p.length!==3 || p.some(x=>!Number.isFinite(x))) return null;
      return new Date(p[0],p[1]-1,p[2],endOfDay?23:0,endOfDay?59:0,endOfDay?59:0);
    };
    const start=parse(startRaw,false), end=parse(endRaw,true);
    return (!start || now>=start) && (!end || now<=end);
  }

  function shortDate(raw){
    raw=clean(raw);
    if(!raw) return '';
    const p=raw.split('-').map(Number);
    if(p.length!==3) return raw;
    return new Date(p[0],p[1]-1,p[2]).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  }

  function promoInfo(v){
    if(!v) return null;
    const msrp=Number(v.msrp||0);
    const sale=Number(v.sale||0);
    if(msrp>0 && sale>0 && sale<msrp && dateActive(v.saleStart,v.saleEnd)){
      return {type:'sale',regular:msrp,price:sale,savings:msrp-sale,end:v.saleEnd,name:clean(v.promoName)};
    }
    const rebate=Number(v.rebate||0);
    if(msrp>0 && rebate>0 && rebate<msrp && dateActive(v.rebateStart,v.rebateEnd)){
      return {type:'rebate',regular:msrp,price:msrp-rebate,savings:rebate,end:v.rebateEnd,name:'Customer Rebate'};
    }
    return null;
  }

  function effectivePrice(v){
    const promo=promoInfo(v);
    if(promo) return promo.price;
    return Number(v && v.msrp || v && v.price || 0);
  }

  function searchKey(v){
    return clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'');
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

  function financeGroupColumns(f){
    const cols=new Set(['Group_ALL_STIHL']);
    const values=[f.series,f.category,f.subcategory].map(clean).filter(Boolean);
    values.forEach(v=>{
      cols.add('Group_'+v);
      const compact=v.toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(compact) cols.add('Group_'+compact);
    });
    const model=clean(f.model).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const series=clean(f.series).toUpperCase().replace(/[^A-Z0-9]/g,'');
    [model,series].forEach(v=>{
      if(/^RZ1/.test(v)) cols.add('Group_RZ100');
      if(/^RZ2/.test(v)) cols.add('Group_RZ200');
      if(/^RZ5/.test(v)) cols.add('Group_RZ500');
      if(/^RZ7/.test(v)) cols.add('Group_RZ700');
      if(/^RZ752/.test(v)) cols.add('Group_RZ752');
      if(/^RZ9/.test(v)) cols.add('Group_RZ900');
      if(/^AZA/.test(v)) cols.add('Group_AZA');
      if(/^RZA/.test(v)) cols.add('Group_RZA');
      if(/^RMA/.test(v)) cols.add('Group_RMA');
      if(/^RM/.test(v)) cols.add('Group_RM');
      if(/^FSA120/.test(v)) cols.add('FSA 120');
    });
    if([model,series].some(v=>/^RZ[0-9]|^AZA|^RZA/.test(v)) || values.some(v=>/ZERO[- ]?TURN/i.test(v))){
      cols.add('Group_ALL_ZTR');
    }
    return Array.from(cols);
  }

  function bestFinanceProgram(f){
    if(!f || !f.financingEligible || !DATA.financePrograms.length) return null;
    const amount=Number(f.price||0);
    if(!(amount>0)) return null;
    const groups=financeGroupColumns(f);
    const brand=clean(f.brand).toUpperCase();
    const programs=DATA.financePrograms.filter(p=>{
      if(!truthy(p.Active) || !truthy(p.Public) || !truthy(p.Display)) return false;
      if(!dateActive(p.StartDate,p.EndDate)) return false;
      if(clean(p.BrandID) && clean(p.BrandID).toUpperCase()!==brand) return false;
      const min=num(p.MinAmount), max=num(p.MaxAmount);
      if(min>0 && amount<min) return false;
      if(max>0 && amount>max) return false;
      return groups.some(g=>truthy(p[g]));
    });
    if(!programs.length) return null;
    return programs.sort((a,b)=>{
      const aa=num(a.APR), ab=num(b.APR);
      const za=aa===0?0:1, zb=ab===0?0:1;
      return za-zb || aa-ab || num(b.TermMonths)-num(a.TermMonths) || num(a.SortOrder)-num(b.SortOrder);
    })[0]||null;
  }

  function financeOfferData(f){
    const p=bestFinanceProgram(f);
    if(!p) return null;
    const raw=num(p.APR);
    const apr=raw>0 && raw<1 ? raw*100 : raw;
    const aprLabel=apr===0 ? '0%' : apr.toFixed(2).replace(/\.00$/,'')+'%';
    return {
      program:p,
      label:aprLabel+' for '+clean(p.TermMonths)+' Months'
    };
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
    const q=searchKey(state.search);
    DATA.families=activeFamilies();
    const out=DATA.families.filter(f=>{
      if(state.category && f.category!==state.category) return false;
      if(state.subcategory && f.subcategory!==state.subcategory) return false;
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
      if(state.promoOnly && !(f.variants||[]).some(v=>promoInfo(v))) return false;
      for(const [label, values] of state.specFilters){
        if(values.size && !values.has(clean(f.specs[label]))) return false;
      }
      if(q){
        const hay=searchKey([f.brand,f.model,f.category,f.subcategory,f.power,f.series,Object.values(f.specs).join(' ')].join(' '));
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
    const tabs=$('#market-shop-tabs');
    tabs.innerHTML=['equipment','batteries','chargers'].map(mode=>
      '<button type="button" class="market-shop-tab'+(state.shopMode===mode?' active':'')+'" data-shop-mode="'+mode+'">'+
      (mode==='equipment'?'Equipment':mode==='batteries'?'Batteries':'Chargers')+'</button>'
    ).join('')+
    '<button type="button" class="market-shop-tab market-promo-tab'+(state.promoOnly?' active':'')+'" data-promo-only="1">Promos & Rebates</button>';

    const powerWrap=$('#market-power-wrap');
    const categoryPanel=$('#market-category-panel');
    const contextPanel=$('#market-context-panel');
    const powerHost=$('#market-power');
    const context=$('#market-context');
    const categoryHost=$('#market-categories');
    const widthHost=$('#market-width');

    if(state.shopMode!=='equipment'){
      powerWrap.hidden=true;
      categoryPanel.hidden=true;
      contextPanel.hidden=true;
      context.innerHTML='';
      return;
    }

    powerWrap.hidden=false;
    categoryPanel.hidden=false;

    const powers=distinct(DATA.equipmentFamilies.map(f=>f.power));
    const rank={BATTERY:1,GAS:2,DIESEL:3,ELECTRIC:4,PETROL:2};
    powers.sort((a,b)=>(rank[a.toUpperCase()]||99)-(rank[b.toUpperCase()]||99)||a.localeCompare(b));
    powerHost.innerHTML=button('All','', 'power', !state.power)+powers.map(x=>button(x,x,'power',state.power===x)).join('');

    const categories=distinct(DATA.equipmentFamilies.map(f=>f.category)).filter(x=>!/^batteries|chargers$/i.test(x));

    if(state.category){
      const subcategories=distinct(
        DATA.equipmentFamilies
          .filter(f=>f.category===state.category)
          .map(f=>f.subcategory)
      );
      categoryHost.innerHTML=
        '<button type="button" class="market-chip market-all-categories" data-category="">All Categories</button>'+
        button(state.category,state.category,'category',true)+
        subcategories.map(x=>button(x,x,'subcategory',state.subcategory===x)).join('');
    }else{
      categoryHost.innerHTML=
        '<button type="button" class="market-chip market-all-categories active" data-category="">All Categories</button>'+
        categories.map(x=>button(x,x,'category',false)).join('');
    }

    const scoped=DATA.equipmentFamilies.filter(f=>
      (!state.category || f.category===state.category) &&
      (!state.subcategory || f.subcategory===state.subcategory) &&
      (!state.power || f.power===state.power)
    );

    if(state.category && state.power){
      const battery=/battery/i.test(state.power);
      const engine=/^(gas|petrol|diesel)$/i.test(state.power);
      const vals=battery
        ? distinct(scoped.map(f=>f.system).filter(v=>DATA.batterySystems.has(clean(v).toUpperCase())))
        : engine
          ? distinct(scoped.map(engineValue))
          : [];
      contextPanel.hidden=!vals.length;
      context.innerHTML=vals.length
        ? '<span class="market-context-label">'+(battery?'Series':'Engine Brand')+'</span>'+vals.map(x=>button(x,x,'context',state.seriesOrEngine===x)).join('')
        : '';
    }else{
      contextPanel.hidden=true;
      context.innerHTML='';
      state.seriesOrEngine='';
    }

    const widths=distinct(scoped.map(f=>{const p=widthPair(f); return p?p[1]:'';}));
    widthHost.hidden=!widths.length;
    widthHost.innerHTML=widths.length?'<span class="market-context-label">Width</span>'+widths.map(x=>button(x,x,'width',state.width===x)).join(''):'';
  }

  function renderSidebar(){
    DATA.families=activeFamilies();
    const brands=distinct(DATA.families.map(f=>f.brand));
    $('#filter-brand').innerHTML=brands.map(b=>'<label><input type="checkbox" data-brand="'+esc(b)+'"> <span>'+esc(b)+'</span></label>').join('');
    $('#filter-availability').innerHTML=['In Stock','Available to Order'].map(x=>'<label><input type="checkbox" data-availability="'+esc(x)+'"> <span>'+esc(x)+'</span></label>').join('');

    const scoped=DATA.families.filter(f=>(!state.category||f.category===state.category)&&(!state.subcategory||f.subcategory===state.subcategory)&&(!state.power||f.power===state.power));
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
    const f=activeFamilies().find(x=>x.key===key);
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
    const promo=promoInfo(v);
    const regular=promo ? promo.regular : (v.msrp>0 ? v.msrp : v.price);
    const shown=promo ? promo.price : v.price;
    const include=isPackage ? packageSummary(v) : '';
    const savings=isPackage && Number(v.packageSavings||0)>0 && Number(v.packageValue||0)>0
      ? 'Package Value '+money(v.packageValue)+' · Save '+money(v.packageSavings)
      : '';
    return '<div class="market-price-choice'+(isPackage?' market-package-choice':'')+'">'+
      '<div class="market-price-heading"><span>'+esc(label)+'</span><span class="market-price-pair">'+
        (promo?'<del>'+money(regular)+'</del>':'')+
        '<strong>'+(shown>0?money(shown):'Pricing Coming Soon')+'</strong>'+
      '</span></div>'+
      (promo && promo.type==='rebate'?'<small class="market-promo-price-note">After customer rebate</small>':'')+
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

  function offerOverlay(f){
    const promoHit=(f.variants||[]).map(v=>({v,p:promoInfo(v)})).find(x=>x.p);
    const finance=financeOfferData(f);
    if(!promoHit && !finance) return '';

    let promoHtml='';
    if(promoHit){
      const p=promoHit.p;
      const end=p.end ? shortDate(p.end) : '';
      const headline=p.type==='rebate'
        ? money(p.savings).replace(/\.00$/,'')+' Rebate'
        : money(p.savings).replace(/\.00$/,'')+' Savings';
      promoHtml='<div class="market-offer-promo"><strong>'+esc(headline)+'</strong>'+
        (end?'<small>thru '+esc(end)+'</small>':'')+'</div>';
    }

    let financeHtml='';
    if(finance){
      financeHtml='<div class="market-offer-finance"><strong>'+esc(finance.label)+'</strong><small>Financing Available</small></div>';
    }

    let joiner='';
    if(promoHit && finance){
      const raw=clean(finance.program.RebateCompatible);
      const compatible=raw==='' || truthy(raw);
      joiner='<div class="market-offer-joiner">'+(compatible?'AND':'OR')+'</div>';
    }

    return '<div class="market-offer-row'+((promoHit&&finance)?' market-offer-row-both':'')+'">'+
      promoHtml+joiner+financeHtml+'</div>';
  }

    function card(f){
    const first=f.variants[0]||{};
    const specs=familySpecs(f).slice(0,4);
    const description=[f.power,f.subcategory].filter(Boolean).join(' - ');
    const equipmentMode=state.shopMode==='equipment';
    const optionsUrl='product-options.html?sku='+encodeURIComponent(first.sku||'')+'&category='+encodeURIComponent(f.category);
    const runtimeUrl='index.html?category='+encodeURIComponent(f.category)+'&sku='+encodeURIComponent(first.sku||'')+'&view=runtime';
    return '<article class="market-card" data-key="'+esc(f.key)+'">'+
      '<header class="market-card-head"><h3><strong>'+esc(f.model)+'</strong>'+(description?'<span>'+esc(description)+'</span>':'')+'</h3>'+
        '<label class="market-compare-pick"><input type="checkbox" data-compare="'+esc(f.key)+'" '+(state.compare.has(f.key)?'checked':'')+'> <span>Compare</span></label>'+
      '</header>'+
      '<div class="market-card-body">'+
        '<section class="market-card-left">'+
          '<div class="market-image-wrap">'+
            offerOverlay(f)+
            '<a class="market-image" href="'+esc(first.productUrl||f.productUrl||'#')+'" target="_blank" rel="noopener">'+
            (f.image?'<img src="'+esc(f.image)+'" alt="'+esc(f.brand+' '+f.model)+'" loading="lazy">':'<span>Image Coming Soon</span>')+
            '</a>'+
          '</div>'+
          ((first.productUrl||f.productUrl)?'<a class="market-product-details" href="'+esc(first.productUrl||f.productUrl)+'" target="_blank" rel="noopener">View Details ↗</a>':'')+
        '</section>'+
        '<section class="market-buy">'+
          familyPriceMarkup(f)+
          (equipmentMode
            ? '<div class="market-actions"><a href="'+optionsUrl+'">'+(/battery/i.test(f.power)?'View Accessories':'View Options')+'</a>'+
                (/battery/i.test(f.power)?'<a href="'+runtimeUrl+'" target="_blank">Run/Charge Times</a>':'')+
              '</div>'
            : '')+
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
    if(state.subcategory) bits.push(state.subcategory);
    if(state.power) bits.push(state.power);
    if(state.seriesOrEngine) bits.push(state.seriesOrEngine);
    if(state.width) bits.push(state.width);
    $('#market-result-context').textContent=bits.length?' — '+bits.join(' · '):'';
  }

  function compareTable(){
    const selected=activeFamilies().filter(f=>state.compare.has(f.key));
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
      const shop=e.target.closest('[data-shop-mode]');
      if(shop){
        state.shopMode=shop.dataset.shopMode||'equipment';
        state.category='';state.subcategory='';state.power='';state.seriesOrEngine='';state.width='';state.specFilters.clear();state.compare.clear();
        renderTopFilters();renderSidebar();filterFamilies();return;
      }
      const promo=e.target.closest('[data-promo-only]');
      if(promo){ state.promoOnly=!state.promoOnly; renderTopFilters(); filterFamilies(); track('marketplace_promos',{active:state.promoOnly}); return; }
      const c=e.target.closest('[data-category]');
      if(c){ state.category=c.dataset.category||''; state.subcategory=''; state.power=''; resetContext(); renderTopFilters(); renderSidebar(); filterFamilies(); track('marketplace_category',{category:state.category||'all'}); return; }
      const s=e.target.closest('[data-subcategory]');
      if(s){ const v=s.dataset.subcategory||''; state.subcategory=state.subcategory===v?'':v; state.seriesOrEngine='';state.width='';state.specFilters.clear(); renderTopFilters(); renderSidebar(); filterFamilies(); track('marketplace_subcategory',{subcategory:state.subcategory||'all'}); return; }
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
      state.shopMode='equipment';state.category='';state.subcategory='';state.power='';state.seriesOrEngine='';state.width='';state.brand.clear();state.availability.clear();state.buyOnline=false;state.promoOnly=false;state.search='';state.specFilters.clear();
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
      const [products,batteries,chargers,compatibility,financePrograms,settingsRows]=await Promise.all([
        csv('data/products.csv'),
        csv('data/batteries.csv'),
        csv('data/chargers.csv'),
        csv('data/compatibility-runtime.csv'),
        csv('data/finance-programs.csv'),
        csv('data/dealer-settings.csv')
      ]);
      DATA.products=products;
      DATA.batteries=batteries;
      DATA.chargers=chargers;
      DATA.compatibility=compatibility;
      DATA.financePrograms=financePrograms;
      DATA.batterySystems=new Set(
        batteries.filter(x=>truthy(x.Active)).map(x=>clean(x.BatteryID).match(/^[A-Za-z]+/)?.[0]||'').filter(Boolean).map(x=>x.toUpperCase())
      );
      DATA.settings=settingsRows[0]||{};
      DATA.equipmentFamilies=enrichFactoryPackageSavings(enrichRecommendedPackages(groupFamilies(products)));
      DATA.batteryFamilies=groupComponents(batteries,'battery');
      DATA.chargerFamilies=groupComponents(chargers,'charger');
      DATA.families=activeFamilies();
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