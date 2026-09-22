(function(){
  'use strict';

  var api = window.WestEndWebCatalog = window.WestEndWebCatalog || {};
  var MAX_COMPARE = 4;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function money(v){
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function esc(v){
    return clean(v)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }
  function norm(v){
    return clean(v).toUpperCase().replace(/[^A-Z0-9]+/g,'');
  }
  function isTrue(v){
    return ['T','TRUE','Y','YES','1'].indexOf(clean(v).toUpperCase()) >= 0;
  }
  function productCodeFromDescription(item){
    var d = clean(item && item.Description);
    var m = d.match(/\b([A-Z]{2,4})\s*-?\s*(\d{2,4}(?:\.\d+)?(?:\s*[A-Z])?)\b/i);
    if(!m) return '';
    return (m[1].toUpperCase() + ' ' + m[2].toUpperCase().replace(/\s+/g,' ')).trim();
  }
  function familyName(item){
    var model = clean(item && item.Model).replace(/^M3S\b/i,'MS').replace(/\s+/g,' ');
    var descCode = productCodeFromDescription(item);
    if(model) return model;
    if(descCode) return descCode;
    return clean(item && item.Description) || clean(item && item.SKU) || 'Product';
  }
  function familyKey(item){
    return norm(familyName(item));
  }
  function barLabel(item){
    var d = clean(item && item.Description);
    var m = d.match(/w\/\s*(\d+(?:\.\d+)?)\s*"/i);
    if(!m) m = d.match(/\b(\d+(?:\.\d+)?)\s*"\s*(?:bar|guide bar)?/i);
    return m ? m[1] + '" Bar' : '';
  }
  function variantBaseLabel(item){
    var bar = barLabel(item);
    if(bar) return bar;
    var pt = clean(item && item.ProductType).toLowerCase();
    if(pt === 'kit') return 'Kit';
    if(pt === 'tool') return 'Tool Only';
    return clean(item && item.ProductType) || 'Standard';
  }
  function currentPrice(item){
    try{
      if(typeof window.webpagePromotionData === 'function'){
        var p = window.webpagePromotionData(item);
        if(p && Number.isFinite(Number(p.currentPrice))) return Number(p.currentPrice);
      }
    }catch(e){}
    var sale = money(item && item.SalePrice);
    return sale > 0 ? sale : money(item && item.MSRP);
  }
  function inStock(item){
    try{
      if(typeof window.webpageInventoryQuantity === 'function'){
        return Math.max(0, Number(window.webpageInventoryQuantity(item)) || 0);
      }
    }catch(e){}
    return Math.max(0,(Number(item && item.QtyDanbury)||0)+(Number(item && item.QtyNewMilford)||0));
  }
  function onOrder(item){
    try{
      if(typeof window.webpageOnOrderQuantity === 'function'){
        return Math.max(0, Number(window.webpageOnOrderQuantity(item)) || 0);
      }
    }catch(e){}
    return 0;
  }
  function itemImage(item){
    try{
      if(typeof window.imageOf === 'function') return clean(window.imageOf(item));
    }catch(e){}
    return clean(item && item.ImageURL);
  }
  function absoluteImage(raw){
    raw=clean(raw);
    if(!raw) return '';
    if(/^https?:\/\//i.test(raw)) return raw;
    return 'https://www.westendpower.com/stihl-equipment-configurator/' + raw.replace(/^\.?\//,'');
  }
  function configureUrl(item,category){
    var sku=clean(item && item.SKU);
    var base='https://www.westendpower.com/stihl-equipment-configurator/';
    try{
      if(typeof window.WEBPAGE_PUBLIC_CONFIG_URL !== 'undefined' && window.WEBPAGE_PUBLIC_CONFIG_URL){
        base=window.WEBPAGE_PUBLIC_CONFIG_URL;
      }
    }catch(e){}
    return base + '?category=' + encodeURIComponent(category) + '&sku=' + encodeURIComponent(sku);
  }
  function priceUrl(item){
    var sku=clean(item && item.SKU);
    var base='https://www.westendpower.com/stihl-equipment-configurator/';
    try{
      if(typeof window.WEBPAGE_PUBLIC_CONFIG_URL !== 'undefined' && window.WEBPAGE_PUBLIC_CONFIG_URL){
        base=window.WEBPAGE_PUBLIC_CONFIG_URL;
      }
    }catch(e){}
    return base + 'price-tags/' + encodeURIComponent(sku) + '.pdf';
  }
  function activeList(list){
    return (list||[]).filter(function(x){ return !clean(x.Active) || isTrue(x.Active); });
  }
  function splitSystems(v){
    return clean(v).split(/[|,;/]+/).map(function(x){return clean(x).toUpperCase();}).filter(Boolean);
  }
  function compatibleBySystem(productSystem, optionSystem){
    var ps=splitSystems(productSystem);
    var os=splitSystems(optionSystem);
    if(!ps.length || !os.length) return false;
    return ps.some(function(x){ return os.indexOf(x)>=0; });
  }
  function groupProducts(items){
    var map=new Map();
    (items||[]).forEach(function(item){
      var key=familyKey(item);
      if(!map.has(key)){
        map.set(key,{
          key:key,
          name:familyName(item),
          category:clean(item.Category),
          subcategory:clean(item.SubCategory),
          power:clean(item.PowerType),
          system:clean(item.System),
          series:clean(item.Series),
          items:[],
          image:'',
          stock:0,
          order:0,
          minPrice:Infinity
        });
      }
      var f=map.get(key);
      f.items.push(item);
      f.stock += inStock(item);
      f.order += onOrder(item);
      f.minPrice = Math.min(f.minPrice,currentPrice(item) || Infinity);
      if(!f.image){
        var img=itemImage(item);
        if(img) f.image=absoluteImage(img);
      }
      if(!f.system && clean(item.System)) f.system=clean(item.System);
      if(!f.power && clean(item.PowerType)) f.power=clean(item.PowerType);
      if(!f.subcategory && clean(item.SubCategory)) f.subcategory=clean(item.SubCategory);
    });
    map.forEach(function(f){
      var used={};
      f.items.forEach(function(item){
        var base=variantBaseLabel(item);
        used[base]=(used[base]||0)+1;
      });
      var seen={};
      f.variants=f.items.map(function(item){
        var base=variantBaseLabel(item);
        seen[base]=(seen[base]||0)+1;
        var label=base;
        if(used[base]>1){
          label=base + ' · ' + clean(item.SKU);
        }
        return {
          sku:clean(item.SKU),
          label:label,
          description:clean(item.Description),
          price:currentPrice(item),
          msrp:money(item.MSRP),
          stock:inStock(item),
          order:onOrder(item),
          system:clean(item.System)||f.system,
          configure:configureUrl(item,f.category),
          priceUrl:priceUrl(item),
          details:clean(item.ProductURL),
          specs:extractSpecs(item),
          productType:clean(item.ProductType),
          isKit:clean(item.ProductType).toLowerCase()==='kit',
          kitIncludes:clean(item.ProductType).toLowerCase()==='kit' ? kitIncludes(item) : ''
        };
      });
      f.items.sort(function(a,b){
        return (Number(a.SortOrder)||99999)-(Number(b.SortOrder)||99999);
      });
      if(!Number.isFinite(f.minPrice)) f.minPrice=0;
      f.specs=extractSpecs(f.items[0]||{});
    });
    return Array.from(map.values()).sort(function(a,b){
      return a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'});
    });
  }
  function kitIncludes(item){
    var d=clean(item && item.Description);
    var bits=[];
    var batt=d.match(/\b((?:AS|AK|AP|AR)\s*\d+(?:\.\d+)?\s*[A-Z]?)\b/i);
    var charger=d.match(/\b(AL\s*\d+(?:-\d+)?)\b/i);
    if(batt) bits.push(batt[1].replace(/\s+/g,' ').trim().toUpperCase()+' battery');
    if(charger) bits.push(charger[1].replace(/\s+/g,'').toUpperCase()+' charger');
    return bits.join(' + ');
  }
  function extractSpecs(item){
    var out={};
    for(var i=1;i<=10;i++){
      var label=clean(item && item['SpecLabel'+i]);
      var value=clean(item && item['SpecValue'+i]);
      if(label && value) out[label]=value;
    }
    if(clean(item && item.Weight)) out.Weight=clean(item.Weight)+' '+clean(item.WeightUnit);
    return out;
  }
  function optionPayload(x,type){
    var label=clean(x.Model)||clean(x.BatteryID)||clean(x.ChargerName)||clean(x.ChargerID)||clean(x.Description)||clean(x.SKU);
    var system=clean(x.System);
    if(type==='battery'){
      var batteryId=clean(x.BatteryID)||clean(x.Model)||clean(x.Description);
      var match=batteryId.match(/\b(AS|AK|AP|AR)\b/i) || batteryId.match(/^\s*(AS|AK|AP|AR)/i);
      if(match) system=match[1].toUpperCase();
    }
    return {
      type:type,
      sku:clean(x.SKU),
      label:label,
      price:money(x.SalePrice)>0?money(x.SalePrice):money(x.MSRP),
      system:system
    };
  }
  function pageData(products){
    var families=groupProducts(products);
    var liveState=(typeof state!=='undefined' && state) ? state : null;
    var batteries=activeList(liveState && liveState.batteries)
      .map(function(x){return optionPayload(x,'battery');})
      .filter(function(x){return x.price>0;});
    var chargers=activeList(liveState && liveState.chargers)
      .map(function(x){return optionPayload(x,'charger');})
      .filter(function(x){return x.price>0;});
    return {families:families,batteries:batteries,chargers:chargers};
  }
  function selectOptions(list,selected){
    return list.map(function(x){
      return '<option value="'+esc(x.sku)+'"'+(x.sku===selected?' selected':'')+'>'+esc(x.label)+' — $'+x.price.toFixed(2)+'</option>';
    }).join('');
  }
  function stockText(f){
    if(f.stock>0 && f.order>0) return '✓ In Stock: '+f.stock+' available · On Order: '+f.order;
    if(f.stock>0) return '✓ In Stock: '+f.stock+' available';
    if(f.order>0) return 'On Order: '+f.order+' incoming';
    return 'Available to Order';
  }
  function renderFamilyCard(f){
    var first=f.variants[0]||{};
    var image=f.image
      ? '<img src="'+esc(f.image)+'" alt="'+esc(f.name)+'" loading="lazy">'
      : '<div class="wep-smart-placeholder">Image Coming Soon</div>';
    var variantOptions=f.variants.map(function(v,i){
      return '<option value="'+i+'">'+esc(v.label)+' — $'+Number(v.price||0).toFixed(2)+'</option>';
    }).join('');
    return '<article class="wep-smart-card" data-family="'+esc(f.key)+'" data-type="'+esc(f.subcategory)+'" data-power="'+esc(f.power)+'" data-stock="'+(f.stock>0?'1':'0')+'" data-order="'+(f.order>0?'1':'0')+'">'+
      '<label class="wep-compare-pick"><input type="checkbox" data-compare="'+esc(f.key)+'"> Compare</label>'+
      '<div class="wep-smart-media">'+image+'</div>'+
      '<div class="wep-smart-body">'+
        '<p class="wep-smart-eyebrow">'+esc([f.power,f.subcategory].filter(Boolean).join(' · '))+'</p>'+
        '<h3>'+esc(f.name)+'</h3>'+
        '<p class="wep-smart-stock">'+esc(stockText(f))+'</p>'+
        '<p class="wep-smart-price">Starting at <strong>$'+Number(f.minPrice||0).toFixed(2)+'</strong></p>'+
        '<label>Choose configuration<select class="wep-variant" data-family="'+esc(f.key)+'">'+variantOptions+'</select></label>'+
        '<div class="wep-smart-battery-zone" data-family="'+esc(f.key)+'"></div>'+
        '<div class="wep-smart-total" data-total="'+esc(f.key)+'">Selected total: $'+Number(first.price||0).toFixed(2)+'</div>'+
        '<div class="wep-smart-actions">'+
          '<button type="button" data-add-cart="'+esc(f.key)+'">Add to Cart</button>'+
          '<a href="'+esc(first.configure||'#')+'" data-configure="'+esc(f.key)+'" target="_blank" rel="noopener">Build &amp; Price</a>'+
        '</div>'+
      '</div>'+
    '</article>';
  }
  function distinct(arr){
    return Array.from(new Set(arr.filter(Boolean))).sort(function(a,b){return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});});
  }
  function renderSmartMarkup(data,category){
    var types=distinct(data.families.map(function(f){return f.subcategory;}));
    var powers=distinct(data.families.map(function(f){return f.power;}));
    var typeButtons='<button type="button" class="active" data-filter-type="">All Types</button>'+types.map(function(x){return '<button type="button" data-filter-type="'+esc(x)+'">'+esc(x.replace(/\bBlower\b/i,'').trim()||x)+'</button>';}).join('');
    var powerButtons='<button type="button" class="active" data-filter-power="">All Power</button>'+powers.map(function(x){return '<button type="button" data-filter-power="'+esc(x)+'">'+esc(x)+'</button>';}).join('');
    return '<section id="wep-smart-catalog" class="wep-smart-catalog">'+
      '<div class="wep-smart-heading"><p>Shop by type, power source, availability or model.</p><h2>'+esc(category)+' — Filter, Compare &amp; Configure</h2></div>'+
      '<div class="wep-smart-toolbar">'+
        '<div><strong>Type</strong><div class="wep-filter-buttons" id="wep-type-filters">'+typeButtons+'</div></div>'+
        '<div><strong>Power</strong><div class="wep-filter-buttons" id="wep-power-filters">'+powerButtons+'</div></div>'+
        '<label class="wep-stock-toggle"><input type="checkbox" id="wep-stock-only"> In Stock / On Order only</label>'+
        '<label class="wep-search-label">Search<input id="wep-smart-search" type="search" placeholder="Model or keyword"></label>'+
      '</div>'+
      '<div class="wep-smart-results"><span id="wep-result-count">'+data.families.length+'</span> product families</div>'+
      '<div class="wep-smart-grid" id="wep-smart-grid">'+data.families.map(renderFamilyCard).join('')+'</div>'+
      '<div class="wep-compare-bar" id="wep-compare-bar" hidden><span><strong id="wep-compare-count">0</strong> selected</span><button type="button" id="wep-open-compare">Compare Selected</button><button type="button" id="wep-clear-compare">Clear</button></div>'+
      '<aside class="wep-cart" id="wep-cart"><div class="wep-cart-head"><h2>Cart</h2><span id="wep-cart-count">0 items</span></div><div id="wep-cart-lines"><p class="wep-cart-empty">Your cart is empty.</p></div><div class="wep-cart-footer"><strong id="wep-cart-total">$0.00</strong><p>Use Build &amp; Price on each line to continue into the configurator and quote system.</p></div></aside>'+
      '<dialog id="wep-compare-dialog"><form method="dialog"><button class="wep-dialog-close" aria-label="Close">×</button></form><h2>Compare Selected Models</h2><div id="wep-compare-table"></div></dialog>'+
    '</section>';
  }
  function smartCss(){
    return '<style id="wep-smart-style">'+
    '.wep-product-section{display:none!important}.wep-comparison{display:none!important}'+
    '.wep-smart-catalog{margin:30px 0}.wep-smart-heading{text-align:center;margin:0 0 18px}.wep-smart-heading h2{margin:4px 0;font-size:32px}.wep-smart-toolbar{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px;border:1px solid #ddd;border-radius:12px;background:#fafafa}.wep-filter-buttons{display:flex;flex-wrap:wrap;gap:7px;margin-top:7px}.wep-filter-buttons button,.wep-smart-actions button,.wep-compare-bar button{border:1px solid #222;border-radius:999px;background:#fff;padding:8px 12px;font-weight:800;cursor:pointer}.wep-filter-buttons button.active{background:#202020;color:#fff}.wep-stock-toggle{display:flex;align-items:center;gap:8px;font-weight:800}.wep-stock-toggle input{width:auto}.wep-search-label input{display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #bbb;border-radius:8px}.wep-smart-results{margin:14px 0;font-weight:800}.wep-smart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.wep-smart-card{position:relative;overflow:hidden;border:1px solid #ccc;border-top:6px solid #c8102e;border-radius:14px;background:#fff}.wep-compare-pick{position:absolute;z-index:3;top:10px;left:10px;background:#fff;border-radius:20px;padding:6px 9px;font-size:13px;font-weight:800;box-shadow:0 2px 8px rgba(0,0,0,.16)}.wep-compare-pick input{width:auto}.wep-smart-media{height:280px;display:flex;align-items:center;justify-content:center;background:#f5f5f5}.wep-smart-media img{width:100%;height:100%;object-fit:contain}.wep-smart-placeholder{font-weight:800;color:#666}.wep-smart-body{padding:18px}.wep-smart-eyebrow{margin:0 0 5px;color:#666;font-size:12px;font-weight:900;text-transform:uppercase}.wep-smart-body h3{margin:0 0 8px;font-size:25px}.wep-smart-stock{font-weight:800;color:#287a32}.wep-smart-price strong{color:#c8102e;font-size:25px}.wep-smart-body label{display:block;margin:12px 0;font-weight:800}.wep-smart-body select{width:100%;margin-top:5px;padding:10px;border:1px solid #bbb;border-radius:8px;background:#fff}.wep-smart-option-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.wep-smart-total{margin:14px 0;padding:10px;border-radius:8px;background:#f4f4f4;font-weight:900}.wep-smart-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.wep-smart-actions button,.wep-smart-actions a{display:flex;align-items:center;justify-content:center;min-height:44px;border:2px solid #171717;border-radius:8px;text-decoration:none;font-weight:900}.wep-smart-actions button{background:#c8102e;color:#fff;border-color:#c8102e}.wep-compare-bar{position:sticky;bottom:12px;z-index:20;display:flex;align-items:center;gap:10px;margin:18px auto;padding:11px 14px;max-width:620px;border-radius:12px;background:#202020;color:#fff;box-shadow:0 5px 20px rgba(0,0,0,.25)}.wep-compare-bar[hidden]{display:none}.wep-compare-bar span{margin-right:auto}.wep-cart{margin:32px 0;padding:20px;border:2px solid #202020;border-radius:14px;background:#fff}.wep-cart-head{display:flex;justify-content:space-between;align-items:center}.wep-cart-line{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:12px 0;border-top:1px solid #ddd}.wep-cart-line small{display:block;color:#666}.wep-cart-line button{border:0;background:none;text-decoration:underline;cursor:pointer}.wep-cart-footer{display:flex;justify-content:space-between;gap:20px;align-items:start;border-top:2px solid #222;padding-top:14px}.wep-cart-footer strong{font-size:27px}.wep-cart-footer p{max-width:560px;margin:0;color:#555}.wep-cart-empty{color:#666}.wep-smart-card[hidden]{display:none!important}dialog#wep-compare-dialog{width:min(1100px,94vw);max-height:90vh;border:0;border-radius:14px;padding:22px;box-shadow:0 14px 50px rgba(0,0,0,.35)}dialog#wep-compare-dialog::backdrop{background:rgba(0,0,0,.55)}.wep-dialog-close{float:right;border:0;background:none;font-size:32px;cursor:pointer}.wep-compare-table-wrap{overflow:auto}.wep-compare-table{width:100%;border-collapse:collapse;min-width:700px}.wep-compare-table th,.wep-compare-table td{padding:10px;border-bottom:1px solid #ddd;text-align:left}.wep-compare-table thead th{background:#202020;color:#fff;position:sticky;top:0}'+
    '@media(max-width:760px){.wep-smart-toolbar{grid-template-columns:1fr}.wep-smart-grid{grid-template-columns:1fr}.wep-smart-option-row{grid-template-columns:1fr}.wep-smart-actions{grid-template-columns:1fr}.wep-cart-line{grid-template-columns:1fr auto}.wep-cart-line>a{grid-column:1/-1}.wep-cart-footer{display:block}.wep-compare-bar{margin-left:8px;margin-right:8px}}'+
    '</style>';
  }
  function runtimeScript(data){
    var safe=JSON.stringify(data).replace(/</g,'\\u003c');
    return '<script>(function(){'+
      'var DATA='+safe+';var families=DATA.families||[];var byKey={};families.forEach(function(f){byKey[f.key]=f;});var cart=[];var compare=[];var type="";var power="";'+
      'function q(s,r){return (r||document).querySelector(s)}function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}function m(v){return "$"+Number(v||0).toFixed(2)}function esc(v){var d=document.createElement("div");d.textContent=String(v==null?"":v);return d.innerHTML}'+
      'function selectedVariant(key){var f=byKey[key],sel=q(".wep-variant[data-family=\\\""+CSS.escape(key)+"\\\"]");return f&&f.variants[Number(sel&&sel.value||0)]||null}'+
      'function compatible(list,sys){sys=String(sys||"").toUpperCase();return (list||[]).filter(function(x){return String(x.system||"").toUpperCase().split(/[|,;/]+/).map(function(y){return y.trim()}).indexOf(sys)>=0})}'+
      'function drawOptions(key){var v=selectedVariant(key),zone=q(".wep-smart-battery-zone[data-family=\\\""+CSS.escape(key)+"\\\"]");if(!v||!zone)return;if(v.isKit){zone.innerHTML=v.kitIncludes?"<div class=\\\"wep-kit-includes\\\"><strong>Factory kit includes:</strong> "+esc(v.kitIncludes)+"</div>":"";reTotal(key);return;}var bats=compatible(DATA.batteries,v.system),chs=compatible(DATA.chargers,v.system);if(!bats.length&&!chs.length){zone.innerHTML="";reTotal(key);return;}zone.innerHTML="<div class=\\\"wep-smart-option-row\\\">"+(bats.length?"<label>Battery<select data-battery=\\\""+esc(key)+"\\\"><option value=\\\"\\\">No added battery</option>"+bats.map(function(x){return "<option value=\\\""+esc(x.sku)+"\\\">"+esc(x.label)+" — "+m(x.price)+"</option>"}).join("")+"</select></label>":"")+(chs.length?"<label>Charger<select data-charger=\\\""+esc(key)+"\\\"><option value=\\\"\\\">No added charger</option>"+chs.map(function(x){return "<option value=\\\""+esc(x.sku)+"\\\">"+esc(x.label)+" — "+m(x.price)+"</option>"}).join("")+"</select></label>":"")+"</div>";qa("select",zone).forEach(function(s){s.addEventListener("change",function(){reTotal(key)})});reTotal(key)}'+
      'function findOpt(list,sku){return (list||[]).find(function(x){return x.sku===sku})||null}function selectedExtras(key){var b=q("[data-battery=\\\""+CSS.escape(key)+"\\\"]"),c=q("[data-charger=\\\""+CSS.escape(key)+"\\\"]");return {battery:b?findOpt(DATA.batteries,b.value):null,charger:c?findOpt(DATA.chargers,c.value):null}}'+
      'function reTotal(key){var v=selectedVariant(key);if(!v)return;var e=selectedExtras(key),t=Number(v.price||0)+Number(e.battery&&e.battery.price||0)+Number(e.charger&&e.charger.price||0);var el=q("[data-total=\\\""+CSS.escape(key)+"\\\"]");if(el)el.textContent="Selected total: "+m(t);var a=q("[data-configure=\\\""+CSS.escape(key)+"\\\"]");if(a)a.href=v.configure||"#"}'+
      'function filters(){var search=(q("#wep-smart-search")||{}).value||"";search=search.toUpperCase();var only=!!(q("#wep-stock-only")||{}).checked;var visible=0;qa(".wep-smart-card").forEach(function(card){var f=byKey[card.dataset.family];var ok=(!type||f.subcategory===type)&&(!power||f.power===power)&&(!only||f.stock>0||f.order>0)&&(!search||(f.name+" "+f.subcategory+" "+f.power+" "+f.series).toUpperCase().indexOf(search)>=0);card.hidden=!ok;if(ok)visible++;});var n=q("#wep-result-count");if(n)n.textContent=visible}'+
      'function drawCart(){var lines=q("#wep-cart-lines"),count=q("#wep-cart-count"),total=q("#wep-cart-total");if(!lines)return;if(!cart.length){lines.innerHTML="<p class=\\\"wep-cart-empty\\\">Your cart is empty.</p>"}else{lines.innerHTML=cart.map(function(x,i){return "<div class=\\\"wep-cart-line\\\"><div><strong>"+esc(x.name)+" — "+esc(x.variant.label)+"</strong><small>"+[x.battery&&x.battery.label,x.charger&&x.charger.label].filter(Boolean).map(esc).join(" · ")+"</small></div><strong>"+m(x.total)+"</strong><div><a href=\\\""+esc(x.variant.configure)+"\\\" target=\\\"_blank\\\" rel=\\\"noopener\\\">Build &amp; Price</a> · <button type=\\\"button\\\" data-remove-cart=\\\""+i+"\\\">Remove</button></div></div>"}).join("")}if(count)count.textContent=cart.length+" item"+(cart.length===1?"":"s");if(total)total.textContent=m(cart.reduce(function(s,x){return s+x.total},0));qa("[data-remove-cart]").forEach(function(b){b.onclick=function(){cart.splice(Number(b.dataset.removeCart),1);drawCart()}})}'+
      'function addCart(key){var f=byKey[key],v=selectedVariant(key);if(!f||!v)return;var e=selectedExtras(key),t=Number(v.price||0)+Number(e.battery&&e.battery.price||0)+Number(e.charger&&e.charger.price||0);cart.push({name:f.name,variant:v,battery:e.battery,charger:e.charger,total:t});drawCart();q("#wep-cart").scrollIntoView({behavior:"smooth",block:"start"})}'+
      'function drawCompare(){var selected=compare.map(function(k){return byKey[k]}).filter(Boolean);var labels=[];selected.forEach(function(f){Object.keys(f.specs||{}).forEach(function(k){if(labels.indexOf(k)<0)labels.push(k)})});var html="<div class=\\\"wep-compare-table-wrap\\\"><table class=\\\"wep-compare-table\\\"><thead><tr><th>Feature</th>"+selected.map(function(f){return "<th>"+esc(f.name)+"</th>"}).join("")+"</tr></thead><tbody><tr><th>Starting Price</th>"+selected.map(function(f){return "<td>"+m(f.minPrice)+"</td>"}).join("")+"</tr><tr><th>Power</th>"+selected.map(function(f){return "<td>"+esc(f.power)+"</td>"}).join("")+"</tr><tr><th>Type</th>"+selected.map(function(f){return "<td>"+esc(f.subcategory)+"</td>"}).join("")+"</tr><tr><th>Availability</th>"+selected.map(function(f){return "<td>"+(f.stock>0?"In Stock: "+f.stock:(f.order>0?"On Order: "+f.order:"Available to Order"))+"</td>"}).join("")+"</tr>"+labels.map(function(l){return "<tr><th>"+esc(l)+"</th>"+selected.map(function(f){return "<td>"+esc((f.specs||{})[l]||"—")+"</td>"}).join("")+"</tr>"}).join("")+"</tbody></table></div>";q("#wep-compare-table").innerHTML=html}'+
      'function syncCompare(){var bar=q("#wep-compare-bar"),cnt=q("#wep-compare-count");if(cnt)cnt.textContent=compare.length;if(bar)bar.hidden=!compare.length;qa("[data-compare]").forEach(function(c){c.checked=compare.indexOf(c.dataset.compare)>=0})}'+
      'qa("[data-filter-type]").forEach(function(b){b.onclick=function(){type=b.dataset.filterType||"";qa("[data-filter-type]").forEach(function(x){x.classList.toggle("active",x===b)});filters()}});qa("[data-filter-power]").forEach(function(b){b.onclick=function(){power=b.dataset.filterPower||"";qa("[data-filter-power]").forEach(function(x){x.classList.toggle("active",x===b)});filters()}});'+
      'q("#wep-smart-search").addEventListener("input",filters);q("#wep-stock-only").addEventListener("change",filters);'+
      'qa(".wep-variant").forEach(function(s){s.addEventListener("change",function(){drawOptions(s.dataset.family)});drawOptions(s.dataset.family)});'+
      'qa("[data-add-cart]").forEach(function(b){b.addEventListener("click",function(){addCart(b.dataset.addCart)})});'+
      'qa("[data-compare]").forEach(function(c){c.addEventListener("change",function(){var k=c.dataset.compare;if(c.checked){if(compare.length>=4){c.checked=false;alert("Compare up to 4 products at a time.");return}if(compare.indexOf(k)<0)compare.push(k)}else compare=compare.filter(function(x){return x!==k});syncCompare()})});'+
      'q("#wep-clear-compare").onclick=function(){compare=[];syncCompare()};q("#wep-open-compare").onclick=function(){drawCompare();var d=q("#wep-compare-dialog");if(d.showModal)d.showModal();else d.setAttribute("open","")};'+
      'filters();drawCart();syncCompare();'+
    '})()<'+ '/script>';
  }
  function enhanceGeneratedPage(){
    var enabled=document.getElementById('stihl-webpage-smart-catalog');
    if(enabled && !enabled.checked) return;
    var textarea=document.getElementById('stihl-webpage-code');
    if(!textarea || !clean(textarea.value)) return;
    if(textarea.value.indexOf('id="wep-smart-catalog"')>=0) return;
    if(typeof window.webpageProducts !== 'function') return;
    var products=window.webpageProducts();
    if(!products || !products.length) return;
    var category=clean(document.getElementById('stihl-webpage-category') && document.getElementById('stihl-webpage-category').value) || 'Equipment';
    var data=pageData(products);
    var insertion=smartCss()+renderSmartMarkup(data,category)+runtimeScript(data);
    var marker='</div>';
    var pos=textarea.value.lastIndexOf(marker);
    textarea.value = pos>=0
      ? textarea.value.slice(0,pos)+insertion+textarea.value.slice(pos)
      : textarea.value+insertion;
    var status=document.getElementById('stihl-webpage-status');
    if(status){
      status.className='stihl-success';
      status.textContent='Interactive webpage ready: '+data.families.length+' product families from '+products.length+' SKUs, with filters, compare, battery/charger options and cart.';
    }
  }
  function installBuilderControl(){
    var filter=document.getElementById('stihl-webpage-filter');
    if(!filter || document.getElementById('stihl-webpage-smart-catalog')) return;
    var host=filter.closest('div') || filter.parentNode;
    var wrap=document.createElement('div');
    wrap.style.gridColumn='1/-1';
    wrap.innerHTML='<label style="display:flex;gap:9px;align-items:center;padding:10px 12px;border:1px solid #ddd;border-radius:9px;background:#fff8ef;"><input id="stihl-webpage-smart-catalog" type="checkbox" checked style="width:auto;"> <span><strong>Interactive product catalog</strong><br><small>Group SKUs into product families and add filters, variants, compare, battery/charger options and cart.</small></span></label>';
    host.parentNode.insertBefore(wrap,host.nextSibling);
  }
  function wire(){
    installBuilderControl();
    var gen=document.getElementById('stihl-generate-webpage');
    if(gen && !gen.dataset.smartCatalogWired){
      gen.dataset.smartCatalogWired='1';
      gen.addEventListener('click',function(){ setTimeout(enhanceGeneratedPage,0); });
    }
    var open=document.getElementById('stihl-build-webpages');
    if(open && !open.dataset.smartCatalogWired){
      open.dataset.smartCatalogWired='1';
      open.addEventListener('click',function(){ setTimeout(installBuilderControl,0); });
    }
  }
  api.familyName=familyName;
  api.variantBaseLabel=variantBaseLabel;
  api.groupProducts=groupProducts;
  api.buildGeneratedCatalog=function(products,category){
    var data=pageData(products||[]);
    if(!data.families.length) return '';
    return smartCss()+renderSmartMarkup(data,clean(category)||'Equipment')+runtimeScript(data);
  };
  api.enhanceGeneratedPage=enhanceGeneratedPage;
  api.install=wire;

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire);
  else wire();
})();