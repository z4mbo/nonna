import sys, math, subprocess, glob, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W,H,FPS=1920,1080,30
WK='/tmp/claude-0/work'; RA='/tmp/claude-0/repo/assets'
SER='/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
INT='/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'
def F(p,s): return ImageFont.truetype(p,s)
RED=(206,43,55); GREEN=(0,140,69); CREAM=(250,243,228); INK=(38,28,22)
def frames(n): return [Image.open(f) for f in sorted(glob.glob(f'{WK}/{n}/*.png'))]
ANG,HAP=frames('angry'),frames('happy')
SLIP=Image.open(f'{RA}/slipper.png').convert('RGBA')
ICON=Image.open(f'{RA}/icon.png').convert('RGBA').resize((150,150))
def gingham():
    im=Image.new('RGB',(W,H),CREAM); a=np.array(im).astype(float); s=90
    x=(np.arange(W)//s)%2; y=(np.arange(H)//s)%2
    m=(x[None,:]+y[:,None])/2.0
    col=np.array(RED,float)
    a=a*(1-0.55*m[...,None])+col*0.55*m[...,None]
    return Image.fromarray(a.astype('uint8'))
GING=gingham()
# vignette panel
def bg(): 
    b=GING.copy(); ov=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(ov)
    d.rounded_rectangle((70,70,W-70,H-70),60,fill=CREAM+(235,))
    b.paste(ov,(0,0),ov); return b
BG=bg()
def ease(t): t=max(0,min(1,t)); return 1-(1-t)**3
def back(t):
    t=max(0,min(1,t)); c1=1.70158; c3=c1+1; return 1+c3*(t-1)**3+c1*(t-1)**2
def shadow(img,off=12,blur=18):
    a=img.split()[3].point(lambda v:v*0.45); s=Image.new('RGBA',img.size,(0,0,0,255)); s.putalpha(a)
    return s.filter(ImageFilter.GaussianBlur(blur))
def put(canvas,img,cx,cy,scale=1,rot=0,alpha=1,sh=True):
    if scale<=0.01 or alpha<=0: return
    im=img.resize((max(1,int(img.width*scale)),max(1,int(img.height*scale))),Image.LANCZOS)
    if rot: im=im.rotate(rot,expand=True,resample=Image.BICUBIC)
    if alpha<1: im.putalpha(im.split()[3].point(lambda v:int(v*alpha)))
    x,y=int(cx-im.width/2),int(cy-im.height/2)
    if sh: s=shadow(im); canvas.paste(s,(x+14,y+18),s)
    canvas.paste(im,(x,y),im)
def text(txt,font,fill,stroke=0,sc=INK):
    d=ImageDraw.Draw(Image.new('RGBA',(1,1))); b=d.textbbox((0,0),txt,font=font,stroke_width=stroke)
    im=Image.new('RGBA',(b[2]-b[0]+40,b[3]-b[1]+40),(0,0,0,0))
    ImageDraw.Draw(im).text((20-b[0],20-b[1]),txt,font=font,fill=fill,stroke_width=stroke,stroke_fill=sc)
    return im
def shake(c,amp):
    if amp<=0: return c
    dx,dy=np.random.randint(-amp,amp+1,2); big=c.resize((W+80,H+46)); return big.crop((40+dx,23+dy,40+dx+W,23+dy+H))

def intro(t):
    c=BG.copy().convert('RGBA'); amp=0
    # nonna angry rises in from right
    fi=min(int(t*30),len(ANG)-1); p=ease(t/0.5)
    ny=H-470+ (1-p)*1000
    put(c,ANG[fi],1500,ny,1.15)
    # headline words
    words=[("DON'T MAKE",0.25,INK),("THE NONNA",0.55,INK),("MAD.",0.85,RED)]
    f=F(INT,150)
    for i,(w,t0,col) in enumerate(words):
        if t<t0: continue
        s=back((t-t0)/0.25); im=text(w,f,col)
        put(c,im,160+im.width/2,300+i*175,s,rot=(-4 if w=='MAD.' else 0),sh=False)
        if t-t0<0.12: amp=max(amp,10)
    if 0.85<t<1.3: 
        # little anger marks
        a=text('!!',F(INT,120),RED); put(c,a,1680,230,back((t-0.85)/0.2),rot=-15,sh=False)
    # slipper throw 1.5->2.4
    if t>=1.5:
        q=(t-1.5)/0.9
        if q<1:
            e=q**2.2; sc=0.35+e*4.2; rot=-30+q*400
            cx=1300+(W/2-1300)*e; cy=400+(H/2-400)*e - math.sin(q*math.pi)*200
            put(c,SLIP,cx,cy,sc,rot=rot)
        else:
            # fills the screen, sole facing camera
            k=min(1,(t-2.4)/0.15); sc=4.6+0.4*k
            put(c,SLIP,W/2,H/2,sc*1.0,rot=90,sh=False)
            amp=int(28*max(0,1-(t-2.4)/0.35))
    out=c.convert('RGB')
    if t>=3.0:
        k=ease((t-3.0)/0.25)
        card=BG.copy(); f2=F(INT,96); im=text('Keep your desktop clean.',f2,INK)
        cc=card.convert('RGBA'); put(cc,im,W/2,H/2-40,0.9+0.1*k,sh=False)
        s2=text('or Nonna will clean it for you.',F(SER,52),RED); put(cc,s2,W/2,H/2+90,1,alpha=ease((t-3.3)/0.3),sh=False)
        out=Image.blend(out,cc.convert('RGB'),k)
    return shake(out,amp)

def outro(t):
    c=BG.copy().convert('RGBA')
    fi=min(int(t*30),len(HAP)-1); p=ease(t/0.6)
    put(c,HAP[fi],420-(1-p)*700,H-410,1.0)
    x0=1180
    if t>0.3:
        s=back((t-0.3)/0.35); put(c,ICON,x0-370,255,s,sh=True)
        put(c,text('Nonna',F(SER,190),INK),x0+80,250,s,sh=False)
    if t>0.6: put(c,text("Don't make the Nonna mad.",F(INT,58),RED),x0,420,1,alpha=ease((t-0.6)/0.3),sh=False)
    if t>0.9:
        s=back((t-0.9)/0.35); pill=Image.new('RGBA',(900,140),(0,0,0,0)); d=ImageDraw.Draw(pill)
        d.rounded_rectangle((0,0,899,139),70,fill=GREEN)
        tx=text('Download free',F(INT,64),(255,255,255)); pill.paste(tx,((900-tx.width)//2,(140-tx.height)//2),tx)
        put(c,pill,x0,590,s)
    if t>1.2: put(c,text('nonna.imbored.fun',F(INT,72),INK),x0,750,1,alpha=ease((t-1.2)/0.3),sh=False)
    if t>1.5: put(c,text('★ Star on GitHub  ·  github.com/z4mbo/nonna',F('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',42),(90,70,60)),x0,860,1,alpha=ease((t-1.5)/0.3),sh=False)
    if t>1.8: put(c,text('macOS  ·  Windows 11',F(INT,40),GREEN),x0,940,1,alpha=ease((t-1.8)/0.3),sh=False)
    out=c.convert('RGB')
    if t>3.7: out=Image.blend(out,Image.new('RGB',(W,H),(0,0,0)),ease((t-3.7)/0.3))
    return out

which,dur,audio,dst=sys.argv[1],float(sys.argv[2]),sys.argv[3],sys.argv[4]
fn=intro if which=='intro' else outro
p=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',audio,
 '-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-shortest','-movflags','+faststart',dst],stdin=subprocess.PIPE)
np.random.seed(1)
for i in range(int(dur*FPS)): p.stdin.write(fn(i/FPS).tobytes())
p.stdin.close(); p.wait()
