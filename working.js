const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -  
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

// Webhook注册状态键名
const WEBHOOK_REGISTERED_KEY = 'webhook_registered';
// Webhook检查间隔（毫秒），设置为1小时检查一次
const WEBHOOK_CHECK_INTERVAL = 3600 * 1000;

const NOTIFY_INTERVAL = 3600 * 1000;
const fraudDb = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/notification.txt'
// 注释掉startMsgUrl以匹配原来的working.js设置
// const startMsgUrl = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/startMessage.md';

const enable_notification = false // 保持与原working.js一致
const KEYWORD_FILTERS_KEY = 'keyword_filters';
// 默认的屏蔽关键词列表
const DEFAULT_KEYWORDS = ['领钱', '充值', '担保', '回馈客户', '彩金','协议','手续费','合作共赢'];
const ADMIN_NOTIFICATIONS_KEY = 'admin_notifications';
const NOTIFICATION_EXPIRY_HOURS = 0.5; // 消息过期时间：0.01小时（约36秒）
const WHITELIST_KEY = 'user_whitelist'; // 白名单存储键名
// 存储被屏蔽用户详细信息的键名前缀
const BLOCKED_USER_INFO_PREFIX = 'blocked-user-info-';
// 存储被屏蔽用户索引的键名
const BLOCKED_USERS_INDEX_KEY = 'blocked-users-index';
// 分页大小
const PAGE_SIZE = 10;

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
 * 编辑消息文本
 * @param {Object} options 编辑消息选项
 * @returns {Promise<Object>} Telegram API响应
 */
function editMessageText(options) {
  return requestTelegram('editMessageText', makeReqBody(options))
}

/**
 * 获取关键字过滤列表
 */
async function getKeywordFilters() {
  try {
    // 使用绑定的nfd命名空间
    const keywords = await nfd.get(KEYWORD_FILTERS_KEY, 'json');
    // 只有当keywords不存在或不是数组时，才初始化默认关键字
    if (!keywords || !Array.isArray(keywords)) {
      await nfd.put(KEYWORD_FILTERS_KEY, JSON.stringify(DEFAULT_KEYWORDS));
      return DEFAULT_KEYWORDS;
    }
    return keywords;
  } catch (error) {
    // 错误情况下也不应该重置现有数据，只返回默认值供本次使用
    return DEFAULT_KEYWORDS;
  }
}

/**
 * 检查消息是否包含屏蔽关键字，并返回违规行信息
 * @returns {Object} {isBlocked: boolean, violatingLines: string[], matchedKeywords: string[]}
 */
