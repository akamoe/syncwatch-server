// SyncWatch — bookmarklet builder (loaded by join.html)

function buildBookmarklet() {
  return `(function(){
try{
if(window.__syncwatch){window.__syncwatch.destroy()}
var b=document.getElementById("__sw");
if(!b){
  b=document.createElement("div");
  b.id="__sw";
  b.style.cssText="position:fixed;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));z-index:2147483647;padding:8px 16px;border-radius:22px;font:bold 13px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;background:%237c3aed;color:%23fff;box-shadow:0 2px 16px rgba(0,0,0,.5);white-space:nowrap;-webkit-user-select:none;user-select:none;max-width:92vw;overflow:hidden;text-overflow:ellipsis;transition:background .3s";
  b.textContent="Connecting...";
  (document.body||document.documentElement).appendChild(b);
}

var _pulseOn=false,_pulseT=0;
function pulseStart(){
  if(_pulseT)return;
  _pulseT=setInterval(function(){ _pulseOn=!_pulseOn; b.style.opacity=_pulseOn?"1":"0.65"; },700);
}
function pulseStop(){ clearInterval(_pulseT);_pulseT=0;b.style.opacity="1"; }
pulseStart();

var S=__SERVER__,R=__ROOM__;
if(!S||!R){
  try{ var c=JSON.parse(localStorage.getItem("sw")||"{}"); S=c.u||""; R=c.r||""; }catch(e){}
}
if(!S||!R){
  b.textContent="Open invite link first";
  b.style.cssText=b.style.cssText.replace("%237c3aed","red");
  pulseStop();
  return;
}
try{ localStorage.setItem("sw",JSON.stringify({u:S,r:R})); }catch(e){}

var w=null,reconT=0,openT=0,pingT=0,clients=0,playing=0,obs=null,pending=null;

function setColor(hex){
  b.style.background='#'+hex.replace(/^#|^%23/,'');
}
function label(){
  if(!w||w.readyState===0)return "SyncWatch: Connecting...";
  if(w.readyState!==1)return "Reconnecting...";
  if(clients<2)return "Waiting "+clients+"/2";
  return (playing?"Playing":"Paused")+" ("+clients+" connected)";
}
function paint(){
  var live=w&&w.readyState===1;
  b.textContent=label();
  if(live&&clients>=2){ b.style.background="green"; pulseStop(); }
  else if(live){ b.style.background="purple"; pulseStart(); }
  else{ b.style.background="red"; pulseStart(); }
}
paint();

b.onclick=function(){
  if(!w||w.readyState!==1){ paint(); return; }
  b.textContent="Syncing...";
  b.style.background="purple";
  w.send(JSON.stringify({type:"sync-request",room:R}));
};

function findV(){
  var best=null,area=0;
  function check(list){ for(var i=0;i<list.length;i++){ var v=list[i],r=v.getBoundingClientRect(),a=r.width*r.height; if(a>area&&r.width>50&&r.height>50){best=v;area=a;} } }
  check(document.querySelectorAll("video"));
  var els=document.querySelectorAll("*");
  for(var j=0;j<els.length;j++){ var sr=els[j].shadowRoot; if(sr)check(sr.querySelectorAll("video")); }
  return best;
}
function withV(fn){
  var v=findV(); if(v){ fn(v); return; }
  if(!obs){
    obs=new MutationObserver(function(){ var v2=findV(); if(v2){ obs.disconnect(); obs=null; fn(v2); } });
    obs.observe(document.documentElement,{childList:true,subtree:true});
    // Safety: disconnect after 60s to avoid permanent leak
    setTimeout(function(){ if(obs){ obs.disconnect(); obs=null; } }, 60000);
  }
}

function applyEvent(d,v){
  var th=2;
  if(d.type==="play"||(d.type==="sync-state"&&d.playing)){
    playing=1; if(Math.abs(v.currentTime-d.currentTime)>th)v.currentTime=d.currentTime; v.play().catch(function(){}); console.log("[SyncWatch] play @",d.currentTime);
  } else if(d.type==="pause"||(d.type==="sync-state"&&!d.playing)){
    playing=0; if(Math.abs(v.currentTime-d.currentTime)>th)v.currentTime=d.currentTime; v.pause(); console.log("[SyncWatch] pause @",d.currentTime);
  } else if(d.type==="seek"){
    v.currentTime=d.currentTime; playing=v.paused?0:1; console.log("[SyncWatch] seek @",d.currentTime);
  } else if(d.type==="rate"){
    if(d.rate)v.playbackRate=d.rate; console.log("[SyncWatch] rate",d.rate+"x");
  }
  paint();
}
function onEvent(d){
  var v=findV(); if(v){ applyEvent(d,v); pending=null; return; }
  pending=d; withV(function(v2){ if(pending){ applyEvent(pending,v2); pending=null; } });
}

function connect(){
  clearTimeout(openT);
  try{ w=new WebSocket(S); }catch(e){ b.textContent="Bad server URL"; b.style.background="red"; pulseStop(); return; }
  openT=setTimeout(function(){
    if(!w||w.readyState!==1){ b.textContent="Connection blocked"; b.style.background="red"; }
  },8000);
  w.onopen=function(){
    clearTimeout(openT); clearTimeout(reconT);
    w.send(JSON.stringify({type:"join",room:R,role:"receiver"}));
    b.textContent="Joined! Waiting for host...";
    b.style.background="#7c3aed";
    setTimeout(paint,2000);
    // FIX: ping every 25s so Safari iOS doesn't kill idle WebSocket after ~60s
    clearInterval(pingT);
    pingT=setInterval(function(){
      if(w&&w.readyState===1)w.send(JSON.stringify({type:"ping",room:R}));
    },25000);
  };
  w.onmessage=function(e){
    try{
      var d=JSON.parse(e.data);
      if(d.type==="room-info"){ clients=d.count; paint(); return; }
      onEvent(d);
    }catch(ex){}
  };
  w.onclose=function(e){
    clearTimeout(openT); clearInterval(pingT); pingT=0;
    if(e&&e.reason==="kicked"){ b.textContent="Disconnected"; b.style.background="#dc2626"; pulseStop(); if(window.__syncwatch)window.__syncwatch.destroy(); return; }
    paint(); reconT=setTimeout(connect,3000);
  };
  w.onerror=function(){ if(w)w.close(); };
}
connect();

window.__syncwatch={destroy:function(){
  clearTimeout(reconT); clearTimeout(openT); clearInterval(_pulseT); clearInterval(pingT); pingT=0;
  if(w){ w.onclose=null; w.close(); }
  if(obs){ obs.disconnect(); obs=null; }
  var el=document.getElementById("__sw"); if(el)el.remove();
  delete window.__syncwatch;
}};

}catch(err){
  try{
    var eb=document.getElementById("__sw")||document.createElement("div");
    eb.id="__sw";
    eb.style.cssText="position:fixed;top:12px;right:12px;z-index:2147483647;padding:8px 14px;border-radius:22px;font:bold 12px/1.4 -apple-system,sans-serif;background:red;color:white;box-shadow:0 2px 12px rgba(0,0,0,.5);max-width:300px;word-break:break-all";
    eb.textContent="SyncWatch error: "+String(err.message||err);
    (document.body||document.documentElement).appendChild(eb);
  }catch(e2){}
}
})()`;  // NOTE: no trailing semicolon — encodeBookmarkletCode expects the raw IIFE string
}

