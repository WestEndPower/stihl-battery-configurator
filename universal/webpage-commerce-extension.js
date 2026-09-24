(function(){
  'use strict';

  var api = window.WestEndWebCatalog = window.WestEndWebCatalog || {};
  var MAX_COMPARE = 4;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function money(v){
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function fmtMoney(v){
    return '$' + (Number(v)||0).toLocaleString('en-US',{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    });
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
    if(pt === 'kit') return 'Package';
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
    return 0;
  }
  function normalStockLocations(item){
    var locations=[];
    if((Number(item && item.QtyDanbury)||0)>0) locations.push('Danbury');
    if((Number(item && item.QtyNewMilford)||0)>0) locations.push('New Milford');
    return locations;
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
    raw=raw.replace(/^\.?\//,'').replace(/^images\/products\//i,'images/Products/');
    return 'https://www.westendpower.com/stihl-equipment-configurator/' + raw;
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
          series:clean(item.Series) ||
            (/^(AS|AK|AP|AR)$/i.test(clean(item.System))
              ? clean(item.System).toUpperCase()
              : ''),
          items:[],
          image:'',
          stock:0,
          order:0,
          normalLocations:new Set(),
          minPrice:Infinity
        });
      }
      var f=map.get(key);
      f.items.push(item);
      f.stock += inStock(item);
      f.order += onOrder(item);
      normalStockLocations(item).forEach(function(location){f.normalLocations.add(location);});
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
          label=base + ' &middot; ' + clean(item.SKU);
        }
        return {
          sku:clean(item.SKU),
          label:label,
          description:clean(item.Description),
          price:currentPrice(item),
          msrp:money(item.MSRP),
          salePrice:money(item.SalePrice),
          saleStart:clean(item.SaleStartDate),
          saleEnd:clean(item.SaleEndDate),
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
      f.normalLocations=Array.from(f.normalLocations);
      f.specs=extractSpecs(f.items[0]||{});
    });
    var powerRank={ELECTRIC:1,BATTERY:2,GAS:3};
    return Array.from(map.values()).sort(function(a,b){
      var pa=powerRank[clean(a.power).toUpperCase()]||99;
      var pb=powerRank[clean(b.power).toUpperCase()]||99;
      return pa-pb ||
        a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'});
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
  function compactComponentName(value){
    var text=clean(value);

    text=text.replace(
      /\b(AS|AK|AP|AR)\s+(\d+(?:\.\d+)?)\s*([A-Z]?)\b/gi,
      function(match,prefix,number,suffix){
        return prefix.toUpperCase()+number+(suffix||'').toUpperCase();
      }
    );

    text=text.replace(
      /\b(AL)\s+(\d+(?:-\d+)?)\b/gi,
      function(match,prefix,number){
        return prefix.toUpperCase()+number;
      }
    );

    return text;
  }

  function packageItemName(item){
    if(!item) return '';

    var battery=clean(item.BatteryID);

    if(battery){
      var bm=clean(item.Model)||battery;
      bm=bm.replace(/\.0(?=[A-Z]|\s|$)/g,'');
      return compactComponentName(bm)+' Battery';
    }

    var charger=clean(item.ChargerID);

    if(charger){
      return compactComponentName(charger)+' Charger';
    }

    return compactComponentName(
      clean(item.Model || item.ChargerName || item.Description || item.SKU)
    );
  }
  function buildComponentLookups(liveState){
    var batteries=activeList((liveState && liveState.batteries)||[]);
    var chargers=activeList((liveState && liveState.chargers)||[]);
    return {
      batteryBySku:new Map(batteries.flatMap(function(x){
        return [
          [norm(x.StihlID||x.SKU),x],
          [norm(x.SKU),x]
        ];
      })),
      chargerBySku:new Map(chargers.flatMap(function(x){
        return [
          [norm(x.StihlID||x.SKU),x],
          [norm(x.SKU),x]
        ];
      })),
      batteryById:new Map(batteries.map(function(x){return [norm(x.BatteryID||x.Model),x];})),
      chargerById:new Map(chargers.map(function(x){return [norm(x.ChargerID||x.Model),x];}))
    };
  }
  function enrichPackageVariants(families,liveState){
    var packages=(liveState && liveState.packages)||[];
    var compatibility=(liveState && liveState.compatibility)||[];
    var lookups=buildComponentLookups(liveState);
    var pools=[
      ...((liveState && liveState.batteries)||[]),
      ...((liveState && liveState.chargers)||[]),
      ...((liveState && liveState.attachments)||[]),
      ...((liveState && liveState.accessories)||[]),
      ...((liveState && liveState.parts)||[])
    ];
    var bySku=new Map(pools.flatMap(function(item){
      return [
        [norm(item.StihlID||item.SKU),item],
        [norm(item.SKU),item]
      ];
    }));
    var packageByParent=new Map(packages.map(function(row){return [norm(row.ParentSKU),row];}));
    var compatByTool=new Map();
    compatibility.forEach(function(row){
      if(clean(row.Active) && !isTrue(row.Active)) return;
      var key=norm(row.ToolSKU);
      if(!key || !clean(row.RecommendedBatteryID1) || !clean(row.RecommendedChargerID1)) return;
      if(!compatByTool.has(key) || !clean(row.AttachmentSKU)) compatByTool.set(key,row);
    });

    families.forEach(function(family){
      var toolVariant=family.variants.find(function(v){return !v.isKit;});
      family.variants.forEach(function(v){
        if(!v.isKit) return;
        var row=packageByParent.get(norm(v.sku));
        if(!row) return;

        var included=[];
        var componentTotal=0;
        [
          ['Battery',3],
          ['Charger',3],
          ['Attachment',3],
          ['Accessory',3],
          ['Part',3]
        ].forEach(function(def){
          var prefix=def[0],max=def[1];
          for(var i=1;i<=max;i++){
            var componentSku=clean(row[prefix+'SKU'+i]);
            var qty=Math.max(0,Number(clean(row[prefix+'Qty'+i]))||0);
            if(!componentSku || qty<=0) continue;
            var item=bySku.get(norm(componentSku));
            if(!item && prefix==='Battery') item=lookups.batteryBySku.get(norm(componentSku))||null;
            if(!item && prefix==='Charger') item=lookups.chargerBySku.get(norm(componentSku))||null;
            var name=item ? packageItemName(item) : componentSku;
            var price=item ? currentPrice(item) : 0;
            included.push({type:prefix,sku:componentSku,qty:qty,name:name,price:price});
            componentTotal+=price*qty;
          }
        });

        v.packageItems=included;
        v.packageIncludes=included.map(function(x){
          return (x.qty>1 ? x.qty+' \u00d7 ' : '')+x.name;
        }).join(' + ');
        var separateBase=(toolVariant ? Number(toolVariant.price||0) : 0)+componentTotal;
        v.separatePrice=separateBase;
        v.packageSavings=Number(v.price||0)>0 ? Math.max(0,separateBase-Number(v.price||0)) : 0;
      });

      if(toolVariant && clean(family.power).toUpperCase()==='BATTERY' && !family.variants.some(function(v){return v.isKit;})){
        var compat=compatByTool.get(norm(toolVariant.sku));
        var source=family.items.find(function(x){return norm(x.SKU)===norm(toolVariant.sku);})||{};
        var batteryId=clean((compat && compat.RecommendedBatteryID1)||source.RecommendedBatteryID1||source.RecommendedBattery);
        var chargerId=clean((compat && compat.RecommendedChargerID1)||source.RecommendedChargerID1||source.StandardCharger);
        if(batteryId && chargerId){
          var batteryQty=Math.max(1,Number(clean(compat && compat.RecommendedBatteryQty1))||1);
          var chargerQty=Math.max(1,Number(clean(compat && compat.RecommendedChargerQty1))||1);
          var battery=lookups.batteryById.get(norm(batteryId))||null;
          var charger=lookups.chargerById.get(norm(chargerId))||null;
          if(battery && charger && currentPrice(battery)>0 && currentPrice(charger)>0){
            var items=[];
            var toolPrice=Number(toolVariant.price||0);
            var recommendedPriced=toolPrice>0;
            var total=recommendedPriced?toolPrice:0;
            if(battery){
              var bp=currentPrice(battery);
              items.push({type:'Battery',sku:clean(battery.SKU),qty:batteryQty,name:packageItemName(battery),price:bp});
              if(recommendedPriced) total+=bp*batteryQty;
            }
            if(charger){
              var cp=currentPrice(charger);
              items.push({type:'Charger',sku:clean(charger.SKU),qty:chargerQty,name:packageItemName(charger),price:cp});
              if(recommendedPriced) total+=cp*chargerQty;
            }
            family.recommendedPackage={
              price:total,
              includes:items.map(function(x){return (x.qty>1?x.qty+' \u00d7 ':'')+x.name;}).join(' + ')
            };
            family.variants.push({
              sku:toolVariant.sku,label:'Package',description:toolVariant.description,
              price:total,system:toolVariant.system,configure:toolVariant.configure,
              details:toolVariant.details,
              isKit:false,isRecommendedPackage:true,packageItems:items,
              packageIncludes:family.recommendedPackage.includes
            });
          }
        }
      }
    });
    return families;
  }
  function pageData(products){
    var families=groupProducts(products);
    var liveState=window.WestEndConfiguratorState || ((typeof state!=='undefined' && state) ? state : null);
    enrichPackageVariants(families,liveState);
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
      return '<option value="'+esc(x.sku)+'"'+(x.sku===selected?' selected':'')+'>'+esc(x.label)+' &mdash; $'+x.price.toFixed(2)+'</option>';
    }).join('');
  }
  function stockText(f){
    if(f.stock>0 && f.order>0) return '\u2713 In Stock: '+f.stock+' available &middot; On Order: '+f.order;
    if(f.stock>0) return '\u2713 In Stock: '+f.stock+' available';
    if(f.order>0) return 'On Order: '+f.order+' incoming';
    if(f.normalLocations && f.normalLocations.length){
      return 'Normally Stocked in '+f.normalLocations.join(' and ');
    }
    return 'Available to Order';
  }
  function stockNote(f){
    if(f.stock>0) return 'In Stock';
    if(f.order>0) return 'On Order';
    return '';
  }
  function saleInfo(v){
    if(!v) return null;
    var regular=Number(v.msrp||0);
    var sale=Number(v.salePrice||0);
    if(!(regular>0 && sale>0 && sale<regular)) return null;
    var now=new Date();
    function parse(raw,endOfDay){
      raw=clean(raw);
      if(!raw) return null;
      var p=raw.split('-').map(Number);
      if(p.length!==3) return null;
      return new Date(p[0],p[1]-1,p[2],endOfDay?23:0,endOfDay?59:0,endOfDay?59:0);
    }
    var start=parse(v.saleStart,false);
    var end=parse(v.saleEnd,true);
    if(start && now<start) return null;
    if(end && now>end) return null;
    return {regular:regular,sale:sale,savings:regular-sale,end:v.saleEnd};
  }
  function shortDate(raw){
    raw=clean(raw);
    if(!raw) return '';
    var p=raw.split('-').map(Number);
    if(p.length!==3) return raw;
    return new Date(p[0],p[1]-1,p[2]).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  }
  function includedSummary(variant){
    var components=(variant && variant.packageItems)||[];

    var names=components.map(function(item){
      var qty=Math.max(1,Number(item.qty)||1);
      var name=compactComponentName(clean(item.name||item.sku));

      if(qty>1){
        name=name
          .replace(/\bBattery$/i,'Batteries')
          .replace(/\bCharger$/i,'Chargers');
      }

      return (qty>1?qty+' ':'')+name;
    });

    if(!names.length){
      names=clean(
        variant && (variant.packageIncludes||variant.kitIncludes)
      )
        .split(/\s*\+\s*/)
        .filter(Boolean)
        .map(compactComponentName);
    }

    if(!names.length) return '';

    return names.length===1
      ? names[0]+' included'
      : names.slice(0,-1).join(', ')+' and '+names[names.length-1]+' included';
  }
  function priceRow(label,variant,sale){
    var price=Number(variant && variant.price || 0);
    var priced=price>0;
    var priceHtml='';

    if(!priced){
      priceHtml=
        '<strong class="wep-price-coming-soon">Pricing Coming Soon</strong>';
    }
    else if(sale){
      priceHtml=
        '<del>'+fmtMoney(sale.regular)+'</del>'+
        '<strong>'+fmtMoney(sale.sale)+'</strong>';
    }
    else{
      priceHtml=
        '<strong>'+fmtMoney(price)+'</strong>';
    }

    return '<div class="wep-price-heading">'+
      '<span class="wep-price-label">'+esc(label)+'</span>'+
      '<span class="wep-price-pair">'+priceHtml+'</span>'+
    '</div>';
  }
  function renderFamilyPrices(f){
    var tool=f.variants.find(function(v){
      return !v.isKit && !v.isRecommendedPackage;
    });

    var kit=f.variants.find(function(v){
      return v.isKit;
    });

    var out='<div class="wep-price-lines">';

    if(tool){
      var toolSale=Number(tool.price||0)>0
        ? saleInfo(tool)
        : null;

      out+='<div class="wep-price-choice wep-tool-choice">'+
        priceRow('Tool Only',tool,toolSale);

      if(clean(f.power).toUpperCase()==='BATTERY'){
        out+='<small class="wep-includes">Battery and charger sold separately</small>';
      }

      out+='</div>';
    }

    if(kit){
      var kitPriced=Number(kit.price||0)>0;
      var kitSale=kitPriced ? saleInfo(kit) : null;

      out+='<div class="wep-price-choice wep-kit-choice">'+
        priceRow('Package',kit,kitSale);

      var kitContents=includedSummary(kit);

      if(kitContents){
        out+='<small class="wep-includes">'+
          esc(kitContents)+
          '</small>';
      }

      if(
        kitPriced &&
        Number(kit.packageSavings||0)>0 &&
        Number(kit.separatePrice||0)>0
      ){
        out+='<small class="wep-package-value">'+
          'Package value '+fmtMoney(kit.separatePrice||0)+
          ' <span aria-hidden="true">&middot;</span> '+
          '<strong class="wep-save">Save '+
          fmtMoney(kit.packageSavings)+
          '</strong></small>';
      }else{
        out+='<small class="wep-package-value wep-package-spacer">&nbsp;</small>';
      }

      out+='</div>';
    }
    else if(f.recommendedPackage){
      var recommended=f.variants.find(function(v){
        return v.isRecommendedPackage;
      })||f.recommendedPackage;

      out+='<div class="wep-price-choice wep-kit-choice">'+
        priceRow('Package',recommended,null);

      var recommendedContents=includedSummary(recommended);

      if(recommendedContents){
        out+='<small class="wep-includes">'+
          esc(recommendedContents)+
          '</small>';
      }

      out+='<small class="wep-package-value wep-package-spacer">&nbsp;</small>';
      out+='</div>';
    }

    if(!tool && !kit && !f.recommendedPackage){
      out+='<p><span>Starting at</span><strong>'+
        (
          Number(f.minPrice||0)>0
            ? fmtMoney(f.minPrice)
            : 'Pricing Coming Soon'
        )+
        '</strong></p>';
    }

    return out+'</div>';
  }
  function renderInitialOptions(f,data){
    var first=f.variants[0]||{};
    if(first.isKit){
      return first.kitIncludes
        ? '<div class="wep-kit-includes"><strong>Factory kit includes:</strong> '+esc(first.kitIncludes)+'</div>'
        : '';
    }
    var batteries=(data.batteries||[]).filter(function(x){return compatibleBySystem(first.system,x.system);});
    var chargers=(data.chargers||[]).filter(function(x){return compatibleBySystem(first.system,x.system);});
    if(!batteries.length && !chargers.length) return '';
    return '<div class="wep-smart-option-row">'+
      (batteries.length
        ? '<label>Battery<select data-battery="'+esc(f.key)+'"><option value="">No added battery</option>'+selectOptions(batteries,'')+'</select></label>'
        : '')+
      (chargers.length
        ? '<label>Charger<select data-charger="'+esc(f.key)+'"><option value="">No added charger</option>'+selectOptions(chargers,'')+'</select></label>'
        : '')+
      '</div>';
  }
  function specIcon(label){
    var key=clean(label).toLowerCase();

    if(key==='weight'){
      return '<svg viewBox="0 0 48 48" aria-hidden="true">'+
        '<path d="M17 14h14l5 25H12l5-25zm4-5a3 3 0 1 1 6 0 3 3 0 0 1-6 0z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'+
      '</svg>';
    }

    if(key==='max. air velocity'){
      return '<svg viewBox="0 0 48 48" aria-hidden="true">'+
        '<path d="M5 16h22c5 0 7-8 1-10-4-1-6 2-6 4M5 24h31c7 0 8-10 2-12M5 32h22c5 0 7 8 1 10-4 1-6-2-6-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'+
      '</svg>';
    }

    if(key==='air volume'){
      return '<svg viewBox="0 0 48 48" aria-hidden="true">'+
        '<path d="M24 7c5 0 6 8 3 13 5-3 13-2 13 3s-8 6-13 3c3 5 2 13-3 13s-6-8-3-13c-5 3-13 2-13-3s8-6 13-3c-3-5-2-13 3-13z" fill="currentColor"/>'+
      '</svg>';
    }

    if(key==='blowing force'){
      return '<svg viewBox="0 0 48 48" aria-hidden="true">'+
        '<path d="M15 38c-5-4-6-12-1-17l5-5v-5c0-4 6-4 6 0v7l4-3c4-3 7 2 4 5l-3 3 5-1c4-1 6 5 2 7l-7 3c-4 2-5 8-15 6z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'+
      '</svg>';
    }

    return '';
  }

  function renderCardSpecs(f){
    var wanted=clean(f.category).toLowerCase()==='blowers'
      ? ['Weight','Max. Air Velocity','Air Volume','Blowing Force']
      : [];

    var values=f.specs||{};

    var items=wanted.map(function(label){
      var value=clean(values[label]);

      if(!value && label==='Weight'){
        value=clean(values.Weight);
      }

      if(!value) return '';

      return '<div class="wep-spec-tile">'+
        '<span class="wep-spec-copy">'+
          '<span class="wep-spec-label">'+esc(label)+'</span>'+
          '<strong>'+esc(value)+'</strong>'+
        '</span>'+
      '</div>';
    }).filter(Boolean).slice(0,4);

    return items.length
      ? '<div class="wep-spec-strip">'+items.join('')+'</div>'
      : '';
  }
  function renderImagePromo(f){
    var saleVariant=(f.variants||[])
      .map(function(v){
        return {
          v:v,
          s:Number(v.price||0)>0 ? saleInfo(v) : null
        };
      })
      .find(function(x){
        return x.s;
      });

    if(!saleVariant) return '';

    var sale=saleVariant.s;

    var date=sale.end
      ? shortDate(sale.end).replace(
          /^([A-Za-z]{3}) /,
          '$1. '
        )
      : '';

    var savings=fmtMoney(sale.savings)
      .replace(/\.00$/,'');

    return '<div class="wep-promo-ribbon">'+
      '<span class="wep-ribbon-tail wep-ribbon-left"></span>'+
      '<span class="wep-ribbon-center">'+
        '<strong>'+esc(savings)+' Savings</strong>'+
        (date ? '<small>thru '+esc(date)+'</small>' : '')+
      '</span>'+
      '<span class="wep-ribbon-tail wep-ribbon-right"></span>'+
    '</div>';
  }
  function renderFamilyCard(f,data){
    var first=f.variants[0]||{};
    var specsHtml=renderCardSpecs(f);

    var description=[f.power,f.subcategory]
      .filter(Boolean)
      .map(esc)
      .join(' - ');

    var image=f.image
      ? '<img src="'+esc(f.image)+'" alt="'+esc(f.name)+'" loading="lazy">'
      : '<div class="wep-smart-placeholder">Image Coming Soon</div>';

    var variantOptions=
      '<option value="" selected disabled>Choose Purchase Option</option>'+
      f.variants.map(function(v,i){
        return '<option value="'+i+'">'+esc(v.label)+'</option>';
      }).join('');

    var cartIcon=
      '<svg viewBox="0 0 24 24" aria-hidden="true">'+
        '<path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20 8H7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
        '<circle cx="10" cy="19" r="1.5" fill="currentColor"/>'+
        '<circle cx="17" cy="19" r="1.5" fill="currentColor"/>'+
      '</svg>';

    return '<article class="wep-smart-card" '+
      'data-family="'+esc(f.key)+'" '+
      'data-type="'+esc(f.subcategory)+'" '+
      'data-power="'+esc(f.power)+'" '+
      'data-series="'+esc(f.series)+'" '+
      'data-stock="'+(f.stock>0?'1':'0')+'" '+
      'data-order="'+(f.order>0?'1':'0')+'">'+

      '<header class="wep-card-header">'+
        '<h3 class="wep-model-heading">'+
          '<strong>'+esc(f.name)+'</strong>'+
          (description ? '<span>'+description+'</span>' : '')+
        '</h3>'+

        '<label class="wep-compare-pick">'+
          '<input type="checkbox" data-compare="'+esc(f.key)+'">'+
          '<span>Compare</span>'+
        '</label>'+
      '</header>'+

      '<div class="wep-card-main">'+

        '<section class="wep-card-left">'+
          '<div class="wep-smart-media">'+
            renderImagePromo(f)+
            '<a class="wep-image-link" '+
              'data-product-link="'+esc(f.key)+'"'+
              (
                first.details && /^https?:\/\//i.test(first.details)
                  ? ' href="'+esc(first.details)+'"'
                  : ''
              )+
              ' target="_blank" rel="noopener noreferrer">'+
              image+
            '</a>'+
          '</div>'+
        '</section>'+

        '<section class="wep-card-buy">'+

          renderFamilyPrices(f)+

          '<div class="wep-config-row">'+
            '<select aria-label="Choose Purchase Option" class="wep-variant" '+
              'data-family="'+esc(f.key)+'">'+
              variantOptions+
            '</select>'+

            '<input aria-label="Quantity" class="wep-main-qty" '+
              'type="number" min="1" max="99" value="1" '+
              'data-main-qty="'+esc(f.key)+'">'+
          '</div>'+

          '<div class="wep-smart-actions'+
            (clean(f.power).toUpperCase()==='BATTERY'
              ? ''
              : ' wep-two-actions')+
          '">'+

            '<a href="product-options.html?sku='+
              encodeURIComponent(first.sku)+
              '&category='+
              encodeURIComponent(f.category)+
              '" data-options="'+esc(f.key)+'">'+
              'View Options'+
            '</a>'+

            (
              clean(f.power).toUpperCase()==='BATTERY'
                ? '<a href="'+esc(first.configure||'#')+'" '+
                  'data-runtime="'+esc(f.key)+'">'+
                  'Run/Charge Times'+
                  '</a>'
                : ''
            )+

            '<button class="wep-add-cart" type="button" '+
              'data-add-cart="'+esc(f.key)+'">'+
              cartIcon+
              '<span>Add to Cart</span>'+
            '</button>'+

          '</div>'+
        '</section>'+

      '</div>'+

      specsHtml+

    '</article>';
  }
  function distinct(arr){
    return Array.from(new Set(arr.filter(Boolean))).sort(function(a,b){return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});});
  }
  function sortPowerTypes(values){
    var rank={ELECTRIC:1,BATTERY:2,GAS:3};
    return values.sort(function(a,b){
      var ra=rank[clean(a).toUpperCase()]||99;
      var rb=rank[clean(b).toUpperCase()]||99;
      return ra-rb || a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
    });
  }
  function renderSmartMarkup(data,category){
    var types=distinct(data.families.map(function(f){return f.subcategory;}));
    if(clean(category).toLowerCase()==='blowers'){
      types=types.filter(function(x){return /\bblower\b/i.test(x);});
      types.sort(function(a,b){
        var rank=function(x){return /handheld/i.test(x)?1:/backpack/i.test(x)?2:3;};
        return rank(a)-rank(b) || a.localeCompare(b);
      });
    }
    if(clean(category).toLowerCase()==='hedge trimmers'){
      types.sort(function(a,b){
        var rank=function(x){return /^hedge trimmer$/i.test(clean(x))?0:1;};
        return rank(a)-rank(b) || a.localeCompare(b);
      });
    }
    var powers=sortPowerTypes(distinct(data.families.map(function(f){return f.power;})));
    var series=distinct(data.families.map(function(f){return f.series;}));
    var seriesRank={AS:1,AK:2,AP:3,AR:4};
    if(['blowers','hedge trimmers'].indexOf(clean(category).toLowerCase())>=0){
      series=['AS','AK','AP','AR'].concat(series.filter(function(x){
        return !seriesRank[clean(x).toUpperCase()];
      }));
    }
    series.sort(function(a,b){
      var ra=seriesRank[clean(a).toUpperCase()]||99;
      var rb=seriesRank[clean(b).toUpperCase()]||99;
      return ra-rb ||
        a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
    });

    var typeButtons=types.map(function(x){
      return '<button type="button" data-filter-type="'+esc(x)+'">'+
        esc(x.replace(/\bBlower\b/i,'').trim()||x)+
      '</button>';
    }).join('');

    var powerButtons=powers.map(function(x){
      return '<button type="button" data-filter-power="'+esc(x)+'">'+
        esc(x)+
      '</button>';
    }).join('');

    var seriesButtons=series.map(function(x){
      return '<button type="button" data-filter-series="'+esc(x)+'">'+
        esc(x)+
      '</button>';
    }).join('');
    return '<section id="wep-smart-catalog" class="wep-smart-catalog">'+
      '<div class="wep-smart-heading"><p>Shop by type, power source, availability or model.</p><h2>'+esc(category)+' &mdash; Filter, Compare &amp; Configure</h2></div>'+
      '<div class="wep-smart-toolbar">'+
        '<div><strong>Type</strong><div class="wep-filter-buttons" id="wep-type-filters">'+typeButtons+'</div></div>'+
        '<div><strong>Power</strong><div class="wep-filter-buttons" id="wep-power-filters">'+powerButtons+'</div></div>'+
        (seriesButtons
          ? '<div><strong>Series</strong><div class="wep-filter-buttons" id="wep-series-filters">'+seriesButtons+'</div></div>'
          : '')+
        '<label class="wep-stock-toggle"><input type="checkbox" id="wep-stock-only"> In Stock / On Order only</label>'+
        '<label class="wep-search-label">Search<input id="wep-smart-search" type="search" placeholder="Model or keyword"></label>'+
      '</div>'+
      '<div class="wep-smart-results"><span id="wep-result-count">'+data.families.length+'</span> product families</div>'+
      '<div class="wep-smart-grid" id="wep-smart-grid">'+data.families.map(function(f){return renderFamilyCard(f,data);}).join('')+'</div>'+
      '<div class="wep-compare-bar" id="wep-compare-bar" hidden><span><strong id="wep-compare-count">0</strong> selected</span><button type="button" id="wep-open-compare">Compare Selected</button><button type="button" id="wep-clear-compare">Clear</button></div>'+
      '<aside class="wep-cart" id="wep-cart"><div class="wep-cart-head"><h2>Cart</h2><span id="wep-cart-count">0 items</span></div><div id="wep-cart-lines"><p class="wep-cart-empty">Your cart is empty.</p></div><div class="wep-cart-footer"><strong id="wep-cart-total">$0.00</strong><p>Use View Options before adding a model when you want batteries, chargers, accessories, attachments or parts included.</p></div></aside>'+
      '<dialog id="wep-compare-dialog"><form method="dialog"><button class="wep-dialog-close" aria-label="Close">&times;</button></form><h2>Compare Selected Models</h2><div id="wep-compare-table"></div></dialog>'+
    '</section>';
  }
  function smartCss(){
    return '<style id="wep-smart-style">'+

    '.wep-product-section,.wep-comparison{display:none!important}'+

    '.wep-smart-catalog{margin:30px 0;font-family:Arial,sans-serif;color:#171717}'+
    '.wep-smart-heading{text-align:center;margin:0 0 18px}'+
    '.wep-smart-heading p{margin:0 0 4px;color:#606974}'+
    '.wep-smart-heading h2{margin:0;font-size:30px}'+

    '.wep-smart-toolbar{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:14px;border:1px solid #d2d6db;border-radius:10px;background:#fafbfc}'+
    '.wep-filter-buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}'+
    '.wep-filter-buttons button,.wep-compare-bar button{border:1px solid #333;border-radius:999px;background:#fff;padding:7px 10px;font-weight:800;cursor:pointer}'+
    '.wep-filter-buttons button.active{background:#202020;color:#fff}'+
    '.wep-stock-toggle{display:flex;align-items:center;gap:7px;font-weight:800;grid-column:1/2}'+
    '.wep-stock-toggle input{width:auto}'+
    '.wep-search-label{grid-column:2/4}.wep-search-label input{display:block;width:100%;margin-top:5px;padding:9px;border:1px solid #bbb;border-radius:7px}'+
    '.wep-smart-results{margin:13px 0;font-weight:800}'+

    '.wep-smart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:stretch}'+

    '.wep-smart-card{display:flex;flex-direction:column;min-width:0;overflow:hidden;border:2px solid #bcc3ca;border-radius:11px;background:linear-gradient(145deg,#ffffff 0%,#fbfcfd 42%,#f1f3f5 100%);box-shadow:0 3px 10px rgba(0,0,0,.09);padding:9px}'+

    '.wep-card-header{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;margin-bottom:8px;padding:7px 9px;border:1px solid #196b34;border-radius:7px;background:#238B45;color:#202428;box-shadow:0 1px 3px rgba(0,0,0,.10)}'+'.wep-model-heading{display:flex;align-items:baseline;gap:7px;min-width:0;margin:0}'+
    '.wep-model-heading strong{font-size:20px;line-height:1;font-weight:900;color:#fff;letter-spacing:.15px;white-space:nowrap;text-shadow:none}'+
    '.wep-model-heading span{font-size:13px;line-height:1;font-weight:700;color:#EEF5F0;white-space:nowrap}'+

    '.wep-compare-pick{display:flex;align-items:center;gap:4px;flex:0 0 auto;margin:0;padding:4px 8px;border:1px solid #e2e5e8;border-radius:999px;background:#fff;color:#252a2e;font-size:10px;font-weight:800;white-space:nowrap}'+
    '.wep-compare-pick input{width:auto;margin:0}'+

    '.wep-card-main{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.25fr);gap:9px;align-items:stretch}'+

    '.wep-card-left{display:flex;min-width:0}'+

    '.wep-smart-media{position:relative;display:flex;align-items:center;justify-content:center;width:100%;min-height:250px;overflow:hidden;border:1px solid #cfd4da;border-radius:7px;background:linear-gradient(180deg,#fff,#f8fafb);box-shadow:0 1px 3px rgba(0,0,0,.04)}'+
    '.wep-image-link{display:flex;width:100%;height:100%;align-items:center;justify-content:center}'+
    '.wep-smart-media img{display:block;width:100%;height:100%;object-fit:contain;padding:46px 5px 5px;box-sizing:border-box}'+
    '.wep-smart-placeholder{font-weight:800;color:#666}'+

    '.wep-promo-ribbon{position:absolute;z-index:5;left:7px;right:7px;top:6px;height:39px;display:flex;align-items:center;justify-content:center;pointer-events:none}'+
    '.wep-ribbon-center{position:relative;z-index:3;min-width:62%;padding:4px 9px 5px;border:2px solid #d6b53a;border-radius:4px;background:linear-gradient(90deg,#990000,#d72128 35%,#c4161d 70%,#8e0000);color:#fff3a3;text-align:center;box-shadow:0 2px 4px rgba(0,0,0,.18)}'+
    '.wep-ribbon-center strong{display:block;font-size:10px;line-height:1;font-weight:900;white-space:nowrap;color:#fff3a3}'+
    '.wep-ribbon-center small{display:block;margin-top:3px;font-size:7px;line-height:1;font-weight:900;white-space:nowrap;color:#fff}'+
    '.wep-ribbon-tail{position:absolute;z-index:1;top:9px;width:24%;height:25px;border:1px solid #d6b53a;background:linear-gradient(90deg,#870000,#c8171f)}'+
    '.wep-ribbon-left{left:0;clip-path:polygon(0 0,100% 15%,78% 100%,0 85%)}'+
    '.wep-ribbon-right{right:0;clip-path:polygon(0 15%,100% 0,100% 85%,22% 100%)}'+

    '.wep-card-buy{display:flex;flex-direction:column;gap:6px;min-width:0;height:100%}'+

    '.wep-price-lines{display:flex;flex-direction:column;gap:6px;margin:0}'+
    '.wep-price-choice{padding:8px 9px;border:1px solid #cfd4da;border-radius:7px;background:linear-gradient(180deg,#fff,#fafbfc);box-shadow:0 1px 3px rgba(0,0,0,.04);text-align:left}'+
    '.wep-price-choice.wep-kit-choice{border-color:#ddb3b9;background:linear-gradient(180deg,#fff,#fff8f8)}'+

    '.wep-price-heading{display:flex;align-items:baseline;justify-content:space-between;gap:7px;width:100%;margin:0;white-space:nowrap}'+
    '.wep-price-label{flex:0 0 auto;font-size:18px;line-height:1;font-weight:900;white-space:nowrap}'+
    '.wep-price-pair{display:flex;align-items:baseline;justify-content:flex-end;gap:5px;flex:0 0 auto;margin:0;white-space:nowrap}'+
    '.wep-price-pair del{font-size:12px;line-height:1;color:#666;white-space:nowrap}'+
    '.wep-price-pair strong{font-size:21px;line-height:1;font-weight:900;color:#c8102e;white-space:nowrap}'+
    '.wep-price-coming-soon{font-size:13px!important;color:#555!important}'+

    '.wep-includes,.wep-package-value{display:block;margin-top:5px;text-align:center;line-height:1.15;white-space:nowrap}'+
    '.wep-includes{font-size:11px;color:#5d6670;font-weight:700}'+
    '.wep-package-value{font-size:10.5px;color:#555;font-weight:800}'+
    '.wep-save{font-size:10.5px!important;color:#287a32!important;font-weight:900!important}'+
    '.wep-package-spacer{visibility:hidden;height:11px}'+

    '.wep-config-row{display:grid;grid-template-columns:minmax(0,1fr) 48px;gap:6px;margin:0}'+
    '.wep-variant,.wep-main-qty{width:100%;height:35px;margin:0;padding:5px 7px;border:1px solid #c4cbd2;border-radius:6px;background:#fff;font-size:10.5px;font-weight:700;box-sizing:border-box}'+
    '.wep-main-qty{text-align:center}'+

    '.wep-smart-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin:0}'+
    '.wep-smart-actions.wep-two-actions{grid-template-columns:1fr}'+
    '.wep-smart-actions a,.wep-smart-actions button{display:flex;align-items:center;justify-content:center;min-height:31px;padding:4px 5px;border:1px solid #25313c;border-radius:6px;background:#fff;color:#202832;text-decoration:none;font-size:9px;line-height:1;font-weight:900;text-align:center;cursor:pointer}'+
    '.wep-smart-actions a{font-size:13px!important;font-weight:800!important}'+

    '.wep-add-cart{grid-column:1/-1;display:flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;min-height:39px!important;background:#c8102e!important;border-color:#c8102e!important;color:#fff!important;font-size:10.5px!important}'+
    '.wep-add-cart svg{width:16px;height:16px;flex:0 0 auto}'+

    '.wep-spec-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:4px 0 0}'+
    '.wep-spec-tile{display:flex;align-items:center;justify-content:center;min-width:0;min-height:50px;padding:5px 7px;border:1px solid #aeb5bc;border-radius:6px;background:#d4d8dc;text-align:center}'+
    '.wep-spec-copy{display:block;width:100%;min-width:0;text-align:center}'+
    '.wep-spec-label{display:block;font-size:11px;line-height:1.1;font-weight:700;color:#5c6670;text-align:center;white-space:normal}'+
    '.wep-spec-copy strong{display:block;margin-top:3px;font-size:14px;line-height:1.05;font-weight:900;color:#202428;text-align:center;white-space:nowrap}'+

    '.wep-compare-bar{position:sticky;bottom:12px;z-index:20;display:flex;align-items:center;gap:9px;margin:18px auto;padding:10px 13px;max-width:620px;border-radius:10px;background:#202020;color:#fff;box-shadow:0 5px 20px rgba(0,0,0,.25)}'+
    '.wep-compare-bar[hidden]{display:none}'+
    '.wep-compare-bar span{margin-right:auto}'+

    '.wep-cart{margin:28px 0;padding:18px;border:2px solid #202020;border-radius:12px;background:#fff}'+
    '.wep-cart-head{display:flex;justify-content:space-between;align-items:center}'+
    '.wep-cart-line{display:grid;grid-template-columns:1fr auto auto;gap:11px;align-items:center;padding:11px 0;border-top:1px solid #ddd}'+
    '.wep-cart-line small{display:block;color:#666}'+
    '.wep-cart-line button{border:0;background:none;text-decoration:underline;cursor:pointer}'+
    '.wep-cart-footer{display:flex;justify-content:space-between;gap:18px;align-items:start;border-top:2px solid #222;padding-top:12px}'+
    '.wep-cart-footer strong{font-size:25px}'+
    '.wep-cart-footer p{max-width:560px;margin:0;color:#555}'+
    '.wep-cart-empty{color:#666}'+

    'dialog#wep-compare-dialog{width:min(1100px,94vw);max-height:90vh;border:0;border-radius:12px;padding:20px;box-shadow:0 14px 50px rgba(0,0,0,.35)}'+
    'dialog#wep-compare-dialog::backdrop{background:rgba(0,0,0,.55)}'+
    '.wep-dialog-close{float:right;border:0;background:none;font-size:30px;cursor:pointer}'+
    '.wep-compare-table-wrap{overflow:auto}'+
    '.wep-compare-table{width:100%;border-collapse:collapse;min-width:700px}'+
    '.wep-compare-table th,.wep-compare-table td{padding:9px;border-bottom:1px solid #ddd;text-align:left}'+
    '.wep-compare-table thead th{background:#202020;color:#fff;position:sticky;top:0}'+

    '.wep-smart-card[hidden]{display:none!important}'+

    '@media(max-width:900px){'+
      '.wep-smart-grid{grid-template-columns:1fr}'+
      '.wep-card-main{grid-template-columns:1fr}'+
      '.wep-smart-media{min-height:280px}'+
      '.wep-model-heading strong{font-size:20px;line-height:1;font-weight:900;color:#fff;letter-spacing:.15px;white-space:nowrap;text-shadow:none}'+
      '.wep-model-heading span{font-size:13px;line-height:1;font-weight:700;color:#EEF5F0;white-space:nowrap}'+
      '.wep-spec-strip{grid-template-columns:repeat(2,minmax(0,1fr))}'+
      '.wep-price-label{font-size:19px}'+
      '.wep-price-pair strong{font-size:22px}'+
    '}'+

    '@media(max-width:520px){'+
      '.wep-smart-toolbar{grid-template-columns:1fr}.wep-stock-toggle,.wep-search-label{grid-column:1}'+
      '.wep-card-header{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;margin-bottom:8px;padding:7px 9px;border:1px solid #196b34;border-radius:7px;background:#238B45;color:#202428;box-shadow:0 1px 3px rgba(0,0,0,.10)}'+'.wep-model-heading{display:block}'+
      '.wep-model-heading span{font-size:13px;line-height:1;font-weight:700;color:#EEF5F0;white-space:nowrap}'+
      '.wep-smart-media{min-height:240px}'+
      '.wep-spec-tile{gap:6px}'+
      '.wep-spec-label{font-size:10px}'+
      '.wep-spec-copy strong{font-size:13px}'+
      '.wep-cart-line{grid-template-columns:1fr auto}'+
      '.wep-cart-footer{display:block}'+
    '}'+

        '.wep-variant,.wep-main-qty{height:36px!important;font-size:13px!important;font-weight:800!important}'+
    '.wep-smart-actions a,.wep-smart-actions button{min-height:36px!important;font-size:13px!important;font-weight:800!important;padding:5px 7px!important}'+
    '.wep-add-cart{min-height:36px!important;font-size:13px!important;font-weight:800!important}'+'</style>';
  }
  function runtimeScript(data){
    var safe=JSON.stringify(data).replace(/</g,'\\u003c');
    return '<script>(function(){'+
      'var DATA='+safe+';var families=DATA.families||[];var byKey={};families.forEach(function(f){byKey[f.key]=f;});var cart=[];var compare=[];var type="";var power="";var series="";'+
      'function q(s,r){return (r||document).querySelector(s)}function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}function m(v){return "$"+Number(v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}function esc(v){var d=document.createElement("div");d.textContent=String(v==null?"":v);return d.innerHTML}'+
      'function selectedVariant(key){var f=byKey[key],sel=q(".wep-variant[data-family=\\\""+CSS.escape(key)+"\\\"]");if(!f||!sel||sel.value==="")return null;return f.variants[Number(sel.value)]||null}'+      'function compatible(list,sys){sys=String(sys||"").toUpperCase();return (list||[]).filter(function(x){return String(x.system||"").toUpperCase().split(/[|,;/]+/).map(function(y){return y.trim()}).indexOf(sys)>=0})}'+
      'function drawOptions(key){var v=selectedVariant(key),zone=q(".wep-smart-battery-zone[data-family=\\\""+CSS.escape(key)+"\\\"]");if(!v||!zone)return;if(v.isKit){zone.innerHTML=v.kitIncludes?"<div class=\\\"wep-kit-includes\\\"><strong>Factory kit includes:</strong> "+esc(v.kitIncludes)+"</div>":"";reTotal(key);return;}var bats=compatible(DATA.batteries,v.system),chs=compatible(DATA.chargers,v.system);if(!bats.length&&!chs.length){zone.innerHTML="";reTotal(key);return;}zone.innerHTML="<div class=\\\"wep-smart-option-row\\\">"+(bats.length?"<label>Battery<select data-battery=\\\""+esc(key)+"\\\"><option value=\\\"\\\">No added battery</option>"+bats.map(function(x){return "<option value=\\\""+esc(x.sku)+"\\\">"+esc(x.label)+" &mdash; "+m(x.price)+"</option>"}).join("")+"</select></label>":"")+(chs.length?"<label>Charger<select data-charger=\\\""+esc(key)+"\\\"><option value=\\\"\\\">No added charger</option>"+chs.map(function(x){return "<option value=\\\""+esc(x.sku)+"\\\">"+esc(x.label)+" &mdash; "+m(x.price)+"</option>"}).join("")+"</select></label>":"")+"</div>";qa("select",zone).forEach(function(s){s.addEventListener("change",function(){reTotal(key)})});reTotal(key)}'+
      'function findOpt(list,sku){return (list||[]).find(function(x){return x.sku===sku})||null}function selectedExtras(key){var b=q("[data-battery=\\\""+CSS.escape(key)+"\\\"]"),c=q("[data-charger=\\\""+CSS.escape(key)+"\\\"]");return {battery:b?findOpt(DATA.batteries,b.value):null,charger:c?findOpt(DATA.chargers,c.value):null}}'+
      'function reTotal(key){var v=selectedVariant(key);if(!v)return;var cat=encodeURIComponent((byKey[key]&&byKey[key].category)||"Equipment"),ret=encodeURIComponent(location.href);var o=q("[data-options=\\\""+CSS.escape(key)+"\\\"]");if(o)o.href="product-options.html?sku="+encodeURIComponent(v.sku)+"&category="+cat+"&return="+ret;var r=q("[data-runtime=\\\""+CSS.escape(key)+"\\\"]");if(r)r.href=v.configure||"#";var link=q("[data-product-link=\\\""+CSS.escape(key)+"\\\"]");if(link){var url=String(v.details||"");if(/^https?:\\/\\//i.test(url))link.href=url;else link.removeAttribute("href")}}'+
      'function filters(){var search=(q("#wep-smart-search")||{}).value||"";search=search.toUpperCase();var only=!!(q("#wep-stock-only")||{}).checked;var visible=0;qa(".wep-smart-card").forEach(function(card){var f=byKey[card.dataset.family];var ok=(!type||f.subcategory===type)&&(!power||f.power===power)&&(!series||f.series===series)&&(!only||f.stock>0||f.order>0)&&(!search||(f.name+" "+f.subcategory+" "+f.power+" "+f.series).toUpperCase().indexOf(search)>=0);card.hidden=!ok;if(ok)visible++;});var n=q("#wep-result-count");if(n)n.textContent=visible}'+
      'function drawCart(){var lines=q("#wep-cart-lines"),count=q("#wep-cart-count"),total=q("#wep-cart-total");if(!lines)return;if(!cart.length){lines.innerHTML="<p class=\\\"wep-cart-empty\\\">Your cart is empty.</p>"}else{lines.innerHTML=cart.map(function(x,i){return "<div class=\\\"wep-cart-line\\\"><div><strong>"+esc(x.name)+" &mdash; "+esc(x.variant.label)+"</strong><small>Qty "+(x.qty||1)+(x.variant.packageIncludes?" &middot; Includes "+esc(x.variant.packageIncludes):"")+"</small></div><strong>"+m(x.total)+"</strong><div><button type=\\\"button\\\" data-remove-cart=\\\""+i+"\\\">Remove</button></div></div>"}).join("")}var itemCount=cart.reduce(function(s,x){return s+(Number(x.qty)||0)},0);if(count)count.textContent=itemCount+" item"+(itemCount===1?"":"s");if(total)total.textContent=m(cart.reduce(function(s,x){return s+x.total},0));qa("[data-remove-cart]").forEach(function(b){b.onclick=function(){cart.splice(Number(b.dataset.removeCart),1);drawCart()}})}'+      'function addCart(key){var f=byKey[key],sel=q(".wep-variant[data-family=\\\""+CSS.escape(key)+"\\\"]"),v=selectedVariant(key);if(!f||!sel)return;if(!v){alert("Choose a purchase option before adding this item to the cart.");return}var qel=q("[data-main-qty=\\\""+CSS.escape(key)+"\\\"]"),qty=Math.max(1,Number(qel&&qel.value)||1),unit=Number(v.price||0);if(!(unit>0)){alert("Pricing Coming Soon for this purchase option.");return}var lineKey=String(key)+"|"+String(v.sku||"")+"|"+String(v.label||"");var existing=cart.find(function(x){return x.lineKey===lineKey});if(existing){existing.qty+=qty;existing.total=existing.unit*existing.qty}else{cart.push({lineKey:lineKey,name:f.name,variant:v,battery:null,charger:null,qty:qty,unit:unit,total:unit*qty})}drawCart();sel.value="";if(qel)qel.value=1;q("#wep-cart").scrollIntoView({behavior:"smooth",block:"start"})}'+      'function drawCompare(){var selected=compare.map(function(k){return byKey[k]}).filter(Boolean);var labels=[];selected.forEach(function(f){Object.keys(f.specs||{}).forEach(function(k){if(labels.indexOf(k)<0)labels.push(k)})});var html="<div class=\\\"wep-compare-table-wrap\\\"><table class=\\\"wep-compare-table\\\"><thead><tr><th>Feature</th>"+selected.map(function(f){return "<th>"+esc(f.name)+"</th>"}).join("")+"</tr></thead><tbody><tr><th>Starting Price</th>"+selected.map(function(f){return "<td>"+(Number(f.minPrice||0)>0?m(f.minPrice):"Pricing Coming Soon")+"</td>"}).join("")+"</tr><tr><th>Power</th>"+selected.map(function(f){return "<td>"+esc(f.power)+"</td>"}).join("")+"</tr><tr><th>Type</th>"+selected.map(function(f){return "<td>"+esc(f.subcategory)+"</td>"}).join("")+"</tr><tr><th>Availability</th>"+selected.map(function(f){return "<td>"+(f.stock>0?"In Stock: "+f.stock:(f.order>0?"On Order: "+f.order:"Available to Order"))+"</td>"}).join("")+"</tr>"+labels.map(function(l){return "<tr><th>"+esc(l)+"</th>"+selected.map(function(f){return "<td>"+esc((f.specs||{})[l]||"&mdash;")+"</td>"}).join("")+"</tr>"}).join("")+"</tbody></table></div>";q("#wep-compare-table").innerHTML=html}'+
      'function syncCompare(){var bar=q("#wep-compare-bar"),cnt=q("#wep-compare-count");if(cnt)cnt.textContent=compare.length;if(bar)bar.hidden=!compare.length;qa("[data-compare]").forEach(function(c){c.checked=compare.indexOf(c.dataset.compare)>=0})}'+
      'qa("[data-filter-type]").forEach(function(b){b.onclick=function(){var value=b.dataset.filterType||"";type=type===value?"":value;qa("[data-filter-type]").forEach(function(x){x.classList.toggle("active",type!==""&&x.dataset.filterType===type)});filters()}});qa("[data-filter-power]").forEach(function(b){b.onclick=function(){var value=b.dataset.filterPower||"";power=power===value?"":value;qa("[data-filter-power]").forEach(function(x){x.classList.toggle("active",power!==""&&x.dataset.filterPower===power)});filters()}});qa("[data-filter-series]").forEach(function(b){b.onclick=function(){var value=b.dataset.filterSeries||"";series=series===value?"":value;qa("[data-filter-series]").forEach(function(x){x.classList.toggle("active",series!==""&&x.dataset.filterSeries===series)});filters()}});'+
      'q("#wep-smart-search").addEventListener("input",filters);q("#wep-stock-only").addEventListener("change",filters);'+
      'qa(".wep-variant").forEach(function(s){s.addEventListener("change",function(){reTotal(s.dataset.family)});reTotal(s.dataset.family)});'+
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
    var pageType=clean(document.getElementById('stihl-webpage-page-type') && document.getElementById('stihl-webpage-page-type').value);
    var category=pageType==='series' && typeof window.webpagePageLabel==='function'
      ? clean(window.webpagePageLabel())
      : clean(document.getElementById('stihl-webpage-category') && document.getElementById('stihl-webpage-category').value) || 'Equipment';
    var products=window.webpageProducts().filter(function(item){
      return pageType==='series' || clean(item.Category).toLowerCase()===category.toLowerCase();
    });
    if(!products || !products.length) return;
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
    var selected=clean(category);
    var batterySeries=selected.match(/^(AS|AK|AP|AR) Battery System$/i);
    var scoped=(products||[]).filter(function(item){
      return batterySeries
        ? clean(item.System).toUpperCase()===batterySeries[1].toUpperCase()
        : !selected || clean(item.Category).toLowerCase()===selected.toLowerCase();
    });
    var data=pageData(scoped);
    if(!data.families.length) return '';
    return smartCss()+renderSmartMarkup(data,clean(category)||'Equipment')+runtimeScript(data);
  };
  api.enhanceGeneratedPage=enhanceGeneratedPage;
  api.install=wire;

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire);
  else wire();
})();