async function containsBlockedKeyword(message) {
  if (!message || !message.text) {
    return { isBlocked: false, violatingLines: [], matchedKeywords: [] };
  }
  
  const keywords = await getKeywordFilters();
  const lines = message.text.split('\n');
  const violatingLines = [];
  const matchedKeywords = [];
  
  // 检查每一行是否包含违规关键字
  lines.forEach(line => {
    const lowerLine = line.toLowerCase();
    keywords.forEach(keyword => {
      if (lowerLine.includes(keyword.toLowerCase())) {
        violatingLines.push(line);
        if (!matchedKeywords.includes(keyword)) {
          matchedKeywords.push(keyword);
        }
      }
    });
  });
  
  return {
    isBlocked: violatingLines.length > 0,
    violatingLines: [...new Set(violatingLines)], // 去重
    matchedKeywords: [...new Set(matchedKeywords)] // 去重
  };
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
 * 获取白名单用户列表
 */
async function getWhitelist() {
  try {
    const whitelist = await nfd.get(WHITELIST_KEY, { type: 'json' });
    // 如果白名单不存在或不是数组，初始化一个空数组
    if (!whitelist || !Array.isArray(whitelist)) {
      await nfd.put(WHITELIST_KEY, JSON.stringify([]));
      return [];
    }
    return whitelist;
  } catch (error) {
    return [];
  }
}

/**
 * 检查用户是否在白名单中
 * @param {number|string} userId 用户ID
 * @returns {boolean} 是否在白名单中
 */
async function isInWhitelist(userId) {
  try {
    const whitelist = await getWhitelist();
    const stringUserId = String(userId);
    return whitelist.includes(stringUserId);
  } catch (error) {
    return false;
  }
}

/**
 * 添加用户到白名单
 * @param {number|string} userId 用户ID
 * @returns {Array} 更新后的白名单
 */
async function addToWhitelist(userId) {
  try {
    const whitelist = await getWhitelist();
    const stringUserId = String(userId);
    
    // 如果用户不在白名单中，则添加
    if (!whitelist.includes(stringUserId)) {
      whitelist.push(stringUserId);
      await nfd.put(WHITELIST_KEY, JSON.stringify(whitelist));
    }
    
    return whitelist;
  } catch (error) {
    return await getWhitelist();
  }
}

/**
 * 从白名单中移除用户
 * @param {number|string} userId 用户ID
 * @returns {Array} 更新后的白名单
 */
async function removeFromWhitelist(userId) {
  try {
    let whitelist = await getWhitelist();
    const stringUserId = String(userId);
    
    // 过滤掉要删除的用户
    whitelist = whitelist.filter(id => id !== stringUserId);
    await nfd.put(WHITELIST_KEY, JSON.stringify(whitelist));
    
    return whitelist;
  } catch (error) {
    return await getWhitelist();
  }
}

/**
 * 获取被屏蔽用户索引列表
 * @returns {Array} 屏蔽用户索引数组
 */
async function getBlockedUsersIndex() {
  try {
    const index = await nfd.get(BLOCKED_USERS_INDEX_KEY, { type: 'json' });
    
    // 如果索引不存在或不是数组，初始化一个空数组
    if (!index || !Array.isArray(index)) {
      await nfd.put(BLOCKED_USERS_INDEX_KEY, JSON.stringify([]));
      return [];
    }
    
    return index;
  } catch (error) {
    return [];
  }
}

/**
 * 显示白名单内容
 * @param {Object} message Telegram消息对象
 */
async function showWhitelist(message) {
  return listWhitelist(message);
}

/**
 * 列出白名单用户（支持分页）
 * @param {Object} message Telegram消息对象
 * @param {number} page 页码，默认为1
 * @param {number} messageId 消息ID，用于编辑消息
 */
async function listWhitelist(message, page = 1, messageId = null) {
  try {
    // 获取白名单数据
    const whitelist = await getWhitelist();
    
    // 每页显示的用户数量
    const itemsPerPage = 10;
    
    // 计算总页数
    const totalPages = Math.max(1, Math.ceil(whitelist.length / itemsPerPage));
    
    // 确保页码在有效范围内
    page = Math.min(Math.max(1, parseInt(page) || 1), totalPages);
    
    // 计算当前页的数据范围
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, whitelist.length);
    
    // 获取当前页的数据
    const currentPageUsers = whitelist.slice(startIndex, endIndex);
    
    // 构建消息文本
    let text = '当前白名单用户ID列表\n\n';
    
    if (whitelist.length === 0) {
      text = '当前白名单为空';
    } else {
      // 构建分页数据显示
      for (let i = 0; i < currentPageUsers.length; i++) {
        const userId = currentPageUsers[i];
        const index = startIndex + i + 1;
        text += `${index}. ${userId}\n`;
      }
      
      // 添加分页信息
      text += `\n第 ${page}/${totalPages} 页 (共 ${whitelist.length} 个用户)`;
    }
    
    // 构建内联键盘
    let inlineKeyboard = [];
    
    // 只有当总页数大于1时才显示分页按钮
    if (totalPages > 1) {
      const buttons = [];
      
      // 添加上一页按钮
      if (page > 1) {
        buttons.push({
          text: '上一页',
          callback_data: `whitelist_page:${page - 1}`
        });
      }
      
      // 添加下一页按钮
      if (page < totalPages) {
        buttons.push({
          text: '下一页',
          callback_data: `whitelist_page:${page + 1}`
        });
      }
      
      inlineKeyboard.push(buttons);
    }
    
    // 检查是否是分页导航回调
    const isPaginationCallback = message.callback_query || 
                              (message.text && message.text.startsWith('whitelist_page:'));
    
    // 如果是分页导航且有消息ID，则优先编辑原消息
    if (isPaginationCallback && messageId) {
      try {
        const editOptions = {
          chat_id: message.chat ? message.chat.id : message.callback_query.from.id,
          message_id: messageId,
          text: text
        };
        
        // 如果有内联键盘，则添加到编辑选项中
        if (inlineKeyboard.length > 0) {
          editOptions.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
        }
        
        // 执行编辑消息
        const editResult = await editMessageText(editOptions);
        
        return editResult;
      } catch (editError) {
        // 编辑失败时，继续执行发送新消息的逻辑
      }
    }
    
    // 发送新消息（初始请求或编辑失败时）
    try {
      const sendOptions = {
        chat_id: message.chat ? message.chat.id : message.callback_query.from.id,
        text: text
      };
      
      // 如果有内联键盘，则添加到发送选项中
      if (inlineKeyboard.length > 0) {
        sendOptions.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
      }
      
      // 执行发送消息
      const sendResult = await sendMessage(sendOptions);
      
      return sendResult;
    } catch (sendError) {
      throw sendError;
    }
  } catch (error) {
    return sendMessage({
      chat_id: message.chat ? message.chat.id : message.callback_query.from.id,
      text: '显示白名单失败，请稍后再试'
    });
  }
}

/**
 * 自动注册Webhook的功能函数
 */
