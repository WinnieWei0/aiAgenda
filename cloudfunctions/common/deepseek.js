const https = require('https');

/**
 * 方法是什么：向 HTTPS 接口发送 JSON 请求。
 * 方法作用：使用 Node 原生模块调用 DeepSeek 的 OpenAI 兼容接口，并支持主动超时。
 * 为什么添加：外部 AI 请求需要明确的 15 秒上限，避免网络异常时无限等待。
 */
function postJson(url, headers, body, timeoutMs) {
  return new Promise(function createRequest(resolve, reject) {
    const payload = JSON.stringify(body);
    const target = new URL(url);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          headers || {}
        )
      },
      /**
       * 方法是什么：处理 DeepSeek HTTPS 响应流。
       * 方法作用：收集响应片段并在结束后解析为 JSON。
       * 为什么添加：Node 原生请求以流形式返回数据，需要显式拼接和错误判断。
       */
      function handleResponse(res) {
        let data = '';
        res.on('data', function handleChunk(chunk) {
          data += chunk;
        });
        res.on('end', function handleEnd() {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`DeepSeek 请求失败：${res.statusCode} ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    if (timeoutMs > 0) {
      req.setTimeout(timeoutMs, function handleTimeout() {
        req.destroy(new Error(`DeepSeek 请求超过 ${timeoutMs}ms`));
      });
    }
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * 方法是什么：构造 DeepSeek 解析接龙的系统提示词。
 * 方法作用：明确要求模型只输出议程结构 JSON，不输出解释性文本。
 * 为什么添加：AI 输出必须能被云函数稳定解析，提示词需要强约束字段和格式。
 */
function buildAgendaPrompt() {
  return [
    '你是广州双语国际演讲俱乐部的议程助理。',
    '请把用户提供的微信群接龙文本解析成 JSON。',
    '只能输出 JSON，不要输出 Markdown 或解释。',
    'JSON 字段包括 meetingInfo、roles、preparedSpeeches、participants、nextMeeting、confidence。',
    'preparedSpeeches 数组字段包括 index、speakerRawName、projectCode、evaluatorRawName、title。',
    'roles 使用 key 到对象的映射，对象字段包括 key、titleZh、titleEn、rawName。',
    '不要虚构 Pathways 描述，项目描述会由系统根据 projectCode 再匹配。'
  ].join('\n');
}

/**
 * 方法是什么：调用 DeepSeek 解析接龙文本。
 * 方法作用：把非结构化接龙交给大模型理解，并返回模型生成的 JSON 对象。
 * 为什么添加：接龙内容可能出现省略、昵称和自然语言变体，AI 能补足规则解析不擅长的语义理解。
 */
async function parseAgendaWithDeepSeek(rawText, options) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const error = new Error('未配置 DEEPSEEK_API_KEY，无法使用 DeepSeek 解析');
    error.code = 'DEEPSEEK_NOT_CONFIGURED';
    throw error;
  }
  const requestOptions = options || {};
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const response = await postJson(
    'https://api.deepseek.com/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      messages: [
        { role: 'system', content: buildAgendaPrompt() },
        { role: 'user', content: rawText }
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      stream: false
    },
    Number(requestOptions.timeoutMs || 0)
  );
  const content = response && response.choices && response.choices[0] && response.choices[0].message
    ? response.choices[0].message.content
    : '';
  if (!content) {
    return null;
  }
  return JSON.parse(content);
}

module.exports = {
  postJson,
  buildAgendaPrompt,
  parseAgendaWithDeepSeek
};
