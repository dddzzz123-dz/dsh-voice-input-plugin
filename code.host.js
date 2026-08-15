/**
 * DSH Voice Input host half.
 *
 * Proxies Volcengine batch ASR so browser code never calls the provider
 * directly. Credentials are passed to one child process through its temporary
 * environment and are never logged or written to disk.
 */

return {
  inject: ['shell'],
  apply(ctx) {
    harness.handle('transcribe-volcengine', async (args) => {
      const input = args && typeof args === 'object' ? args : {}
      const audioBase64 = typeof input.audioBase64 === 'string' ? input.audioBase64 : ''
      const authMode = input.authMode === 'legacy' ? 'legacy' : 'api-key'
      const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
      const appId = typeof input.appId === 'string' ? input.appId.trim() : ''
      const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : ''

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
        audio: { data: audioBase64 },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: true,
          show_utterances: true,
        },
      }

      const nodeScript = [
        'let input="";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data",chunk=>input+=chunk);',
        'process.stdin.on("end",async()=>{',
        'try{',
        'const mode=process.env.VOICE_VOLC_AUTH_MODE;',
        'const headers={"Content-Type":"application/json","X-Api-Resource-Id":"volc.bigasr.auc_turbo","X-Api-Request-Id":crypto.randomUUID(),"X-Api-Sequence":"-1"};',
        'if(mode==="legacy"){headers["X-Api-App-Key"]=process.env.VOICE_VOLC_APP_ID;headers["X-Api-Access-Key"]=process.env.VOICE_VOLC_ACCESS_TOKEN;}else{headers["X-Api-Key"]=process.env.VOICE_VOLC_API_KEY;}',
        'const response=await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash",{method:"POST",headers,body:input});',
        'const raw=await response.text();',
        'let body=null;try{body=JSON.parse(raw);}catch(error){}',
        'const apiStatus=response.headers.get("x-api-status-code")||"";',
        'const message=response.headers.get("x-api-message")||"";',
        'const logId=response.headers.get("x-tt-logid")||"";',
        'const text=body&&body.result&&typeof body.result.text==="string"?body.result.text:"";',
        'console.log(JSON.stringify({ok:response.ok&&apiStatus==="20000000",httpStatus:response.status,apiStatus,message,logId,text}));',
        '}catch(error){console.log(JSON.stringify({ok:false,message:error&&error.message?error.message:String(error)}));}',
        '});',
      ].join('')

      const command = `node -e '${nodeScript}'`
      const spec = ctx.shell.resolve({
        command,
        timeoutMs: 120000,
        stdoutMaxBytes: 2 * 1024 * 1024,
        stdin: JSON.stringify(requestBody),
        env: {
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
    })
  },
}
