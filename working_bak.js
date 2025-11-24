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
const NOTIFICATION_EXPIRY_HOURS = 1; // 消息过期时间：0.01小时（约36秒）
const WHITELIST_KEY = 'user_whitelist'; // 白名单存储键名
// 存储被屏蔽用户详细信息的键名前缀
const BLOCKED_USER_INFO_PREFIX = 'blocked-user-info-';
// 存储被屏蔽用户索引的键名
const BLOCKED_USERS_INDEX_KEY = 'blocked-users-index';
// 分页大小
const PAGE_SIZE = 10;

// 用户验证相关常量
const VERIFIED_USER_KEY = 'verified_user_'; // 已验证用户的键名前缀
const VERIFICATION_QUESTION_KEY = 'verification_question_'; // 用户验证题目的键名前缀
const VERIFICATION_TIMEOUT = 3600 * 1000; // 验证超时时间（1小时）

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
  if (!message || (!message.text && !message.caption)) {
    return { isBlocked: false, violatingLines: [], matchedKeywords: [] };
  }
  
  const keywords = await getKeywordFilters();
  // 同时检查text和caption属性
  const textToCheck = (message.text || '') + '\n' + (message.caption || '');
  const lines = textToCheck.split('\n');
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
 * 检查消息是否是转发消息（包括文本、链接和媒体内容）
 * @param {Object} message Telegram消息对象
 * @returns {Object} 检测结果
 */
