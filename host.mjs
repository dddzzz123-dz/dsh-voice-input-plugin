/**
 * DSH Voice Input — permanent host half.
 *
 * Loaded by the Web profile's user cordis.patch.yml (same mechanism as the
 * Codex App Server bridge). Registers ONE exact HTTP route that the browser
 * client half calls directly, so no dynamic `harness.handle`/`host.call`
 * channel is needed.
 *
 * The route proxies the three Volcengine ASR products (streaming /
 * recording-v1 / recording-v2) through a child `node` process. Credentials
 * travel in the request body and are passed to the child only via its
 * temporary environment; they are never logged or written to disk.
 */

import { fileURLToPath } from 'node:url'

export const name = 'voice-input-host'
export const inject = ['webServer', 'shell']

const NODE_SCRIPT = [
  'const zlib=require("zlib");',
  'const https=require("https");',
  'const cryptoNode=require("crypto");',
  'let input="";',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data",chunk=>input+=chunk);',
  'const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));',
  'function authHeaders(resource,requestId){const headers={"Content-Type":"application/json","X-Api-Resource-Id":resource,"X-Api-Request-Id":requestId,"X-Api-Sequence":"-1"};if(process.env.VOICE_VOLC_AUTH_MODE==="legacy"){headers["X-Api-App-Key"]=process.env.VOICE_VOLC_APP_ID;headers["X-Api-Access-Key"]=process.env.VOICE_VOLC_ACCESS_TOKEN;}else{headers["X-Api-Key"]=process.env.VOICE_VOLC_API_KEY;}return headers;}',
  'async function recording(body,service){const resource=service==="recording-v1"?"volc.bigasr.auc":"volc.seedasr.auc";const requestId=crypto.randomUUID();const headers=authHeaders(resource,requestId);const payload={user:body.user,audio:body.audio,request:body.request};const submit=await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit",{method:"POST",headers,body:JSON.stringify(payload)});const submitStatus=submit.headers.get("x-api-status-code")||"";const submitMessage=submit.headers.get("x-api-message")||"";const logId=submit.headers.get("x-tt-logid")||"";if(!submit.ok||submitStatus!=="20000000")return{ok:false,apiStatus:submitStatus,message:submitMessage||("HTTP "+submit.status),logId};for(let count=0;count<60;count++){if(count>0)await sleep(2000);const queryHeaders=authHeaders(resource,requestId);if(logId)queryHeaders["X-Tt-Logid"]=logId;const query=await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/query",{method:"POST",headers:queryHeaders,body:"{}"});const apiStatus=query.headers.get("x-api-status-code")||"";const message=query.headers.get("x-api-message")||"";let result=null;try{result=await query.json();}catch(error){}if(apiStatus==="20000000"){const text=result&&result.result&&typeof result.result.text==="string"?result.result.text:"";return{ok:query.ok&&!!text,text,apiStatus,message:message||(!text?"识别完成但未返回文本":""),logId:query.headers.get("x-tt-logid")||logId};}if(apiStatus!=="20000001"&&apiStatus!=="20000002")return{ok:false,apiStatus,message:message||("HTTP "+query.status),logId};}return{ok:false,message:"录音文件识别等待超时",logId};}',
  'function frame(type,flags,serialization,compression,payload){const data=compression===1?zlib.gzipSync(payload):Buffer.from(payload);const out=Buffer.alloc(8+data.length);out[0]=0x11;out[1]=(type<<4)|flags;out[2]=(serialization<<4)|compression;out[3]=0;out.writeUInt32BE(data.length,4);data.copy(out,8);return out;}',
  'function parseFrame(value){const data=Buffer.from(value);const type=data[1]>>4;const flags=data[1]&15;const compression=data[2]&15;let offset=(data[0]&15)*4;if(type===15){const code=data.readUInt32BE(offset);offset+=4;const size=data.readUInt32BE(offset);offset+=4;return{error:true,code,message:data.subarray(offset,offset+size).toString("utf8")};}if(flags&1)offset+=4;const size=data.readUInt32BE(offset);offset+=4;let payload=data.subarray(offset,offset+size);if(compression===1)payload=zlib.gunzipSync(payload);let body=null;try{body=JSON.parse(payload.toString("utf8"));}catch(error){}return{type,flags,body};}',
  'function websocketFrame(payload,opcode){const data=Buffer.from(payload);let extra=data.length<126?0:data.length<=65535?2:8;const header=Buffer.alloc(2+extra+4);header[0]=128|opcode;if(extra===0)header[1]=128|data.length;else if(extra===2){header[1]=128|126;header.writeUInt16BE(data.length,2);}else{header[1]=128|127;header.writeBigUInt64BE(BigInt(data.length),2);}const maskOffset=2+extra;const mask=cryptoNode.randomBytes(4);mask.copy(header,maskOffset);const masked=Buffer.alloc(data.length);for(let i=0;i<data.length;i++)masked[i]=data[i]^mask[i%4];return Buffer.concat([header,masked]);}',
  'async function streaming(body){const requestId=cryptoNode.randomUUID();const headers=authHeaders("volc.seedasr.sauc.duration",requestId);delete headers["Content-Type"];headers["X-Api-Connect-Id"]=requestId;headers.Connection="Upgrade";headers.Upgrade="websocket";headers["Sec-WebSocket-Version"]="13";headers["Sec-WebSocket-Key"]=cryptoNode.randomBytes(16).toString("base64");const audio=Buffer.from(body.audio.data,"base64");const request={user:body.user,audio:{format:"wav",rate:16000,bits:16,channel:1,language:body.language},request:body.request};return await new Promise(resolve=>{let settled=false;let sentAudio=false;let latestText="";let socket=null;let incoming=Buffer.alloc(0);const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);if(socket)socket.destroy();resolve(value);};const handleProtocol=value=>{const parsed=parseFrame(value);if(parsed.error){finish({ok:false,apiStatus:String(parsed.code),message:parsed.message});return;}const text=parsed.body&&parsed.body.result&&typeof parsed.body.result.text==="string"?parsed.body.result.text:"";if(text)latestText=text;if(!sentAudio){sentAudio=true;socket.write(websocketFrame(frame(2,2,0,1,audio),2));return;}if(parsed.flags&2)finish({ok:!!latestText,text:latestText,apiStatus:latestText?"20000000":"",message:latestText?"":"流式识别未返回文本"});};const consume=chunk=>{incoming=Buffer.concat([incoming,chunk]);while(incoming.length>=2){const opcode=incoming[0]&15;const masked=(incoming[1]&128)!==0;let length=incoming[1]&127;let offset=2;if(length===126){if(incoming.length<4)return;length=incoming.readUInt16BE(2);offset=4;}else if(length===127){if(incoming.length<10)return;length=Number(incoming.readBigUInt64BE(2));offset=10;}const maskSize=masked?4:0;if(incoming.length<offset+maskSize+length)return;let payload=incoming.subarray(offset+maskSize,offset+maskSize+length);if(masked){const mask=incoming.subarray(offset,offset+4);const decoded=Buffer.alloc(length);for(let i=0;i<length;i++)decoded[i]=payload[i]^mask[i%4];payload=decoded;}incoming=incoming.subarray(offset+maskSize+length);if(opcode===2){try{handleProtocol(payload);}catch(error){finish({ok:false,message:error.message||String(error)});}}else if(opcode===8){finish({ok:!!latestText,text:latestText,message:latestText?"":"流式连接提前关闭"});}else if(opcode===9&&socket){socket.write(websocketFrame(payload,10));}}};const timer=setTimeout(()=>finish({ok:false,message:"流式识别等待超时"}),120000);const req=https.request({hostname:"openspeech.bytedance.com",port:443,path:"/api/v3/sauc/bigmodel",method:"GET",headers});req.on("upgrade",(response,upgraded,head)=>{socket=upgraded;socket.on("data",consume);socket.on("error",error=>finish({ok:false,message:error.message||String(error)}));socket.on("close",()=>{if(!settled)finish({ok:!!latestText,text:latestText,message:latestText?"":"流式连接提前关闭"});});if(head&&head.length)consume(head);socket.write(websocketFrame(frame(1,0,1,1,Buffer.from(JSON.stringify(request))),2));});req.on("response",response=>finish({ok:false,message:"流式 WebSocket 握手失败（HTTP "+response.statusCode+"）"}));req.on("error",error=>finish({ok:false,message:error.message||String(error)}));req.end();});}',
  'process.stdin.on("end",async()=>{try{const body=JSON.parse(input);const service=process.env.VOICE_VOLC_SERVICE;const result=service==="streaming"?await streaming(body):await recording(body,service);console.log(JSON.stringify(result));}catch(error){console.log(JSON.stringify({ok:false,message:error&&error.message?error.message:String(error)}));}});',
].join('')

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function transcribe(ctx, input) {
  const audioBase64 = typeof input.audioBase64 === 'string' ? input.audioBase64 : ''
  const authMode = input.authMode === 'legacy' ? 'legacy' : 'api-key'
  const service = ['streaming', 'recording-v1', 'recording-v2'].includes(input.service)
    ? input.service
    : 'recording-v2'
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  const appId = typeof input.appId === 'string' ? input.appId.trim() : ''
  const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : ''
  const language = input.language === 'en-US' ? 'en-US' : 'zh-CN'

  if (!audioBase64) return { ok: false, message: '没有收到可转写的 WAV 音频' }
  if (audioBase64.length > 28 * 1024 * 1024) {
    return { ok: false, message: '录音过长，请缩短到约 8 分钟以内再试' }
  }
  if (authMode === 'api-key' && !apiKey) {
    return { ok: false, message: '请填写火山引擎新版控制台 API Key' }
  }
  if (authMode === 'legacy' && (!appId || !accessToken)) {
    return { ok: false, message: '请填写火山引擎 App ID 和 Access Token' }
  }

  const requestBody = {
    user: { uid: authMode === 'api-key' ? 'dsh-voice-input' : appId },
    audio: { data: audioBase64, format: 'wav' },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      show_utterances: true,
    },
    language,
  }

  const command = 'node -e "eval(process.env.VOICE_VOLC_SCRIPT)"'
  const spec = ctx.shell.resolve({
    command,
    timeoutMs: 130000,
    stdoutMaxBytes: 2 * 1024 * 1024,
    stdin: JSON.stringify(requestBody),
    env: {
      VOICE_VOLC_SCRIPT: NODE_SCRIPT,
      VOICE_VOLC_SERVICE: service,
      VOICE_VOLC_AUTH_MODE: authMode,
      VOICE_VOLC_API_KEY: apiKey,
      VOICE_VOLC_APP_ID: appId,
      VOICE_VOLC_ACCESS_TOKEN: accessToken,
    },
  })
  const result = await ctx.shell.run(spec)
  const stdout = result && result.stdout && typeof result.stdout.text === 'string'
    ? result.stdout.text.trim()
    : ''
  const stderr = result && result.stderr && typeof result.stderr.text === 'string'
    ? result.stderr.text.trim()
    : ''

  if (result.exitCode !== 0) {
    return { ok: false, message: stderr || `火山引擎代理进程退出：${result.exitCode}` }
  }
  try {
    const parsed = JSON.parse(stdout)
    return {
      ok: parsed.ok === true,
      text: typeof parsed.text === 'string' ? parsed.text : '',
      statusCode: typeof parsed.apiStatus === 'string' ? parsed.apiStatus : '',
      message: typeof parsed.message === 'string' ? parsed.message : '',
      logId: typeof parsed.logId === 'string' ? parsed.logId : '',
    }
  } catch (error) {
    return { ok: false, message: '火山引擎代理返回了无法解析的结果' }
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/voice-input/transcribe',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        send(res, 405, { ok: false, message: 'method not allowed' })
        return
      }
      let input = {}
      try {
        input = JSON.parse(await readBody(req)) || {}
      } catch (error) {
        send(res, 400, { ok: false, message: 'invalid JSON body' })
        return
      }
      try {
        send(res, 200, await transcribe(ctx, input))
      } catch (error) {
        send(res, 500, { ok: false, message: error && error.message ? error.message : String(error) })
      }
    },
  }), 'voice-input: transcribe route')
}
