// Debug mode (owner: press O, or Settings > Misc): draws every collision shape near the player over the game, as the
// server sees it (buildings cyan, rocks / trees red, fallen logs orange capsules; the dashed ring is where a player
// centre stops), creatures green, pets blue, players yellow, and an 8 x 8 grid with A..H / 1..8 labels on the HUD
// minimap (the same sectors the tracker and Discord alerts use). Data: the clone serves /_debug/state?cid=<socket cid>;
// the static (Pages) build answers it in the page (window.__tioDebugSrc).
// Exported as a string: both page guards inline it. The game client swaps Math.cos and Math.sin in the page, so the
// overlay takes axis vectors from the server instead of calling them (log capsules were drawn 90 degrees off).
"use strict";
const SRC = `(function(){if(window.__tioDbg)return;window.__tioDbg=1;
var on=false;try{on=localStorage.getItem("tioDebug")==="1"}catch(e){}
var cv=document.createElement("canvas");cv.id="tio-debug";cv.style.cssText="position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147482000;display:none";
function mount(){if(!cv.parentNode&&document.body)document.body.appendChild(cv);cv.style.display=on?"block":"none";}
var st=null,busy=false,last=0,GRID="ABCDEFGH";
function set(v){on=!!v;try{localStorage.setItem("tioDebug",on?"1":"0")}catch(e){}mount();var cb=document.getElementById("tio-debug-cb");if(cb)cb.checked=on;}
function typing(){var a=document.activeElement;return a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA"||a.isContentEditable);}
addEventListener("keydown",function(e){if((e.key==="o"||e.key==="O")&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.repeat&&!typing())set(!on);},true);
function poll(){if(!on||busy)return;busy=true;var p;
  try{p=window.__tioDebugSrc?Promise.resolve(window.__tioDebugSrc()):fetch("/_debug/state?cid="+encodeURIComponent(window.__tioCid||""),{cache:"no-store"}).then(function(r){return r.ok?r.json():null;});}catch(e){busy=false;return;}
  p.then(function(j){st=j;last=Date.now();}).catch(function(){}).then(function(){busy=false;});}
setInterval(poll,100);
function settingsRow(){var host=document.getElementById("settings-misc");if(!host||document.getElementById("tio-debug-row"))return;
  var row=document.createElement("label");row.id="tio-debug-row";row.style.cssText="display:flex;align-items:center;gap:8px;margin:8px 4px;cursor:pointer;font-weight:bold";
  row.innerHTML='<input type="checkbox" id="tio-debug-cb" style="width:18px;height:18px"> Debug mode (O): hitboxes and map grid';
  host.appendChild(row);var cb=row.querySelector("input");cb.checked=on;cb.addEventListener("change",function(){set(cb.checked);});}
setInterval(function(){mount();settingsRow();},1000);
function sector(x,y,m){var a=m[0],b=m[1],c=Math.min(7,Math.max(0,Math.floor((x-a)/(b-a)*8))),r=Math.min(7,Math.max(0,Math.floor((y-a)/(b-a)*8)));return GRID[c]+(r+1);}
function draw(){requestAnimationFrame(draw);if(!on)return;
  var W=innerWidth,H=innerHeight,d=devicePixelRatio||1;if(cv.width!==Math.round(W*d)||cv.height!==Math.round(H*d)){cv.width=Math.round(W*d);cv.height=Math.round(H*d);}
  var c=cv.getContext("2d");c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,W,H);
  c.font="bold 12px Arial";c.lineWidth=2;
  if(!st||!st.me){var wt="DEBUG (O): waiting for the game",ww=c.measureText(wt).width+14;c.fillStyle="rgba(0,0,0,.6)";c.fillRect((W-ww)/2,64,ww,24);c.fillStyle="#fff";c.fillText(wt,(W-ww)/2+7,80);return;}
  var k=Math.max(W/1920,H/1080)*(window.__tioDebugZoom||1),mx=st.me.x,my=st.me.y,X=function(x){return W/2+(x-mx)*k;},Y=function(y){return H/2+(y-my)*k;};
  st.solids.forEach(function(o){var col=o.L?"255,160,0":o.placed?"0,210,255":"255,70,70";c.strokeStyle="rgba("+col+",.95)";c.fillStyle="rgba("+col+",.14)";
    if(o.L){var ax=o.ax,ay=o.ay,x1=X(o.x-ax*o.L),y1=Y(o.y-ay*o.L),x2=X(o.x+ax*o.L),y2=Y(o.y+ay*o.L),rr=o.r*k,nx=-ay*rr,ny=ax*rr;
      c.beginPath();c.moveTo(x1+nx,y1+ny);c.lineTo(x2+nx,y2+ny);c.arc(x2,y2,rr,o.a+Math.PI/2,o.a-Math.PI/2,true);c.lineTo(x1-nx,y1-ny);c.arc(x1,y1,rr,o.a-Math.PI/2,o.a+Math.PI/2,true);c.closePath();c.fill();c.stroke();}
    else{c.beginPath();c.arc(X(o.x),Y(o.y),o.r*k,0,6.2832);c.fill();c.stroke();}
    c.save();c.setLineDash([5,5]);c.strokeStyle="rgba("+col+",.45)";c.beginPath();
    if(o.L){var bx=o.ax*o.L,by=o.ay*o.L;c.moveTo(X(o.x-bx),Y(o.y-by));c.lineTo(X(o.x+bx),Y(o.y+by));}else c.arc(X(o.x),Y(o.y),o.cd*k,0,6.2832);
    c.stroke();c.restore();
    if(o.hp!=null&&o.hp<255&&!o.placed){c.fillStyle="rgba(255,255,255,.9)";c.fillText(o.hp,X(o.x)-8,Y(o.y)+4);}});
  st.mobs.forEach(function(o){c.strokeStyle=o.pet?(o.mine?"rgba(80,140,255,1)":"rgba(170,110,255,1)"):"rgba(90,230,90,1)";c.beginPath();c.arc(X(o.x),Y(o.y),o.r*k,0,6.2832);c.stroke();
    if(o.hp!=null){c.fillStyle="#fff";c.fillText(o.hp+"%",X(o.x)-10,Y(o.y)-o.r*k-4);}});
  st.players.forEach(function(o){c.strokeStyle="rgba(255,230,60,1)";c.beginPath();c.arc(X(o.x),Y(o.y),o.r*k,0,6.2832);c.stroke();});
  c.strokeStyle="#fff";c.beginPath();c.arc(W/2,H/2,st.me.r*k,0,6.2832);c.stroke();
  var sec=sector(mx,my,st.map),txt="DEBUG (O)  x "+mx+"  y "+my+"  sector "+sec+"  solids "+st.solids.length+"  creatures "+st.mobs.length+(Date.now()-last>1500?"  (no data)":"");
  var tw=c.measureText(txt).width+14;c.fillStyle="rgba(0,0,0,.6)";c.fillRect((W-tw)/2,64,tw,24);c.fillStyle="#fff";c.fillText(txt,(W-tw)/2+7,80);
  var s=Math.round(H*0.1403),L=Math.round(H*0.0098),T=H-Math.round(H*0.0084)-s;
  c.strokeStyle="rgba(255,255,255,.55)";c.lineWidth=1;c.beginPath();
  for(var i=0;i<=8;i++){var g=L+s*i/8;c.moveTo(g,T);c.lineTo(g,T+s);var h=T+s*i/8;c.moveTo(L,h);c.lineTo(L+s,h);}c.stroke();
  c.font="bold "+Math.max(8,Math.round(s/12))+"px Arial";c.fillStyle="rgba(255,255,255,.95)";c.textAlign="center";
  for(var j=0;j<8;j++){c.fillText(GRID[j],L+s*(j+.5)/8,T-3);c.fillText(String(j+1),L+s+8,T+s*(j+.6)/8);}
  var ci=GRID.indexOf(sec[0]),ri=+sec.slice(1)-1;c.fillStyle="rgba(255,230,60,.28)";c.fillRect(L+s*ci/8,T+s*ri/8,s/8,s/8);c.textAlign="left";
}
requestAnimationFrame(draw);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();})();`;
module.exports = { SRC };
