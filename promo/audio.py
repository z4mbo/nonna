# Fully synthesized SFX + tarantella-style plucked bed (original, royalty-free). Plus project-owned shout-1.mp3 (MIT).
import numpy as np, sys, subprocess, wave
SR=48000
def tone_pluck(f,d,amp=0.25):
    n=int(SR*d); N=int(SR/f); buf=np.random.uniform(-1,1,N); out=np.zeros(n)
    for i in range(n):
        out[i]=buf[i%N]; buf[i%N]=0.497*(buf[i%N]+buf[(i+1)%N])
    return out*amp
def bed(dur,bpm=150,seq=None):
    out=np.zeros(int(SR*dur)); beat=60/bpm/2
    notes=seq or [440,523.25,659.25,523.25, 392,493.88,587.33,493.88, 440,523.25,659.25,880, 659.25,587.33,523.25,493.88]
    cache={}
    t=0;i=0
    while t<dur:
        f=notes[i%len(notes)]
        if f not in cache: cache[f]=tone_pluck(f,0.5,0.18)
        s=int(t*SR); seg=cache[f][:len(out)-s]; out[s:s+len(seg)]+=seg
        # bass on downbeats
        if i%4==0:
            bf=f/4; b=np.sin(2*np.pi*bf*np.arange(int(SR*0.25))/SR)*np.exp(-np.arange(int(SR*0.25))/SR*10)*0.22
            b=b[:len(out)-s]; out[s:s+len(b)]+=b
        t+=beat;i+=1
    return out
def add(out,x,at):
    s=int(at*SR); x=x[:len(out)-s]; out[s:s+len(x)]+=x
def whoosh(d=0.9):
    n=int(SR*d); noise=np.random.randn(n); env=np.sin(np.linspace(0,np.pi,n))**2*np.linspace(0.3,1,n)
    # crude rising bandpass via one-pole smoothing varying
    y=np.zeros(n); a=0
    for i in range(n):
        k=0.02+0.5*(i/n); a+= k*(noise[i]-a); y[i]=a
    return y*env*0.9/np.max(np.abs(y))
def thud():
    n=int(SR*0.6); t=np.arange(n)/SR; f=110*np.exp(-t*6)+45
    x=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*7)*0.9 + np.random.randn(n)*np.exp(-t*40)*0.5
    return x
def pop(f=900):
    n=int(SR*0.12); t=np.arange(n)/SR; return np.sin(2*np.pi*(f+f*2*np.exp(-t*60))*t)*np.exp(-t*35)*0.35
def ding():
    n=int(SR*1.2); t=np.arange(n)/SR; return (np.sin(2*np.pi*1318.5*t)+0.5*np.sin(2*np.pi*1975.5*t))*np.exp(-t*4)*0.25
def load_mp3(p):
    raw=subprocess.run(['ffmpeg','-v','error','-i',p,'-f','f32le','-ac','1','-ar',str(SR),'-'],capture_output=True).stdout
    return np.frombuffer(raw,np.float32).astype(float)
which,dst=sys.argv[1],sys.argv[2]
np.random.seed(3)
if which=='intro':
    out=bed(4.0)*0.7; out[int(2.4*SR):int(3.0*SR)]*=0.15
    for at in (0.25,0.55,0.85): add(out,pop(700+at*600),at)
    add(out,load_mp3('/tmp/claude-0/repo/assets/sounds/shout-1.mp3')*0.8,0.8)
    add(out,whoosh(0.9),1.5); add(out,thud(),2.4); add(out,ding()*0.7,3.0)
    fade=np.linspace(1,0,int(0.3*SR)); out[-len(fade):]*=fade
else:
    out=bed(4.0,seq=[523.25,659.25,783.99,659.25, 587.33,698.46,880,698.46, 523.25,659.25,783.99,1046.5, 783.99,659.25,587.33,523.25])*0.7
    for at in (0.3,0.9,1.2,1.5,1.8): add(out,pop(800),at)
    add(out,ding(),0.9)
    fade=np.linspace(1,0,int(0.6*SR)); out[-len(fade):]*=fade
out=out/max(1,np.max(np.abs(out))*1.05)
d=(out*32767).astype('<i2')
w=wave.open(dst,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(d.tobytes()); w.close()