async function autoRegisterWebhook(requestUrl) {
  try {
    // 检查Webhook是否已经注册或注册时间是否超过检查间隔
    const lastRegistered = await nfd.get(WEBHOOK_REGISTERED_KEY, { type: "json" });
    const currentTime = Date.now();
    
    // 如果没有注册记录，或者距离上次注册已超过检查间隔，则重新注册
    if (!lastRegistered || (currentTime - lastRegistered) > WEBHOOK_CHECK_INTERVAL) {

      const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${WEBHOOK}`;
      const response = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: SECRET }))).json();
      
      if (response.ok) {
        // 记录注册成功的时间戳
        await nfd.put(WEBHOOK_REGISTERED_KEY, currentTime);

      } else {

      }
    }
  } catch (error) {
    }
}

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  
  // 自动注册Webhook（不阻塞主要请求处理）
  if (url.pathname !== WEBHOOK) { // 避免在Webhook回调中触发，防止循环
    event.waitUntil(autoRegisterWebhook(url));
  }
  
  // 原有路由处理逻辑
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    // 首次访问任何非特定路径时，也返回简单的确认信息
    event.respondWith(new Response('Bot is running. Webhook registration is automatic.'))
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

  // 检查并删除过期的管理员通知消息
  event.waitUntil(deleteExpiredNotifications());

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
  } else if ('callback_query' in update) {
    // 处理内联按钮回调
    const callbackQuery = update.callback_query;
    const data = callbackQuery.data;
    
    // 创建通用的模拟消息对象，包含原始消息ID以便更新
    const mockMessage = {
      chat: { id: callbackQuery.message.chat.id },
      text: data,
      message_id: callbackQuery.message.message_id // 添加原始消息ID
    };
    
    // 处理屏蔽名单分页导航的回调
    if (data.startsWith('/listblocked ')) {
      // 调用listBlockedUsers函数
      await listBlockedUsers(mockMessage);
    }
    // 处理白名单分页导航的回调
    else if (data.startsWith('whitelist_page:')) {
      // 提取页码
      const page = data.split(':')[1];
      // 调用listWhitelist函数
      await listWhitelist(mockMessage, page, callbackQuery.message.message_id);
    }
    // 处理屏蔽关键字分页导航的回调
    else if (data.startsWith('keywords_page:')) {
      // 提取页码
      const page = data.split(':')[1];
      // 调用listKeywords函数
      await listKeywords(mockMessage, page, callbackQuery.message.message_id);
    }
    
    // 回复callback_query以避免用户看到加载指示器
    await requestTelegram('answerCallbackQuery', makeReqBody({
      callback_query_id: callbackQuery.id
    }));
  }
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
async function onMessage (message) {

  
  if(message.text === '/start'){
    // 由于startMsgUrl被注释，这里返回一个简单的欢迎消息
    return sendMessage({
      chat_id:message.chat.id,
      text:'欢迎使用ChatSecretary | 技术支持助手机器人！',
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
          if(message.text.startsWith('/listblocked')) {
            return listBlockedUsers(message);
          }
          // 白名单管理命令
          if(message.text === '/whitelist') {
            return showWhitelist(message);
          }
          if(message.text.startsWith('/addwhitelist ')) {
            const userId = message.text.substring(13).trim();
            await addToWhitelist(userId);
            return sendMessage({
              chat_id: message.chat.id,
              text: `用户 ${userId} 已添加到白名单`
            });
          }
          if(message.text.startsWith('/removewhitelist ')) {
            const userId = message.text.substring(17).trim();
            await removeFromWhitelist(userId);
            return sendMessage({
              chat_id: message.chat.id,
              text: `用户 ${userId} 已从白名单中移除`
            });
          }
          // 支持直接通过ID屏蔽用户
          if(message.text.startsWith('/block ') && !message.reply_to_message) {
            const userId = message.text.substring(7).trim();
            if(/^\d+$/.test(userId)) {
              // 创建模拟消息对象以调用handleBlockById函数
              const mockMessage = { ...message, text: '/block', targetUserId: userId };
              return handleBlockById(mockMessage);
            }
            return sendMessage({
              chat_id: message.chat.id,
              text: '请提供有效的用户ID（纯数字）'
            });
          }
          // 支持直接通过ID解除屏蔽
          if(message.text.startsWith('/unblock ') && !message.reply_to_message) {
            const userId = message.text.substring(9).trim();
            if(/^\d+$/.test(userId)) {
              // 创建模拟消息对象以调用handleUnBlockById函数
              const mockMessage = { ...message, text: '/unblock', targetUserId: userId };
              return handleUnBlockById(mockMessage);
            }
            return sendMessage({
              chat_id: message.chat.id,
              text: '请提供有效的用户ID（纯数字）'
            });
          }
          return sendMessage({
            chat_id:ADMIN_UID,
            text:'使用方法，回复转发的消息，并发送回复消息，或者使用以下命令：\n\n基础命令：\n- /block - 屏蔽用户（回复消息）\n- /block 用户ID - 直接通过ID屏蔽用户\n- /unblock - 解除屏蔽（回复消息）\n- /unblock 用户ID - 直接通过ID解除屏蔽\n- /checkblock - 检查用户是否被屏蔽\n- /listblocked - 查看所有被屏蔽的用户\n\n关键词管理：\n- /keywords - 查看所有屏蔽关键字\n- /addkeyword 关键字1,关键字2 - 添加屏蔽关键字（支持英文逗号分隔多个）\n- /removekeyword 关键字 - 删除屏蔽关键字\n\n白名单管理：\n- /whitelist - 查看白名单用户列表\n- /addwhitelist 用户ID - 添加用户到白名单\n- /removewhitelist 用户ID - 从白名单中移除用户'
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
  
  // 检查用户是否在白名单中
  const isWhitelisted = await isInWhitelist(chatId);
  
  // 检查消息是否包含屏蔽关键字（白名单用户不受限制）
  const keywordCheck = !isWhitelisted && await containsBlockedKeyword(message);
  if (keywordCheck && keywordCheck.isBlocked) {
    // 自动屏蔽用户
    await nfd.put('isblocked-' + chatId, true);
    
    // 获取被屏蔽用户的名称
    let userName = '未知用户';
    let userType = 'user';
    
    // 处理转发消息
    if (message.forward_from_chat) {
      // 转发自频道
      userType = 'channel';
      userName = message.forward_from_chat.title || '未知频道';
    } else if (message.forward_from) {
      // 转发自用户
      const forwardUser = message.forward_from;
      userName = `${forwardUser.first_name || ''} ${forwardUser.last_name || ''}`.trim() || '未知用户';
    } else {
      // 从消息文本中解析通过机器人转发的情况
      const messageText = message.text || '';
      const forwardedMatch = messageText.match(/^转发自([^通过]+)通过@/);
      if (forwardedMatch && forwardedMatch[1]) {
        userName = forwardedMatch[1].trim();
      } else {
        // 普通情况
        userName = message.from ? `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim() : '未知用户';
      }
    }
    
    // 创建屏蔽用户信息对象
    const blockInfo = {
      userId: chatId,
      userName: userName,
      userType: userType,
      blockedAt: Date.now(),
      blockingReason: '自动屏蔽（包含关键词）',
      matchedKeywords: keywordCheck.matchedKeywords,
      violatingLines: keywordCheck.violatingLines
    };
    
    // 存储用户详细信息
    await nfd.put(BLOCKED_USER_INFO_PREFIX + chatId, JSON.stringify(blockInfo));
    
    // 更新屏蔽用户索引
    const blockedUsersIndex = await getBlockedUsersIndex();
    const existingIndex = blockedUsersIndex.findIndex(item => item.userId === chatId);
    if (existingIndex === -1) {
      blockedUsersIndex.push({
        userId: chatId,
        blockedAt: Date.now()
      });
      await nfd.put(BLOCKED_USERS_INDEX_KEY, JSON.stringify(blockedUsersIndex));
    }
    
    // 通知管理员，只包含违规行而不是完整内容
    const violatingLinesText = keywordCheck.violatingLines.map(line => `"${line}"`).join('\n');
    const matchedKeywordsText = keywordCheck.matchedKeywords.join('、');
    
    // 发送消息并保存消息ID用于后续删除
    const messageResponse = await sendMessage({
      chat_id: ADMIN_UID,
      text: `用户 UID:${chatId} 因发送包含屏蔽关键词的消息被自动屏蔽\n\n违规内容:\n${violatingLinesText}\n\n触发的关键字: ${matchedKeywordsText}`
    });
    
    // 如果消息发送成功，保存消息ID和过期时间
    if (messageResponse && messageResponse.ok) {
      await saveAdminNotification(messageResponse.result.message_id, ADMIN_UID);
    }
    
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

  if(forwardReq.ok){
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)
  }
  return handleNotify(message)
}

