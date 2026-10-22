from PIL import Image,ImageEnhance,ImageFilter,ImageOps,ImageDraw
from pathlib import Path
R=Path(__file__).resolve().parents[1] / 'source-boards'
O=Path(__file__).resolve().parents[1] / 'assets'
O.mkdir(parents=True,exist_ok=True)
assets=[
('city', 'a_cinematic_high_end_dark_sci_fi_promotional_ui.png', (700,285,1295,655)),
('skyline', 'a_wide_cinematic_infographic_dashboard_poster_wit.png', (530,15,1230,426)),
('tribunal-light', 'a_wide_cinematic_collage_and_ui_mockup_image_over.png', (990,10,1340,300)),
('human', 'a_wide_cinematic_collage_and_ui_mockup_image_over.png', (820,590,1040,730)),
('aftermath', 'a_wide_cinematic_ui_infographic_style_promotional.png', (735,70,1250,490)),
('vantage', 'a_wide_high_resolution_infographic_cinematic_pres.png', (105,735,280,938)),
]
thumbs=[]
for name,src,rect in assets:
    im=Image.open(R/src).convert('RGB').crop(rect)
    native=im.size
    # preserve cinematic color and composition; resize with Lanczos: not claim source resolution upgraded
    w=1440; h=900
    fit=ImageOps.fit(im,(w,h),Image.Resampling.LANCZOS,centering=(.5,.45))
    fit=ImageEnhance.Color(fit).enhance(.83)
    fit=ImageEnhance.Contrast(fit).enhance(1.06)
    # add shadow on left, keeps copy legible with no new text in image
    shadow=Image.new('RGBA',(w,h),(0,0,0,0)); p=shadow.load()
    for x in range(w):
      a=int(190*max(0,1-x/(w*.84))**1.35)
      for y in range(h): p[x,y]=(3,8,16,a)
    fit=Image.alpha_composite(fit.convert('RGBA'),shadow).convert('RGB')
    fit.save(O/(name+'.webp'), 'WEBP',quality=84,method=6)
    mobile=ImageOps.fit(im,(720,1080),Image.Resampling.LANCZOS,centering=(.6,.42))
    mobile=ImageEnhance.Contrast(mobile).enhance(.95)
    mobile.save(O/(name+'-mobile.webp'),'WEBP',quality=76,method=6)
    t=fit.resize((400,250))
    d=ImageDraw.Draw(t);d.rectangle((0,0,400,29),fill='#0b111d');d.text((10,9),f'{name}  source: {native[0]}x{native[1]}',fill='#eee')
    thumbs.append(t)
out=Image.new('RGB',(1200,500))
for i,t in enumerate(thumbs):out.paste(t,((i%3)*400,(i//3)*250))
out.save(O.parent/'reports/asset-contact-sheet.jpg',quality=88)
print('Saved',len(assets),'images',list((p.name,p.stat().st_size) for p in O.glob('*.webp')))
