from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

out = Path(__file__).parents[1] / 'miniprogram' / 'images' / 'template' / 'role-signup-share.png'
img = Image.new('RGB', (900, 500), '#064b6b')
d = ImageDraw.Draw(img)
for x in range(0, 900, 30):
    d.line((x, 0, x - 180, 500), fill='#0b5878', width=2)
font_dir = Path('C:/Windows/Fonts')
font = ImageFont.truetype(str(font_dir / 'msyh.ttc'), 46)
small = ImageFont.truetype(str(font_dir / 'msyh.ttc'), 30)
d.rounded_rectangle((54, 62, 846, 438), radius=28, fill='#ffffff')
d.rounded_rectangle((54, 62, 846, 154), radius=28, fill='#b3223a')
d.rectangle((54, 126, 846, 154), fill='#b3223a')
d.text((104, 82), '欢迎报名角色！', font=font, fill='#ffffff')
d.text((104, 205), '加入本次会议，找到你的舞台', font=font, fill='#064b6b')
d.text((106, 300), '选择角色 · 认识伙伴 · 一起成长', font=small, fill='#536878')
d.rounded_rectangle((104, 356, 430, 416), radius=18, fill='#b3223a')
d.text((152, 370), '立即报名', font=small, fill='#ffffff')
img.save(out, optimize=True)
print(out)
