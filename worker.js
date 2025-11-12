const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

const NOTIFY_INTERVAL = 3600 * 1000;
const fraudDb = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/notification.txt'
const startMsgUrl = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/startMessage.md';

const enable_notification = true
const KEYWORD_FILTERS_KEY = 'keyword_filters';
// 默认的屏蔽关键词列表
const DEFAULT_KEYWORDS = ['领钱', '充值', '担保', '回馈客户', '彩金','协议','手续费','合作共赢'];

/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl (methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null){
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body){
  return {
    method:'POST',
    headers:{
      'content-type':'application/json'
    },
    body:JSON.stringify(body)
  }
}

function sendMessage(msg = {}){
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}){
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg){
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

/**
 * 获取关键字过滤列表
 */
async function getKeywordFilters() {
  try {
    const keywords = await nfd.get(KEYWORD_FILTERS_KEY, 'json');
    // 只有当keywords不存在或不是数组时，才初始化默认关键字
    if (!keywords || !Array.isArray(keywords)) {
      await nfd.put(KEYWORD_FILTERS_KEY, JSON.stringify(DEFAULT_KEYWORDS));
      return DEFAULT_KEYWORDS;
    }
    return keywords;
  } catch (error) {
    console.error('获取关键字列表失败:', error);
    // 错误情况下也不应该重置现有数据，只返回默认值供本次使用
    return DEFAULT_KEYWORDS;
  }
}

/**
 * 检查消息是否包含屏蔽关键字
 */
async function containsBlockedKeyword(message) {
  if (!message || !message.text) return false;
  
  const keywords = await getKeywordFilters();
  const lowerText = message.text.toLowerCase();
  
  return keywords.some(keyword => 
    lowerText.includes(keyword.toLowerCase())
  );
}

/**
 * 添加屏蔽关键字
 */
async function addKeywordFilter(keyword) {
  const keywords = await getKeywordFilters();
  if (!keywords.includes(keyword)) {
    keywords.push(keyword);
    await nfd.put(KEYWORD_FILTERS_KEY, JSON.stringify(keywords));
    return true;
  }
  return false;
}

/**
 * 删除屏蔽关键字
 */
async function removeKeywordFilter(keyword) {
  const keywords = await getKeywordFilters();
  const index = keywords.indexOf(keyword);
  if (index > -1) {
    keywords.splice(index, 1);
    await nfd.put(KEYWORD_FILTERS_KEY, JSON.stringify(keywords));
    return true;
  }
  return false;
}

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook (event) {
  // Check secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  // Read request body synchronously
  const update = await event.request.json()
  // Deal with response asynchronously
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

/**
 * Handle incoming Update
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate (update) {
  if ('message' in update) {
    await onMessage(update.message)
  }
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
async function onMessage (message) {
  if(message.text === '/start'){
    let startMsg = await fetch(startMsgUrl).then(r => r.text())
    return sendMessage({
      chat_id:message.chat.id,
      text:startMsg,
    })
  }
  // 在onMessage函数中添加/listblocked命令处理
  if(message.chat.id.toString() === ADMIN_UID){
        if(!message?.reply_to_message?.chat){
          // 检查是否是关键词管理命令
          if(message.text.startsWith('/keywords')) {
            return showKeywords(message);
          }
          if(message.text.startsWith('/addkeyword ')) {
            const keyword = message.text.substring(12).trim();
            return handleAddKeyword(message, keyword);
          }
          if(message.text.startsWith('/removekeyword ')) {
            const keyword = message.text.substring(15).trim();
            return handleRemoveKeyword(message, keyword);
          }
          if(message.text === '/listblocked') {
            return listBlockedUsers(message);
          }
          return sendMessage({
            chat_id:ADMIN_UID,
            text:'使用方法，回复转发的消息，并发送回复消息，或者`/block`、`/unblock`、`/checkblock`等指令\n\n关键词管理命令：\n- /keywords - 查看所有屏蔽关键字\n- /addkeyword 关键字1,关键字2 - 添加屏蔽关键字（支持英文逗号分隔多个）\n- /removekeyword 关键字 - 删除屏蔽关键字\n- /listblocked - 查看所有被屏蔽的用户'
          })
        }
    if(/^\/block$/.exec(message.text)){
      return handleBlock(message)
    }
    if(/^\/unblock$/.exec(message.text)){
      return handleUnBlock(message)
    }
    if(/^\/checkblock$/.exec(message.text)){
      return checkBlock(message)
    }
    let guestChantId = await nfd.get('msg-map-' + message?.reply_to_message.message_id,
                                      { type: "json" })
    return copyMessage({
      chat_id: guestChantId,
      from_chat_id:message.chat.id,
      message_id:message.message_id,
    })
  }
  return handleGuestMessage(message)
}

async function handleGuestMessage(message){
  let chatId = message.chat.id;
  let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" })
  
  if(isblocked){
    return sendMessage({
      chat_id: chatId,
      text:'Your are blocked'
    })
  }
  
  // 检查消息是否包含屏蔽关键字
  if (await containsBlockedKeyword(message)) {
    // 自动屏蔽用户
    await nfd.put('isblocked-' + chatId, true);
    
    // 通知管理员
    await sendMessage({
      chat_id: ADMIN_UID,
      text: `用户 UID:${chatId} 因发送包含屏蔽关键词的消息被自动屏蔽\n消息内容: ${message.text}`
    });
    
    // 通知用户
    return sendMessage({
      chat_id: chatId,
      text: 'Your are blocked for sending inappropriate content.'
    });
  }

  let forwardReq = await forwardMessage({
    chat_id:ADMIN_UID,
    from_chat_id:message.chat.id,
    message_id:message.message_id
  })
  console.log(JSON.stringify(forwardReq))
  if(forwardReq.ok){
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)
  }
  return handleNotify(message)
}

async function handleNotify(message){
  // 先判断是否是诈骗人员，如果是，则直接提醒
  // 如果不是，则根据时间间隔提醒：用户id，交易注意点等
  let chatId = message.chat.id;
  if(await isFraud(chatId)){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:`检测到骗子，UID${chatId}`
    })
  }
  if(enable_notification){
    let lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" })
    if(!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL){
      await nfd.put('lastmsg-' + chatId, Date.now())
      return sendMessage({
        chat_id: ADMIN_UID,
        text:await fetch(notificationUrl).then(r => r.text())
      })
    }
  }
}

async function handleBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
                                      { type: "json" })
  if(guestChantId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  await nfd.put('isblocked-' + guestChantId, true)

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}屏蔽成功`,
  })
}

async function handleUnBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })

  await nfd.put('isblocked-' + guestChantId, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`UID:${guestChantId}解除屏蔽成功`,
  })
}

async function checkBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })
  let blocked = await nfd.get('isblocked-' + guestChantId, { type: "json" })

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}` + (blocked ? '被屏蔽' : '没有被屏蔽')
  })
}

/**
 * 显示所有屏蔽关键字
 */
async function showKeywords(message) {
  const keywords = await getKeywordFilters();
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `当前屏蔽的关键字列表:\n${keywords.length > 0 ? keywords.join('\n') : '暂无屏蔽关键字'}`
  });
}

