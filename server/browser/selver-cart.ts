export const SELVER_CART_SNAPSHOT = `(async()=>{
  if(location.origin!=='https://www.selver.ee')throw Error('Open the Selver storefront first');
  const store=document.querySelector('#app')?.__vue__?.$store;
  const authenticated=()=>store?.getters['user/isLoggedIn']===true&&!!store.getters['user/getUserToken']&&store.getters['cart/isCartConnected']===true;
  if(!authenticated())throw Error('Selver account is not authenticated and connected');
  const account=document.body.innerText.match(/Tere,\\s*([^!]+)!/)?.[1]?.trim();
  if(!account)throw Error('Signed-in Selver account label is unavailable');
  const cartId=store.getters['cart/getCartToken'];
  if(!cartId)throw Error('Selver cart token is unavailable');
  const userToken=store.getters['user/getUserToken'];
  const get=async path=>{
    const url=new URL(path,location.origin);
    url.searchParams.set('token',userToken);
    if(path.startsWith('/api/cart/'))url.searchParams.set('cartId',cartId);
    const response=await fetch(url,{credentials:'include',cache:'no-store'});
    if(!response.ok)throw Error('Selver cart read failed');
    const body=await response.json();
    if(body.code!==200)throw Error('Selver cart read was rejected');
    return body.result;
  };
  const identity=await get('/api/user/me');
  if([identity?.firstname,identity?.lastname].filter(Boolean).join(' ').trim()!==account)throw Error('Selver backend account differs from displayed account');
  const getCart=async path=>{
    const current=await get('/api/user/me');
    if([current?.firstname,current?.lastname].filter(Boolean).join(' ').trim()!==account)throw Error('Selver account changed before cart request');
    return get(path);
  };
  const first=await getCart('/api/cart/pull');
  const second=await getCart('/api/cart/pull');
  const totals=await getCart('/api/cart/totals');
  if(!Array.isArray(first)||!Array.isArray(second)||!Array.isArray(totals?.items)||!Number.isFinite(Number(totals.grand_total)))throw Error('Selver cart response is incomplete');
  const quantities=items=>JSON.stringify(items.map(p=>[p.sku,Number(p.qty)]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(quantities(first)!==quantities(second))throw Error('Persisted Selver cart changed during verification');
  if(quantities(second)!==quantities(store.state.cart.cartItems))throw Error('Displayed Selver cart differs from persisted cart');
  if(!authenticated()||store.getters['user/getUserToken']!==userToken||store.getters['cart/getCartToken']!==cartId)throw Error('Selver account or cart changed during verification');
  const visibleAccount=document.body.innerText.match(/Tere,\\s*([^!]+)!/)?.[1]?.trim();
  if(visibleAccount!==account)throw Error('Selver account label changed during verification');
  const cart=second.map(item=>{
    const price=Number(totals.items.find(line=>String(line.item_id)===String(item.item_id))?.price_incl_tax);
    if(!item.sku||!(Number(item.qty)>0)||!Number.isFinite(price))throw Error('Persisted Selver cart line is incomplete');
    return{sku:item.sku,quantity:Number(item.qty),unitPriceEur:price};
  });
  return{signedInAs:account,observedAt:new Date().toISOString(),totalEur:Number(totals.grand_total),cart};
})()`;

export const SELVER_CART_TOOL = {
  name: "agent_browser_selver_cart",
  description: "Read the authenticated Selver account, persisted cart lines and total in this browser. Refuses a guest session, account mismatch, or a cart that differs from the page.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
} as const;

export const SELVER_SESSION_CAPTURE = `(async()=>{
  if(location.origin==='https://sso.partnerkaart.ee')return{state:document.body.innerText.includes('Katkesta')?'mobileApprovalPending':'signInForm'};
  if(location.origin!=='https://www.selver.ee')return{state:'wrongSite'};
  if(document.body.innerText.includes('Palun kinnita oma andmed!'))return{state:'contactConfirmationRequired'};
  const store=document.querySelector('#app')?.__vue__?.$store;
  const token=store?.getters['user/getUserToken'];
  if(store?.getters['user/isLoggedIn']!==true||typeof token!=='string'||!token)return{state:'signedOut'};
  const url=new URL('/api/user/me',location.origin);
  url.searchParams.set('token',token);
  const response=await fetch(url,{credentials:'include',cache:'no-store'});
  if(!response.ok)return{state:'backendRejected'};
  const body=await response.json();
  if(body.code!==200)return{state:'backendRejected'};
  const account=[body.result?.firstname,body.result?.lastname].filter(Boolean).join(' ').trim();
  if(!account||store.getters['user/isLoggedIn']!==true||store.getters['user/getUserToken']!==token)return{state:'backendRejected'};
  return{state:'authenticated',token,account};
})()`;

export const SELVER_CONNECT_TOOL = {
  name: "agent_browser_selver_connect",
  description: "Check whether this Selver browser is signed in. Verify the account with Selver and provision a private cart session. Returns the account and session file path, never the token. If signed out, complete the Smart-ID form with the user's supplied personal number, submit it, wait for mobile approval, then reconnect.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
} as const;
