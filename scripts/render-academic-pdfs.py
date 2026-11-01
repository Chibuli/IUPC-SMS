"""Rasterize the actual local PDFs, inspect extracted glyphs, and create review contact sheets."""
from pathlib import Path
import sys, json
sys.path.insert(0, str(Path('.local-migration/pdf-render-tools').resolve()))
import pymupdf as fitz
root = Path(sys.argv[1] if len(sys.argv)>1 else '.local-migration/academic-report-review')
results=[]
files=sorted(p for p in root.glob('*.pdf') if not p.name.startswith('class-list'))
for path in files:
    doc=fitz.open(path)
    text='\n'.join(page.get_text() for page in doc)
    images=[]
    for i,page in enumerate(doc):
        target=path.with_name(path.stem+f'-pdf-page-{i+1}.png')
        page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False).save(target)
        images.append(str(target))
    results.append({'fixture':path.stem,'pages':len(doc),'a4_portrait':all(abs(p.rect.width-595.28)<2 and abs(p.rect.height-841.89)<2 for p in doc),'replacement_glyphs':text.count('\ufffd'),'question_marks':text.count('?'),'text':text,'images':images,'fonts':sorted({font[3] for page in doc for font in page.get_fonts()})})
for batch in range(0,len(results),3):
    sheet=fitz.open();page=sheet.new_page(width=900,height=450)
    for j,result in enumerate(results[batch:batch+3]):
        page.insert_text((j*300+8,14),result['fixture'],fontsize=9)
        page.insert_image(fitz.Rect(j*300+4,22,(j+1)*300-4,445),filename=result['images'][0],keep_proportion=True)
    sheet[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False).save(root/f'pdf-contact-{batch//3+1}.png')
(root/'pdf-render-verification.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k not in ['text','images']} for r in results],indent=2))