function configureBookmarklet(code, server, room) {
  return code
    .replace('__SERVER__', JSON.stringify(server || ''))
    .replace('__ROOM__',   JSON.stringify(room   || ''));
}

/**
 * Encode bookmarklet code for a javascript: URL — Safari + Chrome safe.
 *
 * KEY FIXES vs old version:
 * 1. Strip newlines first — Safari on iOS sometimes rejects javascript: URLs
 *    with raw newlines, silently doing nothing when the bookmark is tapped.
 * 2. Use encodeURIComponent (the standard) but selectively decode chars that
 *    are safe in javascript: URL context. This is more robust than the old
 *    manual approach which missed characters like + and & that could cause issues.
 * 3. Do NOT call this with ',void(0)' appended — the IIFE already returns
 *    undefined, and appending ',void(0)' after the closing ');' is a syntax error.
 *    The caller should just do: 'javascript:' + encodeBookmarkletCode(code)
 */
function encodeBookmarkletCode(code) {
  // Step 1: collapse all newlines + surrounding whitespace into single space
  // This is safe — JavaScript statements don't require newlines
  code = code.replace(/\r\n|\r|\n/g, ' ').replace(/  +/g, ' ');

  // Step 2: standard URI encoding — handles ALL dangerous chars including
  // # (fragment), % (double-encode), \ (escape issues), & (query string)
  return encodeURIComponent(code)
    // Step 3: decode chars that are safe in javascript: URL context.
    // IMPORTANT: do NOT decode %20 (space) — Safari iOS treats javascript: URLs
    // with literal spaces as navigation, silently doing nothing.
    .replace(/%21/g, '!')
    .replace(/%27/g, "'")
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2C/g, ',')
    .replace(/%3B/g, ';')
    .replace(/%7B/g, '{')
    .replace(/%7D/g, '}')
    .replace(/%3D/g, '=')
    .replace(/%3A/g, ':')
    // DO NOT decode: %20 (space), %23 (#), %25 (%), %22 ("), %5C (\), %26 (&), %3F (?)
    ;
}
