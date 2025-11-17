# NFD
No Fraud / Node Forward Bot

一个基于cloudflare worker的telegram 消息转发bot，集成了反欺诈功能

## 特点
- 基于cloudflare worker搭建，能够实现以下效果
    - 搭建成本低，一个js文件即可完成搭建
    - 不需要额外的域名，利用worker自带域名即可
    - 基于worker kv实现永久数据储存
    - 稳定，全球cdn转发
- 接入反欺诈系统，当聊天对象有诈骗历史时，自动发出提醒
- 支持屏蔽用户，避免被骚扰
- 支持关键字自动触发屏蔽功能，自动屏蔽包含特定关键词的消息发送者
- 支持自动屏蔽转发消息（包括转发的链接、图片和文本消息）
- 支持白名单功能，白名单用户不受屏蔽规则限制
- 支持查看所有被屏蔽用户列表

## 搭建方法
1. 从[@BotFather](https://t.me/BotFather)获取token，并且可以发送`/setjoingroups`来禁止此Bot被添加到群组
2. 从[uuidgenerator](https://www.uuidgenerator.net/)获取一个随机uuid作为secret
3. 从[@username_to_id_bot](https://t.me/username_to_id_bot)获取你的用户id
4. 登录[cloudflare](https://workers.cloudflare.com/)，创建一个worker
5. 配置worker的变量
    - 增加一个`ENV_BOT_TOKEN`变量，数值为从步骤1中获得的token
    - 增加一个`ENV_BOT_SECRET`变量，数值为从步骤2中获得的secret
    - 增加一个`ENV_ADMIN_UID`变量，数值为从步骤3中获得的用户id
6. 绑定kv数据库，创建一个Namespace Name为`nfd`的kv数据库，在setting -> variable中设置`KV Namespace Bindings`：nfd -> nfd
7. 点击`Quick Edit`，复制[这个文件](./worker.js)到编辑器中
8. 脚本已实现自动注册webhook功能，部署完成后会自动注册，无需手动操作

## 使用方法
- 当其他用户给bot发消息，会被转发到bot创建者
- 用户回复普通文字给转发的消息时，会回复到原消息发送者
- 用户回复`/block`, `/unblock`, `/checkblock`等命令会执行相关指令，**不会**回复到原消息发送者
- `/keywords` - 查看当前设置的屏蔽关键字列表
- `/addkeyword 关键字` - 添加新的屏蔽关键字
- `/removekeyword 关键字` - 移除已有的屏蔽关键字
- `/listblocked` - 查看所有被屏蔽的用户ID列表
- `/whitelist` - 查看白名单用户列表
- `/addwhitelist 用户ID` - 添加用户到白名单（白名单用户不受自动屏蔽规则限制）
- `/removewhitelist 用户ID` - 从白名单中移除用户

> **注意：** 部署前请在worker.js文件中将@UnblockBankCard1_bot替换为您自己的客服机器人

## 自动屏蔽规则
- 系统会自动屏蔽包含指定关键词的消息发送者
- 系统会自动屏蔽转发的消息发送者（包括从群组、频道或用户转发的任何消息）
- 白名单用户不受上述自动屏蔽规则限制
- 被自动屏蔽的用户会立即收到屏蔽通知，同时管理员会收到相关通知

## 欺诈数据源
- 文件[fraud.db](./fraud.db)为欺诈数据，格式为每行一个uid
- 可以通过pr扩展本数据，也可以通过提issue方式补充
- 提供额外欺诈信息时，需要提供一定的消息出处

## Thanks
- [telegram-bot-cloudflare](https://github.com/cvzi/telegram-bot-cloudflare)
