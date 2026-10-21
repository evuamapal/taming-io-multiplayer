# Invented pet levels 61..67: level badges hero-level61..67.png for mimic/invented/png (served by override.json, see
# make_art.py). Takes the real level 60 badge, fits the Rowdies "60" onto its digits, paints them out in the badge
# outline color and writes each new number in the 60 fill color. Renders in headless Chrome on a helper machine (needs the
# hosted server on 8921 for the font). Usage: ~/new-decode-sg/.venv/bin/python tools/invented/make_level_badges.py
import os,sys,base64,json
from seleniumbase import SB
REPO=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","..")
out=os.path.join(REPO,"mimic","invented","png")
f=[json.loads(l)["file"] for l in open(os.path.join(REPO,"mirror","index.jsonl")) if json.loads(l)["url"].split("?")[0].endswith("/img/interface/hero-level60.png")][-1]
b64=base64.b64encode(open(os.path.join(REPO,"mirror","files",f),"rb").read()).decode()
JS=r"""
const done=arguments[arguments.length-1];
(async()=>{
await document.fonts.load('bold 40px Rowdies');await document.fonts.load('40px Rowdies');
const img=new Image();img.src='data:image/png;base64,'+B64;await img.decode();
const W=133,H=88;const cv=(()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c});
const base=cv(),bx=base.getContext('2d');bx.drawImage(img,0,0);const bd=bx.getImageData(0,0,W,H).data;
const mint=i=>bd[i+1]>200&&bd[i]<170&&bd[i+3]>200;
let best=null;
for(const wt of ['700','400'])for(let sz=34;sz<=50;sz++)for(let dx=-4;dx<=4;dx++)for(let dy=-4;dy<=4;dy++){
 const c=cv(),x=c.getContext('2d');x.font=wt+' '+sz+'px Rowdies';x.textAlign='center';x.textBaseline='middle';x.fillStyle='#fff';x.fillText('60',W/2+dx,H/2+dy);
 const d=x.getImageData(0,0,W,H).data;let e=0;for(let i=0;i<d.length;i+=4){if((d[i+3]>128)!==mint(i))e++}
 if(!best||e<best.e)best={e,wt,sz,dx,dy};}
const mc=[];for(let i=0;i<bd.length;i+=4)if(mint(i))mc.push([bd[i],bd[i+1],bd[i+2]]);
const avg=k=>Math.round(mc.reduce((a,c)=>a+c[k],0)/mc.length);const fill='rgb('+avg(0)+','+avg(1)+','+avg(2)+')';
const dk=[bd[(44*W+66)*4],bd[(44*W+66)*4+1],bd[(44*W+66)*4+2]];
const res={best,fill,dk,out:{}};
for(const s of ['61','62','63','64','65','66','67']){
 const c=cv(),x=c.getContext('2d');x.drawImage(img,0,0);x.font=best.wt+' '+best.sz+'px Rowdies';x.textAlign='center';x.textBaseline='middle';x.lineJoin='round';
 const X=W/2+best.dx,Y=H/2+best.dy;
 x.strokeStyle='rgb('+dk+')';x.fillStyle='rgb('+dk+')';x.lineWidth=7;x.strokeText('60',X,Y);x.fillText('60',X,Y);
 x.lineWidth=5;x.strokeText(s,X,Y);x.fillStyle=fill;x.fillText(s,X,Y);
 if(s==='67'){const im=x.getImageData(0,0,W,H),d=im.data;   // owner: the max level 67 badge is red (hue +200 on the saturated parts, owner's pick)
  for(let i=0;i<d.length;i+=4){const r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,c=mx-mn;
   if(c<0.25)continue;const S=c/(1-Math.abs(2*l-1));let h=mx===r?((g-b)/c)%6:mx===g?(b-r)/c+2:(r-g)/c+4;h=(h*60+360+HUE)%360;
   const C=(1-Math.abs(2*l-1))*S,X=C*(1-Math.abs((h/60)%2-1)),m=l-C/2,k=Math.floor(h/60);const t=[[C,X,0],[X,C,0],[0,C,X],[0,X,C],[X,0,C],[C,0,X]][k];
   d[i]=Math.round((t[0]+m)*255);d[i+1]=Math.round((t[1]+m)*255);d[i+2]=Math.round((t[2]+m)*255);}
  x.putImageData(im,0,0);}
 res.out[s]=c.toDataURL('image/png');}
done(res);})().catch(e=>done({err:String(e)}));
""".replace("B64",json.dumps(b64)).replace("HUE","200")
with SB(uc=False, headless2=True, window_size="1280,800", user_data_dir="/tmp/level_badges_prof") as sb:
    sb.open("http://127.0.0.1:8921/"); sb.sleep(6)
    sb.driver.set_script_timeout(120)
    r=sb.driver.execute_async_script(JS)
    if "err" in r: print(r); sys.exit(1)
    print(r["best"],r["fill"],r["dk"])
    for s,u in r["out"].items(): open(out+"/hero-level%s.png"%s,"wb").write(base64.b64decode(u.split(",")[1]))
