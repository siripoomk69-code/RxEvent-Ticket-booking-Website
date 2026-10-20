// Netlify-backed replacement for the `claude.use('db')` / `claude.use('assets')` storage API.
// Data lives in Netlify Database (via /api/db), images in Netlify Blobs (via /api/assets).
// v2: adaptive polling (backs off when nothing changes / user is idle / tab hidden),
//     per-listener intervals, and writes only refresh the listeners they affect./
(function(){
  if(window.claude&&typeof window.claude.use==='function')return;
  const DEFAULT_BASE_MS=5000;      // fastest poll for a listener that keeps seeing changes
  const DEFAULT_MAX_MS=30000;      // slowest poll when nothing changes
  const IDLE_AFTER_MS=5*60*1000;   // no user input for this long => treat tab as idle
  const IDLE_POLL_MS=60000;        // idle tabs poll at most once a minute
  const listeners=new Set();
  let lastActive=Date.now();
  ['pointerdown','keydown','touchstart','scroll'].forEach(ev=>
    window.addEventListener(ev,()=>{lastActive=Date.now()},{passive:true,capture:true}));

  async function call(body){
    const r=await fetch('/api/db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const out=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(out.error||('Request failed: '+r.status));
    return out;
  }
  const docSnap=(id,exists,data)=>({id,exists,data:()=>data});
  const colSnap=docs=>({docs:docs.map(d=>docSnap(d.id,true,d.data)),size:docs.length,empty:!docs.length});

  // A write only refreshes listeners that watch what it touched (not all of them).
  function refresh(key){listeners.forEach(l=>{if(l.key===key||l.key===key.split('/')[0])l.poll(true)})}
  async function write(body){
    const out=await call(body);
    refresh('col:'+body.collection);refresh('doc:'+body.collection+'/'+body.id);
    return out;
  }

  function listen(key,fetcher,cb,onErr,opts){
    const base=(opts&&opts.base)||DEFAULT_BASE_MS,max=(opts&&opts.max)||DEFAULT_MAX_MS;
    let last=null,stopped=false,busy=false,timer=null,streak=0;
    const nextDelay=()=>{
      let d=Math.min(base*Math.pow(1.5,streak),max);
      if(Date.now()-lastActive>IDLE_AFTER_MS)d=Math.max(d,IDLE_POLL_MS);
      return d;
    };
    const schedule=()=>{if(stopped)return;clearTimeout(timer);timer=setTimeout(()=>l.poll(),nextDelay())};
    const l={key,poll:async(force)=>{
      if(stopped||busy)return;
      if(document.hidden&&!force){schedule();return}   // never poll in background tabs
      busy=true;
      try{
        const snap=await fetcher();
        const k=JSON.stringify(snap.raw);
        if(k!==last){last=k;streak=0;cb(snap.value)}else streak++;
      }catch(e){streak++;onErr&&onErr(e)}
      finally{busy=false;schedule()}
    }};
    listeners.add(l);l.poll(true);
    return ()=>{stopped=true;clearTimeout(timer);listeners.delete(l)};
  }
  // Coming back to the tab: refresh once right away and reset the back-off.
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden){lastActive=Date.now();listeners.forEach(l=>l.poll(true))}
  });

  function doc(collection,id){
    const get=async()=>{const r=await call({op:'get',collection,id});return docSnap(id,r.exists,r.data)};
    return {
      id,
      get,
      set:data=>write({op:'set',collection,id,data}),
      update:data=>write({op:'update',collection,id,data}),
      delete:()=>write({op:'delete',collection,id}),
      acquire:({holder,ttlMs}={})=>call({op:'acquire',collection,id,holder,ttlMs}),
      onSnapshot:(cb,onErr,opts)=>listen('doc:'+collection+'/'+id,async()=>{
        const r=await call({op:'get',collection,id});
        return {raw:r,value:docSnap(id,r.exists,r.data)};
      },cb,onErr,opts)
    };
  }
  function collection(name){
    return {
      doc:id=>doc(name,id),
      get:async()=>colSnap((await call({op:'list',collection:name})).docs),
      onSnapshot:(cb,onErr,opts)=>listen('col:'+name,async()=>{
        const r=await call({op:'list',collection:name});
        r.docs.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
        return {raw:r.docs,value:colSnap(r.docs)};
      },cb,onErr,opts)
    };
  }
  const splitPath=p=>{const i=p.indexOf('/');return [p.slice(0,i),p.slice(i+1)]};
  const dbApi={doc:p=>doc(...splitPath(p)),collection};

  const assetsApi={
    upload:async blob=>{
      const r=await fetch('/api/assets',{method:'POST',headers:{'Content-Type':blob.type||'image/jpeg'},body:blob});
      const out=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(out.error||('Upload failed: '+r.status));
      return out;
    },
    delete:async id=>{
      const r=await fetch('/api/assets/'+encodeURIComponent(id),{method:'DELETE'});
      if(!r.ok)throw new Error('Delete failed: '+r.status);
    }
  };

  window.claude={use:async name=>{
    if(name==='db')return dbApi;
    if(name==='assets')return assetsApi;
    throw new Error('Unknown capability: '+name);
  }};
})();