/**
 * 保存管理员通知消息信息，用于后续删除
 * @param {number} messageId 消息ID
 * @param {number} chatId 聊天ID
 */
async function saveAdminNotification(messageId, chatId) {
  try {
    // 获取当前存储的所有通知
    let notifications = await nfd.get(ADMIN_NOTIFICATIONS_KEY, { type: 'json' }) || [];
    
    // 计算过期时间（当前时间 + 24小时）
    const expiryTime = Date.now() + (NOTIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);
    
    // 添加新通知
    notifications.push({
      messageId: messageId,
      chatId: chatId,
      sentAt: Date.now(),
      expiryTime: expiryTime
    });
    
    // 保存更新后的通知列表
    await nfd.put(ADMIN_NOTIFICATIONS_KEY, JSON.stringify(notifications));
  } catch (error) {
  }
}

/**
 * 检查并删除过期的管理员通知消息
 */
async function deleteExpiredNotifications() {
  try {
    const currentTime = Date.now();
    let notifications = await nfd.get(ADMIN_NOTIFICATIONS_KEY, { type: 'json' }) || [];
    let activeNotifications = [];
    
    for (const notification of notifications) {
      // 如果消息已过期，则删除它
      if (notification.expiryTime <= currentTime) {
        // 尝试删除消息
        try {
          await requestTelegram('deleteMessage', makeReqBody({
            chat_id: notification.chatId,
            message_id: notification.messageId
          }));

        } catch (deleteError) {
          // 忽略删除失败的消息，例如消息可能已经被手动删除

        }
      } else {
        // 保留未过期的通知
        activeNotifications.push(notification);
      }
    }
    
    // 更新存储，只保留未过期的通知
    await nfd.put(ADMIN_NOTIFICATIONS_KEY, JSON.stringify(activeNotifications));
    
    return {
      totalChecked: notifications.length,
      deleted: notifications.length - activeNotifications.length
    };
  } catch (error) {
    return { error: error.message };
  }
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

// 处理直接通过用户ID解除屏蔽的函数
async function handleUnBlockById(message){
  const guestChantId = message.targetUserId;
  
  // 检查用户是否被屏蔽
  const isBlocked = await nfd.get('isblocked-' + guestChantId, { type: "json" });
  
  if(!isBlocked){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:`用户 ${guestChantId} 并未被屏蔽`
    })
  }
  
  // 解除屏蔽状态
  await nfd.put('isblocked-' + guestChantId, false);
  
  // 获取用户详细信息用于显示
  let userName = `用户ID: ${guestChantId}`;
  try {
    const blockInfoStr = await nfd.get(BLOCKED_USER_INFO_PREFIX + guestChantId);
    if (blockInfoStr) {
      const blockInfo = JSON.parse(blockInfoStr);
      userName = blockInfo.userName || userName;
    }
  } catch (error) {
    console.error('获取屏蔽用户信息失败:', error);
  }
  
  // 更新屏蔽用户索引（保留信息但标记为已解除屏蔽）
  const blockedUsersIndex = await getBlockedUsersIndex();
  const userIndex = blockedUsersIndex.findIndex(item => item.userId === guestChantId);
  if (userIndex !== -1) {
    blockedUsersIndex[userIndex].unblockedAt = Date.now();
    await nfd.put(BLOCKED_USERS_INDEX_KEY, JSON.stringify(blockedUsersIndex));
  }

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId} (${userName}) 解除屏蔽成功`,
  })
}

// 处理直接通过用户ID屏蔽用户的函数
async function handleBlockById(message){
  const guestChantId = message.targetUserId;
  
  if(guestChantId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  
  // 设置屏蔽状态
  await nfd.put('isblocked-' + guestChantId, true)
  
  // 创建屏蔽用户信息对象
  const blockInfo = {
    userId: guestChantId,
    userName: `用户ID: ${guestChantId}`,
    userType: 'user',
    blockedAt: Date.now(),
    blockingReason: '管理员手动通过ID屏蔽',
    matchedKeywords: []
  };
  
  // 存储用户详细信息
  await nfd.put(BLOCKED_USER_INFO_PREFIX + guestChantId, JSON.stringify(blockInfo));
  
  // 更新屏蔽用户索引
  const blockedUsersIndex = await getBlockedUsersIndex();
  if (!blockedUsersIndex.some(item => item.userId === guestChantId)) {
    blockedUsersIndex.push({
      userId: guestChantId,
      blockedAt: Date.now()
    });
    await nfd.put(BLOCKED_USERS_INDEX_KEY, JSON.stringify(blockedUsersIndex));
  }

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId} (用户ID: ${guestChantId}) 屏蔽成功`,
  })
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
  
  // 设置屏蔽状态
  await nfd.put('isblocked-' + guestChantId, true)
  
  // 获取被屏蔽用户的名称和类型
  let userName = '未知用户';
  let userType = 'user'; // 'user' 或 'channel'
  
  const replyMessage = message.reply_to_message;
  
  // 处理转发消息
  if (replyMessage.forward_from_chat) {
    // 转发自频道
    userType = 'channel';
    userName = replyMessage.forward_from_chat.title || '未知频道';
  } else if (replyMessage.forward_from) {
    // 转发自用户
    const forwardUser = replyMessage.forward_from;
    userName = `${forwardUser.first_name || ''} ${forwardUser.last_name || ''}`.trim() || '未知用户';
  } else {
    // 从消息文本中解析通过机器人转发的情况
    const messageText = replyMessage.text || '';
    const forwardedMatch = messageText.match(/^转发自([^通过]+)通过@/);
    if (forwardedMatch && forwardedMatch[1]) {
      userName = forwardedMatch[1].trim();
    } else {
      // 普通情况，使用原有的用户信息获取逻辑
       const guestUser = replyMessage.from;
       userName = guestUser ? `${guestUser.first_name || ''} ${guestUser.last_name || ''}`.trim() : '未知用户';
      }
  }
  
  // 创建屏蔽用户信息对象
  const blockInfo = {
    userId: guestChantId,
    userName: userName,
    userType: userType,
    blockedAt: Date.now(),
    blockingReason: '管理员手动屏蔽',
    matchedKeywords: []
  };
  
  // 存储用户详细信息
  await nfd.put(BLOCKED_USER_INFO_PREFIX + guestChantId, JSON.stringify(blockInfo));
  
  // 更新屏蔽用户索引
  const blockedUsersIndex = await getBlockedUsersIndex();
  if (!blockedUsersIndex.some(item => item.userId === guestChantId)) {
    blockedUsersIndex.push({
      userId: guestChantId,
      blockedAt: Date.now()
    });
    await nfd.put(BLOCKED_USERS_INDEX_KEY, JSON.stringify(blockedUsersIndex));
  }

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId} (${userName}) 屏蔽成功`,
  })
}

async function handleUnBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })

  // 解除屏蔽状态
  await nfd.put('isblocked-' + guestChantId, false)
  
  // 获取被解除屏蔽用户的名称
  let userName = '未知用户';
  const replyMessage = message.reply_to_message;
  
  // 处理转发消息
  if (replyMessage.forward_from_chat) {
    // 转发自频道
    userName = replyMessage.forward_from_chat.title || '未知频道';
  } else if (replyMessage.forward_from) {
    // 转发自用户
    const forwardUser = replyMessage.forward_from;
    userName = `${forwardUser.first_name || ''} ${forwardUser.last_name || ''}`.trim() || '未知用户';
  } else {
    // 从消息文本中解析通过机器人转发的情况
    const messageText = replyMessage.text || '';
    const forwardedMatch = messageText.match(/^转发自([^通过]+)通过@/);
    if (forwardedMatch && forwardedMatch[1]) {
      userName = forwardedMatch[1].trim();
    } else {
      // 普通情况，使用原有的用户信息获取逻辑
      const guestUser = replyMessage.from;
      userName = guestUser ? `${guestUser.first_name || ''} ${guestUser.last_name || ''}`.trim() : '未知用户';
    }
  }
  
  // 删除用户详细信息
  try {
    await nfd.delete(BLOCKED_USER_INFO_PREFIX + guestChantId);
    
    // 更新屏蔽用户索引
    const blockedUsersIndex = await getBlockedUsersIndex();
    const filteredIndex = blockedUsersIndex.filter(item => item.userId !== guestChantId);
    await nfd.put(BLOCKED_USERS_INDEX_KEY, JSON.stringify(filteredIndex));
  } catch (error) {
  }

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`UID:${guestChantId} (${userName}) 解除屏蔽成功`,
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
  return listKeywords(message);
}

/**
 * 列出屏蔽关键字（支持分页）
 * @param {Object} message Telegram消息对象
 * @param {number} page 页码，默认为1
 * @param {number} messageId 消息ID，用于编辑消息
 */
async function listKeywords(message, page = 1, messageId = null) {
  try {
    // 获取屏蔽关键字数据
    const keywords = await getKeywordFilters();
    
    // 每页显示的关键字数量
    const itemsPerPage = 20;
    
    // 计算总页数
    const totalPages = Math.max(1, Math.ceil(keywords.length / itemsPerPage));
    
    // 确保页码在有效范围内
    page = Math.min(Math.max(1, parseInt(page) || 1), totalPages);
    
    // 计算当前页的数据范围
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, keywords.length);
    
    // 获取当前页的数据
    const currentPageKeywords = keywords.slice(startIndex, endIndex);
    
    // 构建消息文本
    let text = '当前屏蔽的关键字列表\n\n';
    
    if (keywords.length === 0) {
      text = '暂无屏蔽关键字';
    } else {
      // 构建分页数据显示（2列布局）
      let twoColumnLayout = [];
      for (let i = 0; i < currentPageKeywords.length; i += 2) {
        const index1 = startIndex + i + 1;
        const keyword1 = currentPageKeywords[i];
        let line = `${index1}. ${keyword1}`;
        
        // 如果有第二列数据，则添加到同一行
        if (i + 1 < currentPageKeywords.length) {
          const index2 = startIndex + i + 2;
          const keyword2 = currentPageKeywords[i + 1];
          // 计算第一列的填充空格，使两列对齐
          const paddingSpaces = ' '.repeat(Math.max(0, 20 - keyword1.length));
          line += paddingSpaces + `  ${index2}. ${keyword2}`;
        }
        twoColumnLayout.push(line);
      }
      
      // 将两列布局转换为文本
      text += twoColumnLayout.join('\n');

      
      // 添加分页信息
      text += `\n第 ${page}/${totalPages} 页 (共 ${keywords.length} 个关键字)`;
    }
    
    // 构建内联键盘
    let inlineKeyboard = [];
    
    // 只有当总页数大于1时才显示分页按钮
    if (totalPages > 1) {
      const buttons = [];
      
      // 添加上一页按钮
      if (page > 1) {
        buttons.push({
          text: '上一页',
          callback_data: `keywords_page:${page - 1}`
        });
      }
      
      // 添加下一页按钮
      if (page < totalPages) {
        buttons.push({
          text: '下一页',
          callback_data: `keywords_page:${page + 1}`
        });
      }
      
      inlineKeyboard.push(buttons);
    }
    
    // 检查是否是分页导航回调
    const isPaginationCallback = message.callback_query || 
                              (message.text && message.text.startsWith('keywords_page:'));
    
    // 如果是分页导航且有消息ID，则优先编辑原消息
    if (isPaginationCallback && messageId) {
      try {
        const editOptions = {
          chat_id: message.chat ? message.chat.id : message.callback_query.from.id,
          message_id: messageId,
          text: text
        };
        
        // 如果有内联键盘，则添加到编辑选项中
        if (inlineKeyboard.length > 0) {
          editOptions.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
        }
        
        // 执行编辑消息
        const editResult = await editMessageText(editOptions);
        
        return editResult;
      } catch (editError) {
        // 编辑失败时，继续执行发送新消息的逻辑
      }
    }
    
    // 发送新消息（初始请求或编辑失败时）
    try {
      const sendOptions = {
        chat_id: message.chat ? message.chat.id : message.callback_query.from.id,
        text: text
      };
      
      // 如果有内联键盘，则添加到发送选项中
      if (inlineKeyboard.length > 0) {
        sendOptions.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
      }
      
      // 执行发送消息
      const sendResult = await sendMessage(sendOptions);
      
      return sendResult;
    } catch (sendError) {
      throw sendError;
    }
  } catch (error) {
    return sendMessage({
      chat_id: message.chat ? message.chat.id : message.callback_query.from.id,
      text: '显示关键字列表失败，请稍后再试'
    });
  }
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

/**
 * 列出所有被屏蔽的用户
 */
async function listBlockedUsers(message) {
  try {
    console.log('listBlockedUsers function called with message:', JSON.stringify(message));
    
    // 获取页码参数，默认为第1页
    let page = 1;
    const messageText = message.text || '';
    const pageMatch = messageText.match(/\s+(\d+)$/);
    if (pageMatch && pageMatch[1]) {
      page = parseInt(pageMatch[1], 10);
      if (page < 1) page = 1;
    }
    console.log(`请求的页码: ${page}`);
    
    // 提前声明内联键盘变量，避免后面引用未定义变量
    let inlineKeyboard = [];
    
    // 获取所有被屏蔽用户的索引
    console.log('开始获取被屏蔽用户索引...');
    let blockedUsersIndex = await getBlockedUsersIndex();
    console.log(`获取到的屏蔽用户索引数量: ${blockedUsersIndex.length}`);
    
    // 过滤出仍然被屏蔽的用户
    console.log('开始过滤仍然被屏蔽的用户...');
    const activeBlockedUsers = [];
    for (const indexItem of blockedUsersIndex) {
      const blockKey = 'isblocked-' + indexItem.userId;
      console.log(`检查用户${indexItem.userId}是否被屏蔽，键名: ${blockKey}`);
      try {
        const isBlocked = await nfd.get(blockKey, { type: "json" });
        console.log(`用户${indexItem.userId}屏蔽状态:`, isBlocked);
        if (isBlocked === true) {
          activeBlockedUsers.push(indexItem);
          console.log(`用户${indexItem.userId}已添加到活跃屏蔽列表`);
        }
      } catch (error) {
        console.error(`获取用户${indexItem.userId}屏蔽状态失败:`, error.message || error);
      }
    }
    console.log(`过滤后活跃屏蔽用户数量: ${activeBlockedUsers.length}`);
    
    // 按屏蔽时间倒序排序（最新的排在前面）
    activeBlockedUsers.sort((a, b) => b.blockedAt - a.blockedAt);
    
    // 计算分页信息
    const totalCount = activeBlockedUsers.length;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    const startIndex = (page - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, totalCount);
    const paginatedUsers = activeBlockedUsers.slice(startIndex, endIndex);
    
    console.log(`分页信息: 总数=${totalCount}, 总页数=${totalPages}, 当前页=${page}`);
    console.log(`当前页用户数量: ${paginatedUsers.length}`);
    
    // 获取当前页用户的详细信息
    console.log('开始获取当前页用户详细信息...');
    const blockedUsersWithDetails = [];
    for (const userIndex of paginatedUsers) {
      let userInfo = null;
      const userInfoKey = BLOCKED_USER_INFO_PREFIX + userIndex.userId;
      console.log(`获取用户${userIndex.userId}详细信息，键名: ${userInfoKey}`);
      try {
        userInfo = await nfd.get(userInfoKey, { type: "json" });
        console.log(`用户${userIndex.userId}详细信息:`, userInfo);
      } catch (error) {
        console.error(`获取用户${userIndex.userId}详细信息失败:`, error.message || error);
        console.error('错误堆栈:', error.stack);
      }
      
      const combinedUserInfo = {
        ...userIndex,
        ...(userInfo || { userName: '未知用户', matchedKeywords: [] })
      };
      blockedUsersWithDetails.push(combinedUserInfo);
      console.log(`用户${userIndex.userId}信息已添加到结果列表`);
    }
    console.log(`用户详细信息获取完成，共${blockedUsersWithDetails.length}条记录`);
    
    // 构建回复消息
    let responseText = '';
    if (totalCount === 0) {
      responseText = '当前没有被屏蔽的用户';
    } else {
      responseText = `当前被屏蔽的用户列表（共${totalCount}人，第${page}/${totalPages}页）：\n\n`;
      
      blockedUsersWithDetails.forEach((user, index) => {
        const displayIndex = startIndex + index + 1;
        // 格式化屏蔽时间
        const blockedTime = new Date(user.blockedAt).toLocaleString('zh-CN');
        // 获取关键字，只显示一行
        const keywordsText = user.matchedKeywords && user.matchedKeywords.length > 0
          ? ` [关键字: ${user.matchedKeywords.slice(0, 3).join(', ')}${user.matchedKeywords.length > 3 ? '...' : ''}]`
          : '';
        
        responseText += `${displayIndex}. ${user.userName || '未知用户'} (ID: ${user.userId}) - ${blockedTime}${keywordsText}\n`;
      });
      
      // 添加分页导航信息
        if (totalPages > 1) {
          // 构建内联键盘按钮
          inlineKeyboard = [];
          const row = [];
          
          if (page > 1) {
            row.push({
              text: '上一页',
              callback_data: `/listblocked ${page - 1}`
            });
          }
          
          if (page < totalPages) {
            row.push({
              text: '下一页',
              callback_data: `/listblocked ${page + 1}`
            });
          }
          
          if (row.length > 0) {
            inlineKeyboard.push(row);
          }
        }
    }
    
    // 更新或发送消息
    console.log('准备发送或更新消息...');
    const targetChatId = message.chat.id;
    
    // 检查是否是分页导航回调（通过callback_query或特定格式判断）
    // 对于分页导航，我们应该优先编辑现有消息
    const isPaginationCallback = message.callback_query || 
                                (messageText.startsWith('/listblocked') && messageText.match(/\s+\d+$/));
    console.log(`是否为分页导航回调: ${isPaginationCallback}`);
    
    // 如果是分页导航且有消息ID，优先编辑消息
    if (isPaginationCallback && message && message.message_id) {
      console.log('分页导航请求，优先尝试编辑消息');
      try {
        if (totalPages > 1) {
          const editResult = await requestTelegram('editMessageText', makeReqBody({
            chat_id: targetChatId,
            message_id: message.message_id,
            text: responseText,
            reply_markup: {
              inline_keyboard: inlineKeyboard
            }
          }));
          console.log(`更新消息结果:`, editResult);
          return editResult;
        } else {
          const editResult = await requestTelegram('editMessageText', makeReqBody({
            chat_id: targetChatId,
            message_id: message.message_id,
            text: responseText
          }));
          console.log(`更新消息结果:`, editResult);
          return editResult;
        }
      } catch (editError) {
        console.error('编辑消息失败，转为发送新消息:', editError);
        // 编辑失败后，回退到发送新消息
      }
    }
    
    // 初始请求或编辑失败时，发送新消息
    try {
      console.log('初始请求或编辑失败，发送新消息');
      // 如果有多页，包含内联键盘
      if (totalPages > 1) {
        console.log(`发送新消息到: ${targetChatId}`);
        const sendResult = await sendMessage({
          chat_id: targetChatId,
          text: responseText,
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        });
        console.log(`发送消息结果:`, sendResult);
        return sendResult;
      } else {
        console.log(`发送新消息到: ${targetChatId}`);
        const sendResult = await sendMessage({
          chat_id: targetChatId,
          text: responseText
        });
        console.log(`发送消息结果:`, sendResult);
        return sendResult;
      }
    } catch (error) {
      console.error('发送消息失败:', error);
      throw error;
    }
  } catch (error) {
    console.error('获取被屏蔽用户列表失败:', error);
    return sendMessage({
      chat_id: message.chat.id,
      text: '获取被屏蔽用户列表时发生错误'
    });
  }
}