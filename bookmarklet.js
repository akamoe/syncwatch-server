// SyncWatch — bookmarklet builder (loaded by join.html & bookmarklet-setup.html)

function buildBookmarklet() {
  return `(function(){
if(window.__syncwatch){window.__syncwatch.destroy();return}
var S=__SERVER__,R=__ROOM__;
if(!S||!R||String(S).indexOf("PLACEHOLDER")!==-1||String(R).indexOf("PLACEHOLDER")!==-1){
  S="";R="";
  try{
    var ref=document.referrer;
    if(ref){
      var qi=ref.indexOf("?");
      if(qi!==-1){
        var rp=new URLSearchParams(ref.substring(qi));
        var rs=rp.get("server"),rr=rp.get("room");
        if(rs&&rr){S=rs;R=rr}
      }
    }
  }catch(e){}
  if(!S||!R){
    try{
      var c=JSON.parse(localStorage.getItem("sw")||"{}");
      S=c.u||"";R=c.r||""
    }catch(e){}
  }
}
if(!S||!R){
  var eb=document.createElement("div");
  eb.style.cssText="position:fixed;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));z-index:2147483647;padding:8px 14px;border-radius:22px;font:13px/1.3 -apple-system,sans-serif;font-weight:700;background:#dc2626;color:#fff;white-space:nowrap";
  eb.textContent="SyncWatch: open invite link first";
  (document.body||document.documentElement).appendChild(eb);
  return;
}
try{localStorage.setItem("sw",JSON.stringify({u:S,r:R}))}catch(e){}
var w=null,reconT=0,openT=0,clients=0,playing=0,obs=null,pending=null;
var b=document.createElement("div");
b.id="__sw";
b.style.cssText="position:fixed;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));z-index:2147483647;padding:8px 14px;border-radius:22px;font:13px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;font-weight:700;cursor:pointer;background:#92400e;color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.4);white-space:nowrap;-webkit-user-select:none;user-select:none;max-width:92vw;overflow:hidden;text-overflow:ellipsis";
b.title="Tap to re-sync with Mac";
(document.body||document.documentElement).appendChild(b);
function label(){
  if(!w||w.readyState!==1)return "Connecting…";
  if(clients<2)return "Waiting "+clients+"/2";
  return (playing?"Playing":"Paused")+" · "+clients;
}
function paint(){
  var live=w&&w.readyState===1;
  b.textContent=label();
  b.style.background=live&&clients>=2?"#065f46":(live?"#92400e":"#dc2626");
}
paint();
b.onclick=function(){
  if(!w||w.readyState!==1){paint();return}
  b.textContent="Syncing…";b.style.background="#7c3aed";
  w.send(JSON.stringify({type:"sync-request",room:R}));
};
function findV(){
  var best=null,area=0;
  function check(list){
    for(var i=0;i<list.length;i++){
      var v=list[i],r=v.getBoundingClientRect(),a=r.width*r.height;
      if(a>area&&r.width>50&&r.height>50){best=v;area=a}
    }
  }
  check(document.querySelectorAll("video"));
  var els=document.querySelectorAll("*");
  for(var j=0;j<els.length;j++){
    var sr=els[j].shadowRoot;
    if(sr)check(sr.querySelectorAll("video"));
  }
  return best;
}
function withV(fn){
  var v=findV();
  if(v){fn(v);return}
  if(!obs){
    obs=new MutationObserver(function(){
      var v2=findV();
      if(v2){obs.disconnect();obs=null;fn(v2)}
    });
    obs.observe(document.documentElement,{childList:true,subtree:true});
  }
}
function apply(d,v){
  var th=2;
  if(d.type==="play"||(d.type==="sync-state"&&d.playing)){
    playing=1;
    if(Math.abs(v.currentTime-d.currentTime)>th)v.currentTime=d.currentTime;
    v.play().catch(function(){});
  }else if(d.type==="pause"||(d.type==="sync-state"&&!d.playing)){
    playing=0;
    if(Math.abs(v.currentTime-d.currentTime)>th)v.currentTime=d.currentTime;
    v.pause();
  }else if(d.type==="seek"){
    v.currentTime=d.currentTime;
    playing=v.paused?0:1;
  }
  paint();
}
function onEvent(d){
  var v=findV();
  if(v){apply(d,v);pending=null;return}
  pending=d;
  withV(function(v2){
    if(pending){apply(pending,v2);pending=null}
  });
}
function connect(){
  clearTimeout(openT);
  try{w=new WebSocket(S)}catch(e){b.textContent="Bad server URL";b.style.background="#dc2626";return}
  openT=setTimeout(function(){
    if(!w||w.readyState!==1){
      b.textContent="Blocked — use Safari on loose CSP site";
      b.style.background="#dc2626";
    }
  },6000);
  w.onopen=function(){
    clearTimeout(openT);
    clearTimeout(reconT);
    w.send(JSON.stringify({type:"join",room:R,role:"receiver"}));
    paint();
  };
  w.onmessage=function(e){
    try{
      var d=JSON.parse(e.data);
      if(d.type==="room-info"){clients=d.count;paint();return}
      onEvent(d);
    }catch(ex){}
  };
  w.onclose=function(e){
    clearTimeout(openT);
    if(e&&e.reason==="kicked"){
      b.textContent="Disconnected";b.style.background="#dc2626";
      if(window.__syncwatch)window.__syncwatch.destroy();
      return;
    }
    paint();
    reconT=setTimeout(connect,3000);
  };
  w.onerror=function(){if(w)w.close()};
}
connect();
window.__syncwatch={destroy:function(){
  clearTimeout(reconT);clearTimeout(openT);
  if(w){w.onclose=null;w.close()}
  if(obs){obs.disconnect();obs=null}
  var el=document.getElementById("__sw");if(el)el.remove();
  delete window.__syncwatch;
}};
})();`;
}

function configureBookmarklet(code, server, room) {
  if (server && room) {
    return code
      .replace('__SERVER__', JSON.stringify(server))
      .replace('__ROOM__', JSON.stringify(room));
  }
  return code
    .replace('__SERVER__', '"WS_URL_PLACEHOLDER"')
    .replace('__ROOM__', '"ROOM_ID_PLACEHOLDER"');
}