/**
 * 处理添加关键字命令
 */
async function handleAddKeyword(message, keyword) {
  if (!keyword) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '请提供要添加的关键字，格式: /addkeyword 关键字1,关键字2,关键字3'
    });
  }
  
  try {
    // 支持通过英文逗号分隔多个关键字
    const keywords = keyword.split(',').map(k => k.trim()).filter(k => k);
    let addedCount = 0;
    let existingCount = 0;
    
    // 先获取当前的关键字列表
    const currentKeywords = await getKeywordFilters();
    const updatedKeywords = [...currentKeywords];
    
    // 处理每个关键字
    for (const kw of keywords) {
      if (!updatedKeywords.includes(kw)) {
        updatedKeywords.push(kw);
        addedCount++;
      } else {
        existingCount++;
      }
    }
    
    // 一次性更新所有关键字，避免多次调用nfd.put
    if (addedCount > 0) {
      await nfd.put(KEYWORD_FILTERS_KEY, JSON.stringify(updatedKeywords));
    }
    
    let response = `添加结果：`;
    if (addedCount > 0) {
      response += `\n成功添加 ${addedCount} 个关键字`;
    }
    if (existingCount > 0) {
      response += `\n${existingCount} 个关键字已存在`;
    }
    
    return sendMessage({
      chat_id: ADMIN_UID,
      text: response
    });
  } catch (error) {
    console.error('添加关键字失败:', error);
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '添加关键字时发生错误，请稍后再试'
    });
  }
}

/**
 * 处理删除关键字命令
 */
async function handleRemoveKeyword(message, keyword) {
  if (!keyword) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '请提供要删除的关键字，格式: /removekeyword 关键字'
    });
  }
  
  const success = await removeKeywordFilter(keyword);
  return sendMessage({
    chat_id: ADMIN_UID,
    text: success ? `关键字 "${keyword}" 删除成功` : `关键字 "${keyword}" 不存在`
  });
}

/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText (chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  })
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook (event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook (event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function isFraud(id){
  id = id.toString()
  let db = await fetch(fraudDb).then(r => r.text())
  let arr = db.split('\n').filter(v => v)
  console.log(JSON.stringify(arr))
  let flag = arr.filter(v => v === id).length !== 0
  console.log(flag)
  return flag
}


// 在文件末尾、isFraud函数之前添加listBlockedUsers函数
/**
 * 列出所有被屏蔽的用户
 */
async function listBlockedUsers(message) {
  try {
    // 在Cloudflare Workers环境中，我们需要使用KV的list方法
    // 这里我们查找所有以isblocked-开头的键
    const blockedUsers = [];
    
    // 由于KV API限制，我们需要获取所有可能的键并检查值
    // 这里使用分页方式列出所有键
    let cursor = undefined;
    do {
      const listResult = await nfd.list({
        prefix: 'isblocked-',
        cursor: cursor
      });
      
      // 遍历所有找到的键，检查值是否为true（表示被屏蔽）
      for (const key of listResult.keys) {
        const value = await nfd.get(key.name, { type: "json" });
        if (value === true) {
          // 从键名中提取用户ID（去掉isblocked-前缀）
          const userId = key.name.replace('isblocked-', '');
          blockedUsers.push(userId);
        }
      }
      
      cursor = listResult.cursor;
    } while (cursor);
    
    // 返回结果给管理员
    return sendMessage({
      chat_id: ADMIN_UID,
      text: blockedUsers.length > 0 
        ? `当前被屏蔽的用户列表（共${blockedUsers.length}人）：\n${blockedUsers.join('\n')}`
        : '当前没有被屏蔽的用户'
    });
  } catch (error) {
    console.error('获取被屏蔽用户列表失败:', error);
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '获取被屏蔽用户列表时发生错误'
    });
  }
}