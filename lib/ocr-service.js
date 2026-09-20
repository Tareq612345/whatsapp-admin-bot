const crypto=require('crypto');
const{createWorker}=require('tesseract.js');
let workerPromise;
function normalizeText(value){return String(value||'').normalize('NFKC').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ـ\u064B-\u065F]/g,'').replace(/\s+/g,' ').trim().toLowerCase()}
async function getWorker(){if(!workerPromise)workerPromise=createWorker('ara+eng',1,{logger:e=>{if(e.status==='recognizing text'&&Number.isFinite(e.progress))console.log(`[ocr] ${Math.round(e.progress*100)}%`)}});return workerPromise}
async function recognizeImage(buffer){const worker=await getWorker(),result=await worker.recognize(buffer);return{text:String(result.data.text||'').trim(),normalizedText:normalizeText(result.data.text),confidence:Number(result.data.confidence||0)}}
function sha256(buffer){return crypto.createHash('sha256').update(buffer).digest('hex')}
function matchRules(text,rules=[]){const normalized=normalizeText(text),matches=[];for(const rule of rules.filter(x=>x&&x.enabled!==false&&x.groupId))for(const keyword of Array.isArray(rule.keywords)?rule.keywords:[]){const k=normalizeText(keyword);if(k&&normalized.includes(k)){matches.push({rule,keyword});break}}return matches}
module.exports={recognizeImage,matchRules,normalizeText,sha256};
