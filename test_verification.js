/**
 * Telegram Bot 验证功能测试脚本
 * 此脚本用于模拟测试机器人的验证功能
 */

// 模拟 nfd KV 存储
export const nfd = {
  _data: {},
  async put(key, value) {
    this._data[key] = typeof value === 'string' ? value : JSON.stringify(value);
  },
  async get(key, options = {}) {
    const value = this._data[key];
    if (value && options.type === 'json') {
      try {
        return JSON.parse(value);
      } catch (e) {
        console.error('解析 JSON 错误:', e);
        return null;
      }
    }
    return value;
  },
  async delete(key) {
    delete this._data[key];
  },
  clear() {
    this._data = {};
  }
};

// 常量定义
const VERIFICATION_QUESTION_KEY = 'verification_question_';
const VERIFICATION_COOLDOWN_KEY = 'verification_cooldown_';
const VERIFICATION_COOLDOWN_TIME = 60 * 1000; // 1分钟

// 模拟时间
let currentTime = Date.now();
const originalDateNow = Date.now;
Date.now = () => currentTime;

// 导入核心函数（这里是简化版本，直接从working.js中提取的关键函数）

/**
 * 生成带有选项的数学验证题目
 */
function generateVerificationQuestion() {
  // 生成1-10之间的随机数
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  
  // 随机选择加法或减法
  const operation = Math.random() > 0.5 ? '+' : '-';
  
  let question, correctAnswer;
  
  if (operation === '+') {
    question = `${a} + ${b} = ?`;
    correctAnswer = (a + b).toString();
  } else {
    // 确保减法结果为正数
    question = `${Math.max(a, b)} - ${Math.min(a, b)} = ?`;
    correctAnswer = Math.abs(a - b).toString();
  }
  
  // 生成3个错误答案（与正确答案接近但不同）
  const wrongAnswers = [];
  let attempts = 0;
  while (wrongAnswers.length < 3 && attempts < 20) {
    // 生成与正确答案有±1到±3差异的错误答案
    const offset = Math.floor(Math.random() * 3) + 1;
    const direction = Math.random() > 0.5 ? 1 : -1;
    const wrongAnswer = (parseInt(correctAnswer) + offset * direction).toString();
    
    // 确保答案是正整数，并且不在已有选项中
    if (parseInt(wrongAnswer) > 0 && !wrongAnswers.includes(wrongAnswer) && wrongAnswer !== correctAnswer) {
      wrongAnswers.push(wrongAnswer);
    }
    attempts++;
  }
  
  // 如果无法生成足够的错误答案，添加一些默认值
  while (wrongAnswers.length < 3) {
    const fallback = (Math.floor(Math.random() * 20) + 1).toString();
    if (fallback !== correctAnswer && !wrongAnswers.includes(fallback)) {
      wrongAnswers.push(fallback);
    }
  }
  
  // 合并所有选项并随机排序
  const options = [correctAnswer, ...wrongAnswers].sort(() => Math.random() - 0.5);
  
  return {
    question,
    correctAnswer,
    options
  };
}

/**
 * 检查用户是否已验证
 */
async function isUserVerified(userId) {
  try {
    const verifiedData = await nfd.get('verified_' + userId, { type: 'json' });
    if (verifiedData && verifiedData.expiryTime) {
      return Date.now() < verifiedData.expiryTime;
    }
    return false;
  } catch (error) {
    console.error('检查用户验证状态时出错:', error);
    return false;
  }
}

/**
 * 设置用户为已验证
 */
async function setUserVerified(userId, expiryTime = 24 * 60 * 60 * 1000) {
  try {
    await nfd.put('verified_' + userId, JSON.stringify({
      userId: userId,
      verifiedAt: Date.now(),
      expiryTime: Date.now() + expiryTime
    }));
  } catch (error) {
    console.error('设置用户验证状态时出错:', error);
  }
}

/**
 * 检查是否处于冷却时间
 */
async function isInCooldown(userId) {
  try {
    const cooldownData = await nfd.get(VERIFICATION_COOLDOWN_KEY + userId, { type: 'json' });
    if (cooldownData && cooldownData.expiryTime) {
      if (Date.now() < cooldownData.expiryTime) {
        return true;
      }
      // 冷却时间已过，清除冷却状态
      await nfd.delete(VERIFICATION_COOLDOWN_KEY + userId);
    }
    return false;
  } catch (error) {
    console.error('检查冷却时间时出错:', error);
    return false;
  }
}

