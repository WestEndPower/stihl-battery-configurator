(function(){
  "use strict";
  var DATA=window.WestEndCatalogData;
  if(!DATA || !Array.isArray(DATA.families)) return;
  var KEY="westend-stihl-paid-cart-v1";
  var API="https://westendpower-configurator-api.westendpower-nm.workers.dev";
  var STRIPE="https://westendpower-stripe-checkout.westendpower-nm.workers.dev";
  var TERMS="All purchases are final. Please contact West End Power Equipment prior to ordering if you are unsure whether the item(s) selected are correct for or compatible with your application. I have read and understand these terms and have verified that the item(s) selected are correct for my application, or I have contacted West End Power Equipment to confirm fitment or compatibility.";
  function yes(v){return /^(T|TRUE|Y|YES|1)$/i.test(String(v||"").trim());}
  function qty(v){var n=Number(v);return Number.isInteger(n)&&n>0&&n<=10?n:0;}
  function money(v){return Number(v||0).toLocaleString("en-US",{style:"currency",currency:"USD"});}
  var products=new Map();
  DATA.families.forEach(function(f){
    (f.items||[]).forEach(function(p){products.set(String(p.SKU||"").trim().toUpperCase(),p);});
  });
  function read(){
    try{
      var raw=JSON.parse(localStorage.getItem(KEY)||"[]");
      return Array.isArray(raw)?raw.filter(function(x){
        return x&&typeof x.sku==="string"&&qty(x.quantity);
      }).slice(0,20):[];
    }catch(e){return [];}
  }
  function write(lines){
    try{localStorage.setItem(KEY,JSON.stringify(lines));return true;}
    catch(e){showStatus("Unable to save the cart in this browser.");return false;}
  }
  function eligible(p){
    return !!p&&yes(p.BuyOnlineEligible)&&
      (!String(p.Active||"").trim()||yes(p.Active))&&
      (Number(p.QtyDanbury||0)+Number(p.QtyNewMilford||0)>0);
  }
  function variantProduct(card){
    var f=(DATA.families||[]).find(function(x){return x.key===card.dataset.family;});
    var select=card.querySelector(".wep-variant");
    if(!f||!select||select.value==="")return null;
    var variant=f.variants[Number(select.value)];
    if(!variant||variant.isRecommendedPackage)return null;
    return products.get(String(variant.sku||"").trim().toUpperCase())||null;
  }
  var style=document.createElement("style");
  style.textContent=".wep-paid-nav{position:sticky;top:0;z-index:25;display:flex;justify-content:flex-end;gap:12px;align-items:center;padding:10px;background:#fff;border-bottom:2px solid #c8102e}.wep-paid-nav button,.wep-buy-approved,.wep-paid-checkout{border:0;border-radius:6px;background:#c8102e;color:white;padding:12px 15px;font-weight:800;cursor:pointer}.wep-buy-approved{width:100%;margin-top:6px}.wep-paid-nav button:disabled,.wep-paid-checkout:disabled{background:#888}.wep-paid-overlay{position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:14px}.wep-paid-panel{width:min(720px,100%);margin:auto;background:white;border-radius:10px;padding:20px;box-sizing:border-box;font:16px/1.45 Arial,sans-serif;color:#222}.wep-paid-panel h2{margin:0 0 12px}.wep-paid-panel button{cursor:pointer}.wep-paid-line{display:grid;grid-template-columns:minmax(0,1fr) 80px 95px auto;gap:9px;align-items:center;border-top:1px solid #ddd;padding:12px 0}.wep-paid-line input,.wep-paid-panel input,.wep-paid-panel select{min-height:36px;box-sizing:border-box;padding:6px;width:100%}.wep-paid-line button{border:0;background:none;text-decoration:underline}.wep-paid-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wep-paid-fields label{font-weight:700}.wep-paid-fields label span{display:block}.wep-paid-total{font-size:20px;text-align:right;border-top:2px solid #222;padding:10px}.wep-paid-close{float:right;border:0;background:transparent;font-size:26px}.wep-paid-help{color:#555;font-size:14px}.wep-paid-error{color:#aa1028;font-weight:bold;min-height:22px}.wep-paid-checkout{width:100%;margin-top:15px;font-size:17px}@media(max-width:560px){.wep-paid-fields{grid-template-columns:1fr}.wep-paid-line{grid-template-columns:1fr 70px}.wep-paid-line small{grid-column:1/-1}}";
  document.head.appendChild(style);
  document.querySelectorAll(".wep-add-cart,.wep-cart").forEach(function(node){
    node.hidden=true;node.style.display="none";
  });
  var page=document.querySelector(".wep-page")||document.body;
  var bar=document.createElement("div");bar.className="wep-paid-nav";
  var note=document.createElement("span");note.className="wep-paid-help";
  note.textContent="Online payment for approved in-stock items";
  var view=document.createElement("button");view.type="button";
  view.addEventListener("click",openCart);
  bar.append(note,view);page.insertBefore(bar,page.firstChild);
  var overlay=document.createElement("div");overlay.className="wep-paid-overlay";
  overlay.hidden=true;overlay.style.display="none";
  var panel=document.createElement("section");panel.className="wep-paid-panel";
  panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");
  panel.setAttribute("aria-label","STIHL cart");
  overlay.appendChild(panel);document.body.appendChild(overlay);
  overlay.addEventListener("click",function(e){if(e.target===overlay)closeCart();});
  function showStatus(message){note.textContent=message;}
  function cartLines(){
    return read().map(function(line){
      return {line:line,product:products.get(line.sku.toUpperCase())||null};
    });
  }
  function updateCount(){
    var count=read().reduce(function(n,x){return n+x.quantity;},0);
    view.textContent="View Cart ("+count+")";
  }
  function add(sku){
    var p=products.get(String(sku).toUpperCase());
    if(!eligible(p))return showStatus("This item is not approved or is out of stock.");
    var lines=read(),existing=lines.find(function(x){return x.sku.toUpperCase()===sku.toUpperCase();});
    if(existing){if(existing.quantity>=10)return showStatus("Maximum quantity is 10.");existing.quantity++;}
    else{if(lines.length>=20)return showStatus("Maximum cart size is 20 products.");lines.push({sku:sku,quantity:1});}
    if(write(lines)){updateCount();showStatus("Added to cart: "+(p.Model||p.Description||sku));}
  }
  document.querySelectorAll(".wep-smart-card").forEach(function(card){
    var actions=card.querySelector(".wep-smart-actions")||card.querySelector(".wep-card-buy");
    if(!actions)return;
    var button=document.createElement("button");button.type="button";
    button.className="wep-buy-approved";
    button.textContent="Add to Cart";
    actions.appendChild(button);
    function refresh(){
      var p=variantProduct(card);
      button.hidden=!eligible(p);
      button.style.display=eligible(p)?"block":"none";
    }
    card.querySelector(".wep-variant")?.addEventListener("change",refresh);
    button.addEventListener("click",function(){var p=variantProduct(card);if(p)add(p.SKU);});
    refresh();
  });
  function el(name,textValue){var e=document.createElement(name);if(textValue!=null)e.textContent=textValue;return e;}
  function closeCart(){overlay.hidden=true;overlay.style.display="none";}
  function openCart(){
    overlay.hidden=false;overlay.style.display="flex";render();
  }
  function render(){
    panel.replaceChildren();
    var close=el("button","×");close.type="button";close.className="wep-paid-close";
    close.setAttribute("aria-label","Close cart");close.onclick=closeCart;panel.appendChild(close);
    panel.appendChild(el("h2","STIHL Cart"));
    var lines=cartLines(),sum=0;
    if(!lines.length)panel.appendChild(el("p","Your cart is empty. Choose an approved item to add it."));
    lines.forEach(function(entry){
      var line=entry.line,p=entry.product;
      var row=el("div");row.className="wep-paid-line";
      row.appendChild(el("strong",p?(p.Model||p.Description||line.sku):line.sku));
      var input=el("input");input.type="number";input.min="1";input.max="10";
      input.value=line.quantity;input.setAttribute("aria-label","Quantity for "+line.sku);
      input.onchange=function(){
        var count=qty(input.value);if(!count){render();return;}
        var all=read();var found=all.find(function(x){return x.sku===line.sku;});
        if(found){found.quantity=count;write(all);updateCount();render();}
      };
      row.appendChild(input);
      var price=p?Number(p.SalePrice||p.MSRP||0):0;
      row.appendChild(el("span",money(price*line.quantity)));
      var remove=el("button","Remove");remove.type="button";
      remove.onclick=function(){write(read().filter(function(x){return x.sku!==line.sku;}));updateCount();render();};
      row.appendChild(remove);row.appendChild(el("small","SKU: "+line.sku));
      panel.appendChild(row);sum+=price*line.quantity;
    });
    if(!lines.length)return;
    var total=el("div","Estimated items: "+money(sum));total.className="wep-paid-total";
    panel.appendChild(total);
    panel.appendChild(el("p","Final prices, stock and shipping are checked before payment. Sales tax is calculated in Stripe Checkout."));
    var form=el("form");form.noValidate=true;
    var fields=el("div");fields.className="wep-paid-fields";
    [
      ["firstName","First name"],["lastName","Last name"],
      ["address1","Street address"],["address2","Address line 2"],
      ["city","City"],["state","State (2 letters)"],
      ["zip","ZIP (5 digits)"],["phone","Phone"],["email","Email"]
    ].forEach(function(pair){
      var label=el("label");label.appendChild(el("span",pair[1]));
      var input=el("input");input.name=pair[0];input.autocomplete=pair[0];
      if(pair[0]==="email")input.type="email";
      if(pair[0]==="address2")input.required=false;else input.required=true;
      label.appendChild(input);fields.appendChild(label);
    });
    form.appendChild(fields);
    var selectLabel=el("label");selectLabel.appendChild(el("span","Fulfillment"));
    var fulfillment=el("select");fulfillment.name="fulfillment";
    [
      ["PICKUP_NEW_MILFORD","Pickup: New Milford"],
      ["PICKUP_DANBURY","Pickup: Danbury"]
    ].forEach(function(pair){var option=el("option",pair[1]);option.value=pair[0];fulfillment.appendChild(option);});
    var shippable=lines.every(function(entry){
      return entry.product&&yes(entry.product.ShippingEligible);
    });
    if(shippable){var ship=el("option","UPS Ground shipping (rate confirmed before payment)");
      ship.value="SHIP";fulfillment.appendChild(ship);}
    selectLabel.appendChild(fulfillment);form.appendChild(selectLabel);
    var termsLabel=el("label");var accepted=el("input");accepted.type="checkbox";
    accepted.required=true;accepted.style.width="auto";termsLabel.appendChild(accepted);
    termsLabel.appendChild(document.createTextNode(" I agree: "+TERMS));
    form.appendChild(termsLabel);
    var error=el("p");error.className="wep-paid-error";form.appendChild(error);
    var submit=el("button","Continue to Secure Payment");
    submit.type="submit";submit.className="wep-paid-checkout";
    form.appendChild(submit);panel.appendChild(form);
    form.onsubmit=async function(event){
      event.preventDefault();
      error.textContent="";
      if(!form.reportValidity())return;
      if(!accepted.checked){error.textContent="Accept the final-sale and fitment terms.";return;}
      var customer={};new FormData(form).forEach(function(value,key){
        if(key!=="fulfillment")customer[key]=String(value).trim();
      });
      var checkoutWindow=window.open("","_blank");
      if(!checkoutWindow){error.textContent="Allow pop-ups so secure checkout can open.";return;}
      checkoutWindow.document.title="Preparing secure checkout";
      checkoutWindow.document.body.textContent="Preparing secure checkout…";
      submit.disabled=true;submit.textContent="Verifying order…";
      try{
        var response=await fetch(API+"/online-cart-order",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({customer:customer,fulfillment:fulfillment.value,
            items:read(),termsAccepted:true})
        });
        var order=await response.json();
        if(!response.ok)throw Error(order.error||"Order verification failed.");
        var checkoutResponse=await fetch(STRIPE+"/online-order-checkout",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({orderNumber:order.orderNumber,checkoutToken:order.checkoutToken})
        });
        var checkout=await checkoutResponse.json();
        if(!checkoutResponse.ok||!/^https:\/\/checkout\.stripe\.com\//.test(checkout.checkoutUrl||""))
          throw Error(checkout.error||"Secure checkout is unavailable.");
        checkoutWindow.location.href=checkout.checkoutUrl;
      }catch(cause){
        checkoutWindow.close();error.textContent=cause.message||"Could not open checkout.";
        submit.disabled=false;submit.textContent="Continue to Secure Payment";
      }
    };
  }
  updateCount();
  if(new URLSearchParams(location.search).get("payment")==="cancelled"){
    showStatus("Payment cancelled. Your cart is saved.");openCart();
  }
})();