async function isForwardedLinkOrMedia(message) {
  // 检查是否是转发消息
  if (!message.forward_from && !message.forward_from_chat) {
    return { isBlocked: false, reason: '' };
  }
  
  // 如果是转发的消息，直接返回需要屏蔽
  // 判断转发来源类型
  if (message.forward_from_chat) {
    // 来自频道或群组的转发
    return { isBlocked: true, reason: '转发的群组/频道消息' };
  } else if (message.forward_from) {
    // 来自用户的转发
    return { isBlocked: true, reason: '转发的用户消息' };
  }
  
  return { isBlocked: false, reason: '' };
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
    
    // 处理选择题答案回调
    if (data.startsWith('choice_')) {
      const selectedAnswer = data.substring(7); // 去掉前缀'choice_'
      await handleMultipleChoiceAnswer(
        callbackQuery.from.id,
        callbackQuery.message.chat.id,
        callbackQuery.message.message_id,
        selectedAnswer,
        callbackQuery.id
      );
      return;
    }
    
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
    const chatId = message.chat.id;
    
    // 保存用户基本信息，无论用户是否已验证或被屏蔽
    let userName = '未知用户';
    if (message.from) {
      userName = `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim();
      if (!userName) {
        userName = `用户(${chatId})`;
      }
    } else {
      userName = `用户(${chatId})`;
    }
    
    // 保存用户信息到KV存储
    await nfd.put(`user_info_${chatId}`, JSON.stringify({
      userId: chatId,
      userName: userName,
      first_name: message.from?.first_name,
      last_name: message.from?.last_name,
      username: message.from?.username,
      lastSeen: Date.now()
    }));
    
    // 检查用户是否被屏蔽
    const isblocked = await nfd.get('isblocked-' + chatId, { type: "json" });
    if(isblocked){
      return sendMessage({
        chat_id: chatId,
        text: '您的账户已被屏蔽！请联系专业客服进行解封。专业客服：@UnblockBankCard1_bot'
      });
    }
    
    // 检查用户是否被锁定
    const lockStatus = await isUserLocked(chatId);
    if (lockStatus.isLocked) {
      // 用户被锁定，显示锁定信息
      return sendMessage({
        chat_id: chatId,
        text: generateLockMessage(lockStatus.remainingTime)
      });
    }
    
    // 检查用户是否已经通过验证
    const isVerified = await isUserVerified(chatId);
    if (isVerified) {
      // 已验证用户，直接显示欢迎消息，不重新验证
      return sendMessage({
        chat_id: chatId,
        text: `欢迎回来，${userName}！您已通过验证，可以正常使用机器人。`
      });
    }
    
    // 未验证用户，发送欢迎消息并保存消息ID
    const welcomeMsg = await sendMessage({
      chat_id: chatId,
      text: '欢迎使用ChatSecretary | 技术支持助手机器人！请完成验证以继续使用。',
    });
    
    // 保存初始欢迎消息ID到KV存储中，与用户ID关联
    if (welcomeMsg.ok) {
      await nfd.put(`welcome_msg_${chatId}`, welcomeMsg.result.message_id.toString());
    }
    
    // 自动发送验证问题，无需用户再发送/verify命令
    await sendMultipleChoiceVerification(chatId);
    return;
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
  
  // 保存用户基本信息，无论用户是否已验证或被屏蔽
  // 这样在验证失败需要屏蔽时，可以使用更详细的用户名信息
  let userName = '未知用户';
  if (message.from) {
    userName = `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim();
    if (!userName) {
      userName = `用户(${chatId})`;
    }
  } else {
    userName = `用户(${chatId})`;
  }
  
  // 保存用户信息到KV存储
  await nfd.put(`user_info_${chatId}`, JSON.stringify({
    userId: chatId,
    userName: userName,
    first_name: message.from?.first_name,
    last_name: message.from?.last_name,
    username: message.from?.username,
    lastSeen: Date.now()
  }));
  
  if(isblocked){    
    return sendMessage({      
      chat_id: chatId,      
      text:'Your are blocked'    
    })
  }  
  
  // 检查用户是否在白名单中（白名单用户无需验证）
  const isWhitelisted = await isInWhitelist(chatId);
  
  // 检查用户验证状态（对所有非白名单用户）
  let isVerified = false;
  if (!isWhitelisted) {
    // 首先检查用户是否被锁定（优先级高于验证状态检查）
    const lockStatus = await isUserLocked(chatId);
    if (lockStatus.isLocked) {
      // 用户被锁定，显示剩余锁定时间
      const minutes = Math.floor(lockStatus.remainingTime / 60);
      const seconds = lockStatus.remainingTime % 60;
      let lockMessage = '您的账户已被临时锁定';
      if (minutes > 0) {
        lockMessage += ` ${minutes}分${seconds}秒`;
      } else {
        lockMessage += ` ${seconds}秒`;
      }
      lockMessage += '。请稍后再试。';
      
      await sendMessage({
        chat_id: chatId,
        text: lockMessage
      });
      return; // 确保锁定状态下直接返回，不处理后续逻辑
    }
    
    // 未锁定时检查验证状态
    isVerified = await isUserVerified(chatId);
    
    if (!isVerified) {
      // 未锁定且未验证的用户，直接触发验证码流程，无需等待/start命令
      // 只有在用户提交验证答案时才处理/verify命令
      if (message.text && message.text.startsWith('/verify ')) {
        // 兼容旧的验证方式
        // 用户提交了答案
        const userAnswer = message.text.substring(7).trim();
        
        // 获取存储的验证题目和答案
        try {
          const savedQuestion = await nfd.get(VERIFICATION_QUESTION_KEY + chatId, { type: 'json' });
          
          if (savedQuestion && userAnswer === savedQuestion.answer) {
            // 验证成功
            await setUserVerified(chatId);
            await nfd.delete(VERIFICATION_QUESTION_KEY + chatId); // 删除验证题目
            
            return sendMessage({
              chat_id: chatId,
              text: '验证成功！您现在可以正常使用机器人了。'
            });
          } else {
            // 验证失败，设置1分钟锁定
            await setUserLocked(chatId, 60);
            await nfd.delete(VERIFICATION_QUESTION_KEY + chatId);
            
            return sendMessage({
              chat_id: chatId,
              text: '答案错误，您的账户已被临时锁定1分钟。'
            });
          }
        } catch (error) {
          console.error('处理用户验证时出错:', error);
          // 发生错误时直接开始新的验证流程
          await sendMultipleChoiceVerification(chatId);
          return;
        }
      } else {
        // 自动开始选择题验证流程，无需用户输入/verify命令
        await sendMultipleChoiceVerification(chatId);
        return;
      }
    }
  }
  
  
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
      userName: userName || `用户(${chatId})`,
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

  // 检查是否是转发的链接或媒体内容（白名单用户不受限制）
  if (!isWhitelisted) {
    const forwardedLinkMediaCheck = await isForwardedLinkOrMedia(message);
    if (forwardedLinkMediaCheck.isBlocked) {
      // 自动屏蔽用户
      await nfd.put('isblocked-' + chatId, true);
      
      // 获取用户信息
      let userName = message.from ? `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim() || '未知用户' : '未知用户';
      
      // 创建屏蔽用户信息对象
      const blockInfo = {
        userId: chatId,
        userName: userName,
        userType: 'user',
        blockedAt: Date.now(),
        blockingReason: `自动屏蔽（${forwardedLinkMediaCheck.reason}）`,
        matchedKeywords: [forwardedLinkMediaCheck.reason],
        violatingLines: ['转发的链接或媒体内容']
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
      
      // 获取转发来源信息
      let forwardSourceInfo = '';
      if (message.forward_from_chat) {
        forwardSourceInfo = `频道: ${message.forward_from_chat.title}`;
      } else if (message.forward_from) {
        forwardSourceInfo = `用户: ${message.forward_from.first_name || ''}`;
        if (message.forward_from.last_name) forwardSourceInfo += ` ${message.forward_from.last_name}`;
        if (message.forward_from.username) forwardSourceInfo += ` (@${message.forward_from.username})`;
      }
      
      // 通知管理员
      const messageResponse = await sendMessage({
        chat_id: ADMIN_UID,
        text: `用户 UID:${chatId} 因${forwardedLinkMediaCheck.reason}被自动屏蔽\n\n用户: ${userName}\n转发来源: ${forwardSourceInfo || '未知'}`
      });
      
      // 保存通知信息
      if (messageResponse && messageResponse.ok) {
        await saveAdminNotification(messageResponse.result.message_id, ADMIN_UID);
      }
      
      // 通知用户
      return sendMessage({
        chat_id: chatId,
        text: 'Your are blocked for sending forwarded links or media content.'
      });
    }
  }
  
  // 确保只有已验证用户的消息才会被转发
  if (isVerified || isWhitelisted) {
    let forwardReq = await forwardMessage({
      chat_id:ADMIN_UID,
      from_chat_id:message.chat.id,
      message_id:message.message_id
    })

    if(forwardReq.ok){
      await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)
    }
    return handleNotify(message);
  } else {
    // 未验证用户，直接显示验证码
    await sendMultipleChoiceVerification(chatId);
    return;
  }
}

/**
 * 生成选择题验证题目（包含1个正确答案和3个错误答案）
 * 该函数用于生成防机器人验证问题，通过提供简单但需要人类理解的选择题来区分人类和自动化程序
 * @returns {Object} 包含题目、选项数组和正确答案索引的对象
 */
function generateMultipleChoiceQuestion() {
  // 预定义的问题和答案库 - 包含不同领域的简单问题，易于人类回答但对机器人有挑战性
  const questionBanks = [
    {
      question: "以下哪个不是编程语言？",
      correctAnswer: "HTML", // HTML是标记语言，不是编程语言
      wrongAnswers: ["Python", "JavaScript", "Java"] // 这三个都是编程语言
    },
    {
      question: "下列哪个不是水果？",
      correctAnswer: "胡萝卜", // 胡萝卜是蔬菜
      wrongAnswers: ["苹果", "香蕉", "橙子"] // 这些都是水果
    },
    {
      question: "以下哪个是首都？",
      correctAnswer: "北京", // 北京是中国首都
      wrongAnswers: ["上海", "广州", "深圳"] // 这些都是中国的重要城市但不是首都
    },
    {
      question: "下列哪个是哺乳动物？",
      correctAnswer: "鲸鱼", // 鲸鱼是哺乳动物
      wrongAnswers: ["鳄鱼", "青蛙", "蛇"] // 这些都是爬行动物或两栖动物
    },
    {
      question: "1+1等于多少？",
      correctAnswer: "2", // 基础数学运算
      wrongAnswers: ["1", "3", "0"] // 错误的数学结果
    },
    {
      question: "以下哪个不是颜色？",
      correctAnswer: "音符", // 音符不是颜色
      wrongAnswers: ["红色", "蓝色", "绿色"] // 这些都是颜色
    },
    {
      question: "下列哪个是月份名称？",
      correctAnswer: "三月", // 三月是月份名称
      wrongAnswers: ["星期一", "星期三", "星期五"] // 这些是星期几
    },
    {
      question: "以下哪个不是动物？",
      correctAnswer: "植物", // 植物不是动物
      wrongAnswers: ["猫", "狗", "鸟"] // 这些都是动物
    },
    {
      question: "下列哪个是中国的传统节日？",
      correctAnswer: "春节", // 春节是中国传统节日
      wrongAnswers: ["圣诞节", "情人节", "万圣节"] // 这些是西方节日
    },
    {
      question: "3*4等于多少？",
      correctAnswer: "12", // 基础乘法运算
      wrongAnswers: ["7", "10", "15"] // 错误的数学结果
    },
    {
      question: "以下哪个是天体？",
      correctAnswer: "太阳", // 太阳是天体
      wrongAnswers: ["飞机", "云朵", "风筝"] // 这些都不是天体
    },
    {
      question: "下列哪个是身体部位？",
      correctAnswer: "耳朵", // 耳朵是身体部位
      wrongAnswers: ["椅子", "桌子", "窗户"] // 这些都是家具
    },
    {
      question: "以下哪个不是编程语言的扩展名？",
      correctAnswer: ".jpg", // .jpg是图片文件扩展名
      wrongAnswers: [".js", ".py", ".html"] // 这些都是编程语言文件扩展名
    },
    {
      question: "下列哪个是文具？",
      correctAnswer: "铅笔", // 铅笔是文具
      wrongAnswers: ["手机", "电脑", "电视"] // 这些都是电子设备
    },
    {
      question: "5+7等于多少？",
      correctAnswer: "12", // 基础加法运算
      wrongAnswers: ["10", "13", "15"] // 错误的数学结果
    },
    {
      question: "以下哪个是乐器？",
      correctAnswer: "钢琴", // 钢琴是乐器
      wrongAnswers: ["书本", "纸张", "书包"] // 这些都不是乐器
    },
    {
      question: "下列哪个是交通工具？",
      correctAnswer: "汽车", // 汽车是交通工具
      wrongAnswers: ["房子", "公园", "学校"] // 这些都不是交通工具
    },
    {
      question: "以下哪个是国家名称？",
      correctAnswer: "中国", // 中国是国家名称
      wrongAnswers: ["东京", "纽约", "悉尼"] // 这些都是城市名称
    },
    {
      question: "下列哪个不是季节？",
      correctAnswer: "中午", // 中午不是季节
      wrongAnswers: ["春天", "夏天", "秋天"] // 这些都是季节
    },
    {
      question: "10-6等于多少？",
      correctAnswer: "4", // 基础减法运算
      wrongAnswers: ["3", "5", "7"] // 错误的数学结果
    }
  ];

  // 随机选择一个问题，增加验证的不可预测性
  const questionSet = questionBanks[Math.floor(Math.random() * questionBanks.length)];
  
  // 合并正确答案和错误答案到一个数组中
  const allOptions = [questionSet.correctAnswer, ...questionSet.wrongAnswers];
  
  // 使用Fisher-Yates洗牌算法随机排序选项，防止答案位置固定被机器人识别
  const shuffledOptions = shuffleArray(allOptions);
  
  // 记录正确答案在随机排序后的索引（+1是因为选项编号从1开始而不是从0开始）
  const correctIndex = shuffledOptions.indexOf(questionSet.correctAnswer) + 1; 
  
  // 返回完整的问题对象，包含题目文本、随机排序的选项和正确答案的编号
  return {
    question: questionSet.question,    // 问题文本
    options: shuffledOptions,          // 随机排序后的选项数组
    correctAnswer: correctIndex.toString() // 正确答案的编号（转为字符串格式以便比较）
  };
}

/**
 * 数组随机排序（Fisher-Yates洗牌算法）
 * 该函数使用标准的Fisher-Yates算法对数组元素进行随机打乱，确保每个元素都有相等的概率出现在任何位置
 * @param {Array} array 要随机排序的原始数组
 * @returns {Array} 返回排序后的新数组，不会修改原数组
 */
function shuffleArray(array) {
  // 创建数组的副本，避免直接修改原数组
  const newArray = [...array];
  // Fisher-Yates洗牌算法核心实现
  // 从数组末尾开始，依次将当前位置的元素与随机位置的元素交换
  for (let i = newArray.length - 1; i > 0; i--) {
    // 生成一个0到i之间的随机整数，作为交换位置
    const j = Math.floor(Math.random() * (i + 1));
    // 使用解构赋值交换两个元素位置
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

/**
 * 生成选择题内联键盘
 * 该函数根据选项数组生成Telegram内联键盘，用于展示选择题选项并处理用户点击交互
 * @param {Array} options 选项内容数组，通常包含4个元素（1个正确答案和3个错误答案）
 * @returns {Object} Telegram Bot API要求的内联键盘配置对象
 */
function generateInlineKeyboard(options) {
  // 创建存储按钮对象的数组
  const buttons = [];
  
  // 遍历选项数组，为每个选项创建对应的内联按钮
  for (let i = 0; i < options.length; i++) {
    buttons.push({
      text: `${i + 1}. ${options[i]}`, // 按钮显示文本，格式为 "选项编号. 选项内容"
      callback_data: `choice_${i + 1}` // 按钮回调数据，添加"choice_"前缀以匹配处理逻辑
    });
  }
  
  // 将按钮排列成2x2网格布局，使界面更加紧凑美观
  // 每行显示两个按钮，共两行
  const keyboard = [
    [buttons[0], buttons[1]],  // 第一行包含前两个选项
    [buttons[2], buttons[3]]   // 第二行包含后两个选项
  ];
  
  // 返回符合Telegram Bot API格式要求的内联键盘对象
  return {
    inline_keyboard: keyboard  // inline_keyboard字段是Telegram API要求的标准格式
  };
}

/**
 * 存储用户验证问题到KV存储中
 * 该函数将生成的选择题验证问题与用户ID关联并存储，同时记录时间戳以便后续验证
 * @param {string} userId 用户的唯一标识符
 * @param {Object} questionData 包含题目、选项和正确答案的问题数据对象
 * @returns {Promise<void>} 无返回值的Promise
 */
async function saveUserVerificationQuestion(userId, questionData) {
  // 生成用于KV存储的唯一键，格式为"verification_用户ID"
  const key = `verification_${userId}`;
  
  // 将问题数据序列化为JSON字符串并存储到KV存储中
  // 同时添加当前时间戳，用于追踪问题创建时间
  // 设置过期时间为3600秒（1小时），防止验证问题长期占用存储空间
  await nfd.put(key, JSON.stringify({
    ...questionData,
    timestamp: Date.now() // 添加时间戳
  }), { expirationTtl: 3600 }); // 1小时后自动过期
}

/**
 * 从KV存储中获取用户验证问题
 * 该函数根据用户ID检索之前存储的验证问题，用于验证用户提交的答案
 * @param {string} userId 用户的唯一标识符
 * @returns {Promise<Object|null>} 返回问题数据对象，如果不存在则返回null
 */
async function getUserVerificationQuestion(userId) {
  // 使用相同的键格式获取之前存储的验证问题
  const key = `verification_${userId}`;
  
  // 从KV存储中读取数据
  const data = await nfd.get(key);
  
  // 如果数据存在，将JSON字符串解析为对象返回；否则返回null
  return data ? JSON.parse(data) : null;
}

/**
 * 设置用户锁定状态
 * 当用户验证失败时调用此函数，临时锁定用户账户以防止暴力破解
 * @param {string} userId 用户的唯一标识符
 * @param {number} duration 锁定持续时间（秒），默认60秒（1分钟）
 * @returns {Promise<void>} 无返回值的Promise
 */
async function setUserLocked(userId, duration = 60) { 
  // 生成用于KV存储的唯一键，格式为"locked_用户ID"
  const key = `locked_${userId}`;
  
  // 创建锁定数据对象，包含锁定开始时间和锁定持续时间
  const lockData = {
    lockedAt: Date.now(),                   // 锁定开始时间戳
    lockDuration: duration * 1000           // 锁定持续时间（毫秒）
  };
  
  // 将锁定数据存储到KV存储中，并设置自动过期时间
  // 使用与锁定持续时间相同的expirationTtl，确保锁定自动失效
  await nfd.put(key, JSON.stringify(lockData), { expirationTtl: duration });
}

/**
 * 检查用户是否被锁定
 * 在处理用户请求前调用此函数，判断用户是否处于锁定状态并计算剩余锁定时间
 * @param {string} userId 用户的唯一标识符
 * @returns {Promise<Object>} 包含锁定状态和剩余时间的对象
 */
async function isUserLocked(userId) {
  // 使用相同的键格式获取用户锁定状态
  const key = `locked_${userId}`;
  
  // 从KV存储中读取锁定数据
  const data = await nfd.get(key, { type: "json" });
  
  // 如果没有锁定数据，返回未锁定状态
  if (!data) {
    return { isLocked: false, remainingTime: 0 };
  }
  
  // 计算锁定结束时间和当前剩余锁定时间
  const now = Date.now();
  const lockedUntil = data.lockedAt + data.lockDuration;
  // 计算剩余时间（秒），确保不会出现负数
  const remainingTime = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  
  // 返回锁定状态和剩余锁定时间
  return {
    isLocked: remainingTime > 0,            // 锁定状态：剩余时间>0表示仍被锁定
    remainingTime: remainingTime            // 剩余锁定时间（秒）
  };
}

/**
 * 清除用户锁定状态
 * 当用户成功通过验证后调用此函数，解除用户账户的锁定
 * @param {string} userId 用户的唯一标识符
 * @returns {Promise<void>} 无返回值的Promise
 */
async function clearUserLock(userId) {
  // 使用相同的键格式删除用户锁定数据
  const key = `locked_${userId}`;
  // 从KV存储中删除锁定记录
  await nfd.delete(key);
}

/**
 * 生成锁定状态下的提示消息
 * 根据剩余锁定时间生成友好的提示消息，告知用户锁定状态和可用时间
 * @param {number} remainingTime 剩余锁定时间（秒）
 * @returns {string} 格式化的提示消息字符串
 */
function generateLockMessage(remainingTime) {
  // 将剩余时间转换为分钟和秒
  const minutes = Math.floor(remainingTime / 60);
  const seconds = remainingTime % 60;
  
  // 根据剩余时间的长短，生成不同格式的提示消息
  if (minutes > 0) {
    // 当剩余时间超过1分钟时，显示分钟和秒
    return `您的账户已被临时锁定，请在 ${minutes} 分 ${seconds} 秒后重试。`;
  } else {
    // 当剩余时间不足1分钟时，仅显示秒
    return `您的账户已被临时锁定，请在 ${seconds} 秒后重试。`;
  }
}

/**
 * 验证用户的选择题答案
 * 该函数是验证系统的核心，负责检查用户提交的答案是否正确，并根据结果执行相应的操作
 * @param {string} userId 用户的唯一标识符
 * @param {string} selectedAnswer 用户选择的答案（通常是选项编号"1"-"4"）
 * @returns {Promise<Object>} 包含验证结果的详细对象
 */
async function verifyMultipleChoiceAnswer(userId, selectedAnswer) {
  // 第一步：检查用户是否处于锁定状态，这是防止暴力破解的安全措施
  const lockStatus = await isUserLocked(userId);
  
  // 如果用户被锁定，返回锁定状态信息和剩余锁定时间
  if (lockStatus.isLocked) {
    return {
      isValid: false,               // 验证无效
      message: generateLockMessage(lockStatus.remainingTime), // 生成友好的锁定提示消息
      isCorrect: false,             // 答案不正确
      isLocked: true,               // 用户处于锁定状态
      remainingTime: lockStatus.remainingTime // 剩余锁定时间（秒）
    };
  }
  
  // 第二步：获取用户之前的验证问题数据
  const key = `verification_${userId}`;
  const questionData = await nfd.get(key, { type: "json" });
  
  // 如果找不到验证问题（可能已过期或从未生成），返回错误信息
  if (!questionData) {
    return {
      isValid: false,
      message: "没有找到验证问题，请重新开始验证。",
      isCorrect: false
    };
  }
  
  // 第三步：核心验证逻辑 - 比较用户选择的答案与正确答案
  const isCorrect = selectedAnswer === questionData.correctAnswer;
  
  // 第四步：根据验证结果执行不同操作
  if (isCorrect) {
    // 验证成功的处理逻辑
    // 1. 清除验证问题，防止重复使用
    await nfd.delete(key);
    // 2. 确保用户锁定状态被清除（如果之前有任何锁定记录）
    await clearUserLock(userId);
    
    // 返回验证成功的结果
    return {
      isValid: true,
      message: "✅ 验证成功！", // 简化消息内容，避免与欢迎消息重复
      isCorrect: true
    };
  } else {
    // 验证失败的处理逻辑
    // 1. 设置1分钟的临时锁定，防止暴力尝试
    await setUserLocked(userId, 60);
    // 2. 清除当前验证问题，下次需要重新生成新问题
    await nfd.delete(key);
    
    // 返回验证失败的结果，包含锁定信息
    return {
      isValid: true, // 验证过程有效（只是答案错误）
      message: "答案错误，您的账户已被临时锁定1分钟。",
      isCorrect: false,
      isLocked: true,
      remainingTime: 60 // 锁定时间为60秒
    };
  }
}

/**
 * 发送选择题验证消息
 * 该函数负责生成验证问题、保存问题数据并向用户发送带内联键盘的验证消息
 * @param {string} userId 用户的唯一标识符
 * @returns {Promise<void>} 无返回值的Promise
 */
async function sendMultipleChoiceVerification(userId) {
  // 第一步：生成一个随机的选择题（包含题目、选项和正确答案）
  const questionData = generateMultipleChoiceQuestion();
  
  // 第二步：将生成的验证问题保存到KV存储中，与用户ID关联
  const key = `verification_${userId}`;
  await nfd.put(key, JSON.stringify({
    ...questionData,
    timestamp: Date.now() // 添加时间戳，用于追踪问题创建时间
  }), { expirationTtl: 3600 }); // 设置1小时过期，防止问题长期占用存储空间
  
  // 第三步：生成包含选项按钮的内联键盘，用于用户交互
  const keyboard = generateInlineKeyboard(questionData.options);
  
  // 第四步：构建验证消息文本，清晰地呈现问题并引导用户选择
  const message = `请回答以下问题：\n\n${questionData.question}\n\n请选择正确的答案：`;
  
  // 第五步：发送带内联键盘的验证消息给用户（后续会通过Telegram API发送）
  // 使用reply_markup参数发送带内联键盘的消息
  const verificationMsg = await sendMessage({
    chat_id: userId,
    text: message,
    reply_markup: keyboard
  });
  
  // 保存验证问题消息ID到KV存储中，与用户ID关联
  if (verificationMsg.ok) {
    await nfd.put(`verification_msg_${userId}`, verificationMsg.result.message_id.toString());
  }
}

/**
 * 处理选择题答案回调
 * 该函数接收用户点击选择题选项后的回调数据，处理验证逻辑并提供用户反馈
 * @param {string} userId 用户的唯一标识符
 * @param {number} chatId 聊天会话ID
 * @param {number} messageId 被编辑的消息ID
 * @param {string} selectedAnswer 用户选择的答案（选项编号）
 * @param {string} callbackQueryId Telegram回调查询的唯一标识符
 * @returns {Promise<void>} 无返回值的Promise
 */
async function handleMultipleChoiceAnswer(userId, chatId, messageId, selectedAnswer, callbackQueryId) {
  // 第一步：调用验证函数，检查用户选择的答案是否正确
  const result = await verifyMultipleChoiceAnswer(userId, selectedAnswer);
  
  // 第二步：更新原始验证消息，将其替换为验证结果，并移除选项键盘
  // 这样用户就不能再次选择答案，避免重复提交
  await editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text: result.message,         // 显示验证结果消息
    reply_markup: { inline_keyboard: [] } // 清空内联键盘
  });
  
  // 第三步：向用户提供即时交互反馈，通过Telegram的回调响应机制
  await requestTelegram('answerCallbackQuery', makeReqBody({
    callback_query_id: callbackQueryId,
    text: result.isCorrect ? '' : (result.isBlocked ? '答案错误！您已被封禁，请联系客服或管理员解封!' : (result.errorCount >= 2 ? '答案错误！您已接近限制，请仔细作答或联系客服。' : '错误答案，请稍后重试。')), // 根据不同状态显示不同提示
    show_alert: !result.isCorrect // 仅在答案错误时显示弹窗警告
  }));
  
  // 第四步：如果用户通过验证，将用户标记为已验证状态
  // 这样用户后续的请求就不需要再次验证
  if (result.isCorrect) {
    // 标记用户为已验证
    await setUserVerified(userId);
    
    try {
      // 获取并删除之前保存的消息
      // 1. 获取欢迎消息ID
      const welcomeMsgId = await nfd.get(`welcome_msg_${userId}`);
      
      // 2. 获取验证问题消息ID
      const verificationMsgId = await nfd.get(`verification_msg_${userId}`);
      
      // 3. 删除欢迎消息（如果存在）
      if (welcomeMsgId) {
        await requestTelegram('deleteMessage', makeReqBody({
          chat_id: userId,
          message_id: parseInt(welcomeMsgId)
        }));
        // 清除保存的欢迎消息ID
        await nfd.delete(`welcome_msg_${userId}`);
      }
      
      // 4. 删除验证问题消息（如果存在）
      if (verificationMsgId) {
        await requestTelegram('deleteMessage', makeReqBody({
          chat_id: userId,
          message_id: parseInt(verificationMsgId)
        }));
        // 清除保存的验证问题消息ID
        await nfd.delete(`verification_msg_${userId}`);
      }
    } catch (error) {
      // 删除消息失败时不影响主流程，继续执行
      console.log('删除消息失败:', error);
    }
    
    // 发送唯一的欢迎消息，避免与前面的验证成功消息重复
    await sendMessage({
      chat_id: userId,
      text: '欢迎使用ChatSecretary！您现在可以享受所有功能了。'
    });
  }
}

/**
 * 清除用户锁定状态
 * @param {string} userId 用户ID
 */
async function clearUserLock(userId) {
  const key = `locked_${userId}`;
  await nfd.delete(key);
};

/**
 * 生成锁定状态下的提示消息
 * @param {number} remainingTime 剩余锁定时间（秒）
 * @returns {string} 提示消息
 */
function generateLockMessage(remainingTime) {
  const minutes = Math.floor(remainingTime / 60);
  const seconds = remainingTime % 60;
  
  if (minutes > 0) {
    return `您的账户已被临时锁定，请在 ${minutes} 分 ${seconds} 秒后重试。`;
  } else {
    return `您的账户已被临时锁定，请在 ${seconds} 秒后重试。`;
  }
}

/**
 * 验证用户的选择题答案
 * @param {string} userId 用户ID
 * @param {string} selectedAnswer 用户选择的答案
 * @returns {Object} 验证结果对象
 */
async function verifyMultipleChoiceAnswer(userId, selectedAnswer) {
  // 先检查用户是否被锁定
  const lockStatus = await isUserLocked(userId);
  if (lockStatus.isLocked) {
    return {
      isValid: false,
      message: generateLockMessage(lockStatus.remainingTime),
      isCorrect: false,
      isLocked: true,
      remainingTime: lockStatus.remainingTime
    };
  }
  
  // 获取用户当前的验证问题
  const questionData = await getUserVerificationQuestion(userId);
  
  if (!questionData) {
    return {
      isValid: false,
      message: "没有找到验证问题，请重新开始验证。",
      isCorrect: false
    };
  }
  
  // 验证答案是否正确
  const isCorrect = selectedAnswer === questionData.correctAnswer;
  
  if (isCorrect) {
    // 验证成功，清除验证问题和可能的锁定状态
    const key = `verification_${userId}`;
    await nfd.delete(key);
    await clearUserLock(userId);
    
    // 验证成功，清除错误次数统计
    const errorCountKey = `error_count_${userId}`;
    await nfd.delete(errorCountKey);
    
    return {
      isValid: true,
      message: "验证成功！您可以继续使用机器人。",
      isCorrect: true
    };
  } else {
    // 获取当前错误次数
    const errorCountKey = `error_count_${userId}`;
    let errorCount = await nfd.get(errorCountKey, { type: 'json' }) || 0;
    
    // 增加错误次数
    errorCount++;
    
    // 保存错误次数
    await nfd.put(errorCountKey, errorCount);
    
    // 检查错误次数是否达到3次，如果达到则屏蔽用户
    if (errorCount >= 3) {
      // 屏蔽用户
      await nfd.put('isblocked-' + userId, true);
      
      // 更新屏蔽用户索引
      const blockedUsersIndex = await getBlockedUsersIndex();
      if (!blockedUsersIndex.some(item => item.userId === userId)) {
        blockedUsersIndex.push({
          userId: userId,
          blockedAt: Date.now(),
          blockedReason: '验证失败超过3次'
        });
        await nfd.put(BLOCKED_USERS_INDEX_KEY, JSON.stringify(blockedUsersIndex));
      }
      
      // 保存屏蔽信息，添加用户名和未通过验证备注
      // 直接通过Telegram API的getChat方法获取最新的用户信息
      let userName = `用户(${userId})`;
      try {
        const userProfile = await requestTelegram('getChat', makeReqBody({ chat_id: userId }));
        if (userProfile.ok && userProfile.result) {
          if (userProfile.result.username) {
            userName = `@${userProfile.result.username}`;
          } else if (userProfile.result.first_name) {
            userName = `${userProfile.result.first_name || ''} ${userProfile.result.last_name || ''}`.trim();
          }
        }
      } catch (apiError) {
        console.log('从Telegram API获取用户信息失败，使用默认用户名');
      }
      
      const blockInfo = {
        userId: userId,
        userName: userName,
        blockedAt: Date.now(),
        blockedReason: '验证失败超过3次',
        blockedBy: 'system',
        remarks: '未通过验证'
      };
      await nfd.put(BLOCKED_USER_INFO_PREFIX + userId, JSON.stringify(blockInfo));
      
      // 清除验证问题
      const key = `verification_${userId}`;
      await nfd.delete(key);
      
      // 通知管理员用户因验证失败被屏蔽
      try {
        // 格式化日期时间
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const formattedDateTime = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
        
        // 发送消息给管理员，使用用户要求的格式
        const notificationText = `${userName} (ID:${userId})-${formattedDateTime} 屏蔽原因：未通过验证`;
        
        const messageResponse = await sendMessage({
          chat_id: ADMIN_UID,
          text: notificationText
        });
        
        // 保存通知消息ID，用于后续可能的删除操作
        if (messageResponse && messageResponse.ok) {
          await saveAdminNotification(messageResponse.result.message_id, ADMIN_UID);
        }
      } catch (error) {
        console.error('发送管理员通知失败:', error);
      }
      
      return {
        isValid: true,
        message: "您的验证错误次数已达3次，账户已被自动屏蔽！请联系专业客服进行解封。专业客服：👉 @UnblockBankCard1_bot",
        isCorrect: false,
        isBlocked: true,
        errorCount: errorCount
      };
    }
    
    // 验证失败，设置1分钟锁定
    await setUserLocked(userId, 60); // 锁定1分钟
    // 清除当前验证问题，下次需要重新生成
    const key = `verification_${userId}`;
    await nfd.delete(key);
    
    return {
      isValid: true,
      message: `答案错误，您的账户已被临时锁定1分钟。当前错误次数：${errorCount}/3次，超过将被永久屏蔽！`,
      isCorrect: false,
      isLocked: true,
      remainingTime: 60,
      errorCount: errorCount // 返回当前错误次数
    };
  }
}

/**
 * 生成简单的数学验证题目（保留原有功能）
 * @returns {Object} 包含题目和答案的对象
 */
function generateVerificationQuestion() {
  // 生成两个1到10之间的随机数
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  // 随机选择加法或减法
  const operation = Math.random() > 0.5 ? '+' : '-';
  // 计算答案
  let answer;
  if (operation === '+') {
    answer = num1 + num2;
  } else {
    // 确保减法结果为正数
    if (num1 >= num2) {
      answer = num1 - num2;
    } else {
      // 直接计算，不交换变量
      answer = num2 - num1;
    }
  }
  
  return {
    question: `请计算: ${num1} ${operation} ${num2} = ?`,
    answer: answer.toString()
  };
}

/**
 * 检查用户是否已验证
 * @param {number} userId 用户ID
 * @returns {Promise<boolean>} 是否已验证
 */
async function isUserVerified(userId) {
  try {
    const verified = await nfd.get(VERIFIED_USER_KEY + userId, { type: 'json' });
    if (verified && verified.expiryTime) {
      // 检查是否过期
      if (Date.now() > verified.expiryTime) {
        // 过期了，删除验证状态
        await nfd.delete(VERIFIED_USER_KEY + userId);
        return false;
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error('检查用户验证状态时出错:', error);
    return false;
  }
}

/**
 * 设置用户为已验证状态
 * @param {number} userId 用户ID
 */
async function setUserVerified(userId) {
  try {
    // 设置验证状态，包含过期时间
    const expiryTime = Date.now() + VERIFICATION_TIMEOUT;
    await nfd.put(VERIFIED_USER_KEY + userId, JSON.stringify({
      verified: true,
      expiryTime: expiryTime,
      verifiedAt: Date.now()
    }));
  } catch (error) {
    console.error('设置用户验证状态时出错:', error);
  }
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
    
    // 重置错误次数计数
    const errorCountKey = `error_count_${guestChantId}`;
    await nfd.put(errorCountKey, 0);
  
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
async function handleBlockById(message) {
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
    userName: `用户(${guestChantId})`,
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
    userName: userName || `用户(${guestChantId})`,
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
  
  // 重置错误次数计数
  const errorCountKey = `error_count_${guestChantId}`;
  await nfd.put(errorCountKey, 0);
  
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
          // 直接通过Telegram API的getChat方法获取最新的用户信息
        let userName = `用户(${userIndex.userId})`;
        try {
          const userProfile = await requestTelegram('getChat', makeReqBody({ chat_id: userIndex.userId }));
          if (userProfile.ok && userProfile.result) {
            if (userProfile.result.username) {
              userName = `@${userProfile.result.username}`;
            } else if (userProfile.result.first_name) {
              userName = `${userProfile.result.first_name || ''} ${userProfile.result.last_name || ''}`.trim();
            }
          }
          console.log(`用户${userIndex.userId}从Telegram API获取的用户名:`, userName);
        } catch (apiError) {
          console.log(`从Telegram API获取用户${userIndex.userId}信息失败，使用默认用户名`);
        }
        
        // 从保存的屏蔽信息中获取其他信息，但不使用其中的用户名
        userInfo = await nfd.get(userInfoKey, { type: "json" }) || {};
        // 强制使用Telegram API获取的用户名
        userInfo.userName = userName;
        
      } catch (error) {
        console.error(`获取用户${userIndex.userId}详细信息失败:`, error.message || error);
        console.error('错误堆栈:', error.stack);
        // 出错时设置默认信息
        userInfo = { userName: `用户(${userIndex.userId})` };
      }
      
      const combinedUserInfo = {
        ...userIndex,
        ...(userInfo || { userName: `用户(${userIndex.userId})`, matchedKeywords: [] })
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
        // 获取用户名称，优先使用保存的用户名信息
        const displayName = user.userName || `用户${user.userId}`;
        // 获取屏蔽原因，默认为"未通过验证"
          const blockingReason = user.blockingReason || '未通过验证';
        // 获取关键字，只显示一行
        const keywordsText = user.matchedKeywords && user.matchedKeywords.length > 0
          ? ` [违规词: ${user.matchedKeywords.slice(0, 3).join(', ')}${user.matchedKeywords.length > 3 ? '...' : ''}]`
          : '';
        
        responseText += `${displayIndex}. ${displayName} (ID: ${user.userId}) - ${blockedTime}\n`;
        responseText += `   屏蔽原因: ${blockingReason}${keywordsText}\n`;
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