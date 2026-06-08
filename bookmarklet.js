// SyncWatch — bookmarklet builder (loaded by join.html & bookmarklet-setup.html)

function buildBookmarklet() {
  return `(function(){
try{
/* ── 1. Show badge IMMEDIATELY — before any code that could throw ── */
if(window.__syncwatch){window.__syncwatch.destroy()}
var b=document.getElementById("__sw");
if(!b){
  b=document.createElement("div");
  b.id="__sw";
  b.style.cssText="position:fixed;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));z-index:2147483647;padding:8px 16px;border-radius:22px;font:bold 13px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;background:#7c3aed;color:#fff;box-shadow:0 2px 16px rgba(0,0,0,.5);white-space:nowrap;-webkit-user-select:none;user-select:none;max-width:92vw;overflow:hidden;text-overflow:ellipsis;transition:background .3s";
  b.textContent="🎬 SyncWatch: starting…";
  (document.body||document.documentElement).appendChild(b);
}

/* ── 2. Simple JS-only pulse — no CSS injection, no CSP risk ── */
var _pulseOn=false,_pulseT=0;
function pulseStart(){
  if(_pulseT)return;
  _pulseT=setInterval(function(){
    _pulseOn=!_pulseOn;
    b.style.opacity=_pulseOn?"1":"0.65";
  },700);
}
function pulseStop(){
  clearInterval(_pulseT);_pulseT=0;b.style.opacity="1";
}
pulseStart();

/* ── 3. Read server + room (baked-in or from localStorage) ── */
var S=__SERVER__,R=__ROOM__;
if(!S||!R||String(S).indexOf("PLACEHOLDER")!==-1||String(R).indexOf("PLACEHOLDER")!==-1){
  S="";R="";
  try{
    var ref=document.referrer;
    if(ref){var qi=ref.indexOf("?");if(qi!==-1){var rp=new URLSearchParams(ref.substring(qi));var rs=rp.get("server"),rr=rp.get("room");if(rs&&rr){S=rs;R=rr}}}
  }catch(e){}
  if(!S||!R){
    try{var c=JSON.parse(localStorage.getItem("sw")||"{}");S=c.u||"";R=c.r||""}catch(e){}
  }
}
if(!S||!R){
  b.textContent="⚠️ Open invite link first";
  b.style.background="#dc2626";
  pulseStop();
  return;
}
try{localStorage.setItem("sw",JSON.stringify({u:S,r:R}))}catch(e){}

/* ── 4. State ── */
var w=null,reconT=0,openT=0,clients=0,playing=0,obs=null,pending=null;

function label(){
  if(!w||w.readyState===0)return "🎬 Connecting…";
  if(w.readyState!==1)return "🔄 Reconnecting…";
  if(clients<2)return "🎬 Waiting "+clients+"/2";
  return (playing?"▶ Playing":"⏸ Paused")+" · "+clients+" connected";
}
function paint(){
  var live=w&&w.readyState===1;
  b.textContent=label();
  if(live&&clients>=2){b.style.background="#065f46";pulseStop();}
  else if(live){b.style.background="#7c3aed";pulseStart();}
  else{b.style.background="#dc2626";pulseStart();}
}
paint();

b.onclick=function(){
  if(!w||w.readyState!==1){paint();return}
  b.textContent="⟳ Syncing…";b.style.background="#7c3aed";
  w.send(JSON.stringify({type:"sync-request",room:R}));
};

/* ── 5. Find video element ── */
function findV(){
  var best=null,area=0;
  function check(list){for(var i=0;i<list.length;i++){var v=list[i],r=v.getBoundingClientRect(),a=r.width*r.height;if(a>area&&r.width>50&&r.height>50){best=v;area=a}}}
  check(document.querySelectorAll("video"));
  var els=document.querySelectorAll("*");
  for(var j=0;j<els.length;j++){var sr=els[j].shadowRoot;if(sr)check(sr.querySelectorAll("video"));}
  return best;
}
function withV(fn){
  var v=findV();if(v){fn(v);return}
  if(!obs){
    obs=new MutationObserver(function(){var v2=findV();if(v2){obs.disconnect();obs=null;fn(v2)}});
    obs.observe(document.documentElement,{childList:true,subtree:true});
  }
}

/* ── 6. Apply remote events ── */
function apply(d,v){
  var th=2;
  if(d.type==="play"||(d.type==="sync-state"&&d.playing)){
    playing=1;if(Math.abs(v.currentTime-d.currentTime)>th)v.currentTime=d.currentTime;v.play().catch(function(){});
  }else if(d.type==="pause"||(d.type==="sync-state"&&!d.playing)){
    playing=0;if(Math.abs(v.currentTime-d.currentTime)>th)v.currentTime=d.currentTime;v.pause();
  }else if(d.type==="seek"){
    v.currentTime=d.currentTime;playing=v.paused?0:1;
  }
  paint();
}
function onEvent(d){
  var v=findV();if(v){apply(d,v);pending=null;return}
  pending=d;withV(function(v2){if(pending){apply(pending,v2);pending=null}});
}

/* ── 7. WebSocket ── */
function connect(){
  clearTimeout(openT);
  try{w=new WebSocket(S)}catch(e){b.textContent="❌ Bad server URL";b.style.background="#dc2626";pulseStop();return}
  openT=setTimeout(function(){
    if(!w||w.readyState!==1){
      b.textContent="⛔ Site is blocking connection";
      b.style.background="#dc2626";
    }
  },8000);
  w.onopen=function(){
    clearTimeout(openT);clearTimeout(reconT);
    w.send(JSON.stringify({type:"join",room:R,role:"receiver"}));
    b.textContent="✅ Joined! Waiting for host…";
    b.style.background="#7c3aed";
    setTimeout(paint,2000);
  };
  w.onmessage=function(e){
    try{var d=JSON.parse(e.data);if(d.type==="room-info"){clients=d.count;paint();return}onEvent(d);}catch(ex){}
  };
  w.onclose=function(e){
    clearTimeout(openT);
    if(e&&e.reason==="kicked"){b.textContent="Disconnected";b.style.background="#dc2626";pulseStop();if(window.__syncwatch)window.__syncwatch.destroy();return;}
    paint();reconT=setTimeout(connect,3000);
  };
  w.onerror=function(){if(w)w.close()};
}
connect();

window.__syncwatch={destroy:function(){
  clearTimeout(reconT);clearTimeout(openT);clearInterval(_pulseT);
  if(w){w.onclose=null;w.close()}
  if(obs){obs.disconnect();obs=null}
  var el=document.getElementById("__sw");if(el)el.remove();
  delete window.__syncwatch;
}};

}catch(err){
  /* If anything above threw, show the error visibly instead of silently failing */
  try{
    var eb=document.getElementById("__sw")||document.createElement("div");
    eb.id="__sw";
    eb.style.cssText="position:fixed;top:12px;right:12px;z-index:2147483647;padding:8px 14px;border-radius:22px;font:bold 12px/1.4 -apple-system,sans-serif;background:#dc2626;color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.5);max-width:300px;word-break:break-all";
    eb.textContent="SyncWatch error: "+String(err.message||err);
    (document.body||document.documentElement).appendChild(eb);
  }catch(e2){}
}
})();`;
}

function configureBookmarklet(code, server, room) {
  if (server && room) {
    return code
      .replace('__SERVER__', JSON.stringify(server))
      .replace('__ROOM__', JSON.stringify(room));
  }
  // Bake defaults into the code so the placeholder replacement is safe even when server/room are null
  return code
    .replace('__SERVER__', '"ws://localhost:3000"')
    .replace('__ROOM__', '"default"');
}

/**
 * Encode bookmarklet code for a javascript: URL using MINIMAL escaping.
 * Only escapes: %  (so existing %XX sequences aren't double-encoded)
 * and backslash (to avoid escaping issues in URL context).
 * This is FAR more reliable than encodeURIComponent which over-encodes
 * and produces URLs that browsers (especially Safari) struggle with.
 */
function encodeBookmarkletCode(code) {
  // Must escape # (URL fragment identifier — would truncate the code)
  // and % (prevents double-encoding) and backslash (escaping issues)
  return code
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/\\/g, '%5C');
}
