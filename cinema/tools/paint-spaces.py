from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import random,math
random.seed(121)
O=Path(__file__).resolve().parents[1] / 'assets';O.mkdir(parents=True,exist_ok=True);W,H=1600,900

def img_base(top,bottom):
 im=Image.new('RGB',(W,H));p=im.load()
 for y in range(H):
  t=y/H
  for x in range(W):
   v=max(0,1-0.7*abs(x-W*.65)/(W*.65))
   p[x,y]=tuple(max(0,min(255,int((a*(1-t)+b*t)*v))) for a,b in zip(top,bottom))
 return im

def glow(im, center,radius,color,intensity=175):
 layer=Image.new('RGBA',im.size,(0,0,0,0));d=ImageDraw.Draw(layer)
 x,y=center;d.ellipse((x-radius,y-radius,x+radius,y+radius),fill=(*color,intensity))
 layer=layer.filter(ImageFilter.GaussianBlur(radius*.40))
 return Image.alpha_composite(im.convert('RGBA'),layer)

def save(im,name):
 im=im.convert('RGB');im.save(O/(name+'.webp'),'WEBP',quality=86,method=6)
 mob=im.crop((430,0,1150,900)).resize((720,1080),Image.Resampling.LANCZOS)
 mob.save(O/(name+'-mobile.webp'),'WEBP',quality=78,method=6)

im=img_base((11,20,31),(6,12,20)).convert('RGBA')
im=glow(im,(1110,375),300,(212,159,90),115)
im=glow(im,(1080,355),130,(240,201,131),175)
d=ImageDraw.Draw(im,'RGBA')
d.polygon([(0,0),(1600,0),(1430,690),(185,690)],fill=(10,18,26,210))
# monumental ribs and corridors
for i in range(10):
 x=int(i*173-100)
 d.polygon([(x-32,0),(x+20,0),(x+88,620),(x+21,620)],fill=(13,24,35,243))
 d.line([(x+20,0),(x+88,620)],fill=(175,131,84,55),width=5)
# vast central monumental illuminated gateway
for r,a in [(245,28),(215,45),(180,100),(133,170)]:
 d.arc((1050-r,325-r,1050+r,325+r),185,355,fill=(226,186,115,a),width=max(4,int(r/12)))
d.rectangle((916,165,1184,625),fill=(9,20,30,230))
d.rounded_rectangle((920,174,1180,614),radius=135,outline=(232,198,135,160),width=9)
d.ellipse((993,240,1112,358), fill=(213,173,104,120))
# floor / reflection
for y in range(600,900,12):
 a=int(100*(y-600)/300)
 d.line((0,y,W,y),fill=(162,132,97,a//3),width=1)
for x in range(-1800,3500,170):
 d.line((W*.65,600,x,900),fill=(182,152,113,40),width=2)
for i in range(46):
 x=random.randrange(220,W); y=random.randrange(170,620)
 d.ellipse((x,y,x+2,y+2),fill=(241,222,166,random.randrange(25,95)))
save(im,'hall')

im=img_base((8,19,32),(4,11,18)).convert('RGBA');im=glow(im,(1090,295),240,(61,166,187),130)
d=ImageDraw.Draw(im,'RGBA')
# shelves in perspective, receding to right vanishing point
for side in [0,1]:
 for i in range(7):
  if side==0: x=80+i*110; direction=1
  else: x=W-80-i*95; direction=-1
  xb=800+(x-800)*.45
  d.polygon([(x-48,0),(x+52,0),(xb+18,735),(xb-22,735)],fill=(8,24,35,220))
  d.line([(x+52,0),(xb+18,735)],fill=(64,132,143,55),width=3)
  for y in [155,280,405,525]:
   xx=x+(xb-x)*(y/760)
   thick=max(2,int((760-y)/190))
   d.line([(xx-31,y),(xx+39,y)],fill=(88,176,174,60),width=thick)
for y in range(620,900,15):
 d.line([(0,y),(W,y)],fill=(109,164,169,max(0,int((900-y)/8))),width=1)
d.ellipse((900,220,1150,470),outline=(122,229,232,120),width=6)
for i in range(85):
 x=random.randint(150,1490); y=random.randint(40,780)
 d.ellipse((x,y,x+3,y+3),fill=(181,221,213,random.randint(20,90)))
save(im,'archive')

im=img_base((8,16,28),(12,8,15)).convert('RGBA');im=glow(im,(1110,390),230,(175,65,57),105)
d=ImageDraw.Draw(im,'RGBA')
# interrogation room: 3 huge pillars and overhead hollow disk
for cx in [800,1130,1450]:
 d.polygon([(cx-95,0),(cx+55,0),(cx+110,760),(cx-22,760)],fill=(17,22,33,220))
 d.line((cx+54,0,cx+110,760),fill=(156,70,66,65),width=8)
for r in [315,290,252]:d.arc((1110-r,390-r,1110+r,390+r),188,354,fill=(226,101,83,90),width=7)
d.line((0,685,1600,685),fill=(165,75,65,45),width=6)
save(im,'chamber')

im=img_base((10,15,25),(4,9,16)).convert('RGBA');im=glow(im,(1130,350),300,(220,185,116),140)
d=ImageDraw.Draw(im,'RGBA')
# luminous verdict rings
for r in [350,320,275,200]:
 d.ellipse((1140-r,400-r,1140+r,400+r),outline=(237,197,125,max(50,195-r//3)),width=7)
for x in range(180,W+600,120):d.line((1140,600,x,900),fill=(220,179,122,42),width=2)
d.rectangle((0,720,W,900),fill=(1,6,12,110))
for i in range(125):
 x=random.randrange(W);y=random.randrange(H)
 d.ellipse((x,y,x+1,y+1),fill=(252,223,170,random.randrange(20,105)))
save(im,'verdict')
print('Procedural space assets created')