/**
 * 设置冷却时间
 */
async function setCooldown(userId) {
  try {
    const expiryTime = Date.now() + VERIFICATION_COOLDOWN_TIME;
    await nfd.put(VERIFICATION_COOLDOWN_KEY + userId, JSON.stringify({
      expiryTime: expiryTime,
      setAt: Date.now()
    }));
  } catch (error) {
    console.error('设置冷却时间时出错:', error);
  }
}

/**
 * 获取剩余冷却时间（秒）
 */
async function getRemainingCooldown(userId) {
  try {
    const cooldownData = await nfd.get(VERIFICATION_COOLDOWN_KEY + userId, { type: 'json' });
    if (cooldownData && cooldownData.expiryTime) {
      const remaining = Math.ceil((cooldownData.expiryTime - Date.now()) / 1000);
      return remaining > 0 ? remaining : 0;
    }
    return 0;
  } catch (error) {
    return 0;
  }
}

/**
 * 模拟验证按钮点击处理
 */
async function simulateVerificationFlow() {
  console.log('开始测试验证流程...');
  const userId = 'test_user_123';
  
  // 清空存储
  nfd.clear();
  
  console.log('测试1: 生成验证题目');
  const question = generateVerificationQuestion();
  await nfd.put(VERIFICATION_QUESTION_KEY + userId, JSON.stringify(question));
  console.log(`生成的题目: ${question.question}`);
  console.log(`正确答案: ${question.correctAnswer}`);
  console.log(`选项: ${question.options.join(', ')}`);
  
  console.log('\n测试2: 选择正确答案');
  const savedQuestion = await nfd.get(VERIFICATION_QUESTION_KEY + userId, { type: 'json' });
  if (savedQuestion && savedQuestion.correctAnswer) {
    // 模拟选择正确答案
    console.log(`选择正确答案: ${savedQuestion.correctAnswer}`);
    
    // 设置用户验证状态
    await setUserVerified(userId);
    const isVerified = await isUserVerified(userId);
    console.log(`验证后状态: ${isVerified ? '已验证' : '未验证'}`);
    
    // 删除验证题目
    await nfd.delete(VERIFICATION_QUESTION_KEY + userId);
    const afterDelete = await nfd.get(VERIFICATION_QUESTION_KEY + userId);
    console.log(`验证题目已删除: ${afterDelete === undefined ? '是' : '否'}`);
  }
  
  // 重置状态，测试错误答案和冷却时间
  console.log('\n测试3: 选择错误答案和冷却时间');
  nfd.clear();
  
  // 新的验证题目
  const newQuestion = generateVerificationQuestion();
  await nfd.put(VERIFICATION_QUESTION_KEY + userId, JSON.stringify(newQuestion));
  console.log(`新的题目: ${newQuestion.question}`);
  console.log(`正确答案: ${newQuestion.correctAnswer}`);
  
  // 选择错误答案
  const wrongAnswer = newQuestion.options.find(opt => opt !== newQuestion.correctAnswer);
  console.log(`选择错误答案: ${wrongAnswer}`);
  
  // 设置冷却时间
  await setCooldown(userId);
  const inCooldown = await isInCooldown(userId);
  console.log(`冷却状态: ${inCooldown ? '处于冷却中' : '未冷却'}`);
  
  // 检查剩余冷却时间
  const remaining = await getRemainingCooldown(userId);
  console.log(`剩余冷却时间: ${remaining} 秒`);
  
  // 模拟时间流逝30秒
  console.log('\n测试4: 模拟时间流逝30秒');
  currentTime += 30 * 1000;
  const remainingAfter30s = await getRemainingCooldown(userId);
  console.log(`30秒后剩余冷却时间: ${remainingAfter30s} 秒`);
  
  // 模拟时间流逝超过1分钟
  console.log('\n测试5: 模拟时间流逝超过1分钟');
  currentTime += 35 * 1000; // 总共65秒
  const inCooldownAfter = await isInCooldown(userId);
  console.log(`1分钟后冷却状态: ${inCooldownAfter ? '仍处于冷却中' : '冷却已结束'}`);
  
  console.log('\n测试完成！');
  
  // 恢复原始的Date.now函数
  Date.now = originalDateNow;
}

// 运行测试
simulateVerificationFlow().catch(error => {
  console.error('测试过程中出现错误:', error);
  // 恢复原始的Date.now函数
  Date.now = originalDateNow;
});