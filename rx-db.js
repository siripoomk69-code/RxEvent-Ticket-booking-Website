// Netlify-backed replacement for the `claude.use('db')` / `claude.use('assets')` storage API.
// Data lives in Netlify Database (via /api/db), images in Netlify Blobs (via /api/assets).
(function(){
  if(window.claude&&typeof window.claude.use==='function')return;
  const POLL_MS=3000;
  const listeners=new Set();

  async function call(body){
    const r=await fetch('/api/db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const out=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(out.error||('Request failed: '+r.status));
    return out;
  }
  const docSnap=(id,exists,data)=>({id,exists,data:()=>data});
  const colSnap=docs=>({docs:docs.map(d=>docSnap(d.id,true,d.data)),size:docs.length,empty:!docs.length});

  function refreshAll(){listeners.forEach(l=>l.poll())}
  async function write(body){const out=await call(body);refreshAll();return out}

  function listen(fetcher,cb,onErr){
    let last=null,stopped=false,busy=false,timer=null;
    const l={poll:async()=>{
      if(stopped||busy)return;busy=true;
      try{
        const snap=await fetcher();
        const key=JSON.stringify(snap.raw);
        if(key!==last){last=key;cb(snap.value)}
      }catch(e){onErr&&onErr(e)}
      finally{busy=false}
    }};
    listeners.add(l);l.poll();
    timer=setInterval(()=>{if(!document.hidden)l.poll()},POLL_MS);
    return ()=>{stopped=true;clearInterval(timer);listeners.delete(l)};
  }

  function doc(collection,id){
    const get=async()=>{const r=await call({op:'get',collection,id});return docSnap(id,r.exists,r.data)};
    return {
      id,
      get,
      set:data=>write({op:'set',collection,id,data}),
      update:data=>write({op:'update',collection,id,data}),
      delete:()=>write({op:'delete',collection,id}),
      acquire:({holder,ttlMs}={})=>call({op:'acquire',collection,id,holder,ttlMs}),
      onSnapshot:(cb,onErr)=>listen(async()=>{
        const r=await call({op:'get',collection,id});
        return {raw:r,value:docSnap(id,r.exists,r.data)};
      },cb,onErr)
    };
  }
  function collection(name){
    return {
      doc:id=>doc(name,id),
      get:async()=>colSnap((await call({op:'list',collection:name})).docs),
      onSnapshot:(cb,onErr)=>listen(async()=>{
        const r=await call({op:'list',collection:name});
        r.docs.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
        return {raw:r.docs,value:colSnap(r.docs)};
      },cb,onErr)
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
