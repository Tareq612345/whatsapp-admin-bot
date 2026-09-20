import base64
import json
import sys
import traceback
from rapidocr import RapidOCR, LangRec, OCRVersion, ModelType, EngineType

def create_engine():
    return RapidOCR(params={
        'Rec.engine_type': EngineType.ONNXRUNTIME,
        'Rec.lang_type': LangRec.ARABIC,
        'Rec.ocr_version': OCRVersion.PPOCRV5,
        'Rec.model_type': ModelType.MOBILE,
        'Global.use_cls': False,
        'Global.log_level': 'error',
        'Global.text_score': 0.45,
    })

def main():
    engine=create_engine()
    if '--warmup' in sys.argv:
        print('RapidOCR Arabic PP-OCRv5 is ready.',flush=True)
        return
    for line in sys.stdin:
        try:
            request=json.loads(line);request_id=request.get('id');image=base64.b64decode(request['image']);result=engine(image)
            texts=list(result.txts or []);scores=[float(value) for value in (result.scores or [])];confidence=(sum(scores)/len(scores)*100) if scores else 0
            response={'id':request_id,'ok':True,'text':'\n'.join(texts),'confidence':confidence,'lines':[{'text':text,'confidence':scores[index] if index<len(scores) else 0} for index,text in enumerate(texts)]}
        except Exception as error:
            response={'id':locals().get('request_id'),'ok':False,'error':str(error),'trace':traceback.format_exc(limit=2)}
        print(json.dumps(response,ensure_ascii=False),flush=True)

if __name__=='__main__':
    main()
