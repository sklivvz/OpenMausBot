import type { BoltBindings } from "./contracts.ts";

export const RECORDED_BINDINGS: BoltBindings = {
  version: 1,
  evidence: "Recorded Bolt DOM controls, 16/23 October 2026. Structured options, comments and checkout require further captured mappings.",
  root: { kind: "object", fields: {
    search: { kind: "text", selector: '[data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input"]', attribute: "value", optional: true },
    controls: { kind: "object", fields: {
      search: { kind: "control", selector: '[data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input"]', optional: true },
      openBasket: { kind: "control", selector: '[data-testid="components.MainNavigationMenu.viewBasketButton"], [data-testid="screens.Groceries.GroceriesScreen.activeBasketButton"], [data-testid="screens.Provider.Menu.ProviderMenuStickySearch.viewBasket"]', optional: true },
      closeProduct: { kind: "control", selector: '[data-testid="screens.Provider.Dish.DishBottomSheet.closeButton"]', optional: true },
      pay: { kind: "control", selector: '[data-testid="screens.OnePageCheckout.confirmSimpleButton"]', optional: true },
    } },
  } },
};

export function inspectionScript(bindings: BoltBindings): string {
  return `(()=>{
    const profile=${JSON.stringify(bindings)};
    const targets={}; let visited=0;
    const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
    const cssPath=e=>{const parts=[];for(let n=e;n&&n.nodeType===1;n=n.parentElement){let index=1;for(let p=n.previousElementSibling;p;p=p.previousElementSibling)index++;parts.unshift(n.tagName.toLowerCase()+':nth-child('+index+')');}return parts.join(' > ')};
    const fail=code=>{throw Error(code)};
    const read=(spec,parent,key)=>{
      if(++visited>3000)fail('dom_limit');
      let elements=spec.selector?[...parent.querySelectorAll(spec.selector)].filter(visible):[parent];
      if(spec.kind==='list'){
        if(elements.length>100)fail('dom_list_limit');
        if(!spec.item)fail('binding_invalid');
        return elements.map((e,i)=>read(spec.item,e,key+'.'+i));
      }
      if(elements.length===0&&spec.optional)return undefined;
      if(elements.length!==1)fail(elements.length?'ambiguous_control':'control_missing');
      const e=elements[0];
      if(spec.kind==='object'){
        const out=key&&key!=='controls'?{ref:key}:{};for(const [name,child] of Object.entries(spec.fields||{})){const value=read(child,e,key?key+'.'+name:name);if(value!==undefined)out[name]=value;}return out;
      }
      if(spec.kind==='control'){
        targets[key]={selector:cssPath(e),enabled:!e.disabled&&e.getAttribute('aria-disabled')!=='true',signature:[e.tagName,e.getAttribute('data-testid'),e.getAttribute('aria-label'),e.innerText||e.textContent||''].join('|').slice(0,4000)};return key;
      }
      let value=spec.attribute==='value'?e.value:spec.attribute==='checked'?(e.checked===true||e.getAttribute('aria-checked')==='true'):spec.attribute?e.getAttribute(spec.attribute):(e.innerText||e.textContent||'').trim();
      if(value===null||value===undefined)fail('field_missing');
      if(spec.kind==='boolean'){if(value===true||value==='true')return true;if(value===false||value==='false')return false;fail('boolean_unknown')}
      if(typeof value!=='string'||value.length>4000)fail('field_invalid');
      if(spec.kind==='number'){if(!/^-?\\d+$/.test(value.trim()))fail('number_unknown');return Number(value)}
      if(spec.kind==='money'){
        const v=value.replace(/[€\\s\\u00a0]/g,'').replace('−','-');
        const m=/^(-?)(\\d+)(?:[,.](\\d{1,2}))?$/.exec(v);if(!m)fail('money_unknown');
        const cents=(Number(m[2])*100+Number((m[3]||'').padEnd(2,'0')))*(m[1]?-1:1);if(!Number.isSafeInteger(cents))fail('money_unknown');return cents;
      }
      return value;
    };
    try{return {url:location.href,view:read(profile.root,document,''),targets}}catch(e){return {url:location.href,error:String(e.message)}}
  })()`;
}
