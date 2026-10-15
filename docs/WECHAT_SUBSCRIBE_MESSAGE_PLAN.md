# 微信小程序一次性订阅消息接入方案

## 1. 文档目的

本方案用于在现有“流浪足球HUB”小程序中，按照小红书教程的完整链路接入微信一次性订阅消息。

通知范围限定为现有的“信息通知发布”模块，目标是管理员继续使用现有发布功能，系统自动向目标球员发送微信“服务通知”。

本方案遵循以下约束：

- 复用现有球队通知、通知收件人、通知任务和通知工作器。
- 复用现有信息通知发布页面和已有功能按钮。
- 尽量不新增用户入口，不重复设计通知功能。
- 不改变现有小程序内通知列表、已读和权限逻辑。
- 当前使用一次性订阅消息，不依赖服务号、企业微信或长期订阅。
- 消息推送回调纳入完整链路，但必须在回调服务端点准备好后再填写微信后台配置。

## 2. 教程对应的完整链路

    后台选用订阅模板
        ↓
    配置微信消息推送回调
        ↓
    用户通过现有小程序操作完成订阅
        ↓
    保存用户、模板和剩余发送额度
        ↓
    管理员通过现有“信息通知发布”功能发布通知
        ↓
    现有通知任务进入发送工作器
        ↓
    调用微信 subscribeMessage.send
        ↓
    扣减一次性订阅额度
        ↓
    接收微信发送回执并更新发送状态
        ↓
    用户在微信“服务通知”中查看并跳回小程序

参考资料：

- [微信小程序订阅消息实践教程](https://intl.cloud.tencent.com/zh/document/product/1219/68264)
- [微信小程序管理：订阅消息](https://intl.cloud.tencent.com/zh/document/product/1219/60624)
- [微信接口：wx.requestSubscribeMessage](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)
- [微信小程序消息推送配置说明](https://wdk-docs.github.io/wxadev-docs/framework/ability/server-ability/message-push.html)

## 3. 已完成的后台准备

当前后台已经选用了两个一次性订阅模板：

1. 新活动发布提醒
2. 待缴费提醒

下一步需要从后台复制两个模板的完整模板ID，并分别打开“详情”记录：

- 模板ID；
- 模板类型；
- 关键词编号；
- 关键词名称；
- 数据格式；
- 字段长度限制。

截图中模板ID被截断，不能直接用于开发。

### 3.1 模板与现有通知类型的映射

| 现有通知类型 | 微信模板 | 使用场景 |
| --- | --- | --- |
| signup_activity | 新活动发布提醒 | 新比赛、新活动、集合安排、活动时间或地点变化 |
| fee_due | 待缴费提醒 | 缴费项目、金额和截止日期 |
| match_signup | 新活动发布提醒 | 与比赛报名相关的信息通知，需符合模板语义 |
| pending_confirmation | 待确认适配模板 | 待定报名确认，需先确认现有模板是否适合 |

模板字段必须严格按照后台配置发送，不能把任意通知内容直接放进不匹配的关键词。

## 4. 现有项目结构检查结果

现有项目已经有信息通知业务基础，但微信订阅消息链路尚未接通。

### 4.1 已有模块

- [信息通知页面](/Users/tristan/Documents/小程序/src/pages/notices/index.tsx)
- [云端通知服务](/Users/tristan/Documents/小程序/cloudfunctions-src/notifications/index.js)
- [通知任务创建](/Users/tristan/Documents/小程序/cloudfunctions-src/notifications/index.js:172)
- [通知工作器](/Users/tristan/Documents/小程序/cloudfunctions-src/notification-worker/index.js)
- [云端数据访问层](/Users/tristan/Documents/小程序/src/services/cloudStore.ts)
- [云函数调用封装](/Users/tristan/Documents/小程序/src/services/cloudService.ts)

### 4.2 当前缺口

1. 账户页的“赛事订阅提醒”目前只保存本地偏好，没有调用微信订阅授权接口。
2. 没有保存用户每个模板的订阅额度。
3. 通知工作器目前没有调用 subscribeMessage.send。
4. 普通信息通知任务没有完整接入发送工作器。
5. 没有微信消息推送回调服务端点。
6. 没有接收微信发送结果并更新收件人状态的逻辑。

当前账户页相关代码：

- [账户页订阅逻辑](/Users/tristan/Documents/小程序/src/pages/account/index.tsx:151)
- [账户页现有开关](/Users/tristan/Documents/小程序/src/pages/account/index.tsx:236)

该开关的原有业务含义应保留，用于控制用户是否接收球队通知。微信授权状态和这个业务偏好需要分别保存，避免混淆。

## 5. 执行方案

### 阶段一：后台模板确认

1. 复制两个模板的完整模板ID。
2. 记录每个模板的关键词编号。
3. 记录关键词的数据格式和长度限制。
4. 为每个现有通知类型建立字段映射。
5. 确认通知卡片点击后的页面为：

    pages/notices/index

### 阶段二：建立消息推送回调服务

小红书教程中的“开发→接口设置→消息推送”用于接收微信服务器的事件和发送结果。

现有云函数没有可直接填写的公开HTTP地址，因此需要使用以下其中一种方式提供回调服务：

- 微信云托管提供的免鉴权服务器；
- 已有的HTTPS服务器；
- 其他能够提供公网HTTPS访问的服务端点。

回调服务必须实现：

1. GET请求签名验证并返回 echostr。
2. POST请求接收微信事件。
3. 解析订阅行为和消息发送结果。
4. 根据 openid、模板ID、消息ID 更新数据库。
5. 返回微信要求的成功响应。

后台配置字段：

- URL：回调服务地址。
- Token：服务端和微信后台保持一致的校验令牌。
- EncodingAESKey：后台随机生成的43位密钥。
- 消息加密方式：服务端支持后使用安全模式。
- 数据格式：服务端解析逻辑与后台保持一致，建议使用JSON。

回调服务端点准备完成前，不要向后台提交空URL或临时URL。

### 阶段三：复用现有模块完成用户订阅

不新增独立通知页面。优先把订阅授权接入现有信息通知相关操作流程。

推荐复用的位置：

- “我的球队”页面中已有的“赛事订阅提醒”操作；
- 用户报名成功、进入通知相关流程时的现有按钮回调；
- 现有通知相关操作完成后的原有交互链路。

实现要求：

1. 用户点击现有按钮时调用 Taro.requestSubscribeMessage。
2. 一次请求两个已选用的一次性模板。
3. 只记录返回值为 accept 的模板ID。
4. 不在 onLoad 或 onShow 中自动弹出授权框。
5. 保留现有按钮和页面结构，避免新增重复入口。

示意逻辑：

    const result = await Taro.requestSubscribeMessage({
      tmplIds: [ACTIVITY_TEMPLATE_ID, FEE_TEMPLATE_ID]
    })

    const acceptedTemplateIds = Object.entries(result)
      .filter(([, status]) => status === 'accept')
      .map(([templateId]) => templateId)

    if (acceptedTemplateIds.length > 0) {
      await callCloudAction('notifications', 'recordSubscription', {
        templateIds: acceptedTemplateIds
      })
    }

“总是保持以上选择，不再询问”只能减少后续弹窗。一次性订阅仍按每次授权获得一次发送额度处理。

### 阶段四：保存订阅额度

新增 notification_subscriptions 集合，建议字段如下：

    {
      teamId,
      playerId,
      openid,
      templateId,
      subscriptionType: 'one_time',
      remainingCount: 1,
      status: 'active',
      lastAcceptedAt,
      lastSentAt,
      lastErrorCode,
      updatedAt
    }

服务端新增以下操作：

    notifications.recordSubscription
    notifications.getSubscriptionStatus

服务端必须校验模板ID属于当前小程序允许使用的模板，不能完全信任前端传入的模板ID。

每次用户授权成功，执行：

    对应用户＋对应模板的 remainingCount 加 1

不同模板的额度独立计算。用户授权“新活动发布提醒”不会增加“待缴费提醒”的额度。

### 阶段五：复用现有信息通知发布逻辑

现有管理员仍然使用信息通知页面发布消息，不新增第二套发布功能。

现有流程保持：

    管理员填写通知
    → 选择通知类型和受众
    → 发布通知
    → 写入 team_notices
    → 写入 notice_recipients
    → 写入 notification_jobs

需要扩展的部分：

1. 创建任务时写入通知类型和模板映射信息。
2. 通知工作器读取目标球员的微信订阅额度。
3. 根据通知类型选择模板ID。
4. 根据模板关键词生成发送数据。
5. 调用微信发送接口。
6. 发送成功后扣减额度。
7. 发送失败后记录错误原因。

### 阶段六：接入微信发送接口

在通知工作器中调用：

    await cloud.openapi.subscribeMessage.send({
      touser: recipient.openid,
      templateId,
      page: 'pages/notices/index',
      data: templateData
    })

发送前检查：

- 目标球员属于当前球队；
- openid存在；
- 模板额度大于0；
- 通知类型和模板匹配；
- 所有关键词字段格式正确。

发送成功后：

    remainingCount 减 1
    deliveryStatus 更新为 sent
    记录 msgId 和 sentAt

微信返回用户没有订阅额度时：

    deliveryStatus 更新为 unavailable
    记录微信错误码
    不进行无效重试

网络错误或暂时性服务错误可以进入有限次数重试。

notification-worker/config.json 需要增加微信开放接口权限：

    {
      "permissions": {
        "openapi": [
          "subscribeMessage.send"
        ]
      },
      "triggers": [
        {
          "name": "pending-signup-reminders",
          "type": "timer",
          "config": "0 */5 * * * * *"
        }
      ]
    }

### 阶段七：补齐通知工作器

现有工作器主要处理 pending_confirmation，需要扩展普通信息通知任务。

需要支持：

- signup_activity：活动或比赛发布通知；
- fee_due：缴费提醒；
- match_signup：比赛报名相关通知；
- pending_confirmation：待定报名确认。

每个任务必须具备幂等标识，避免定时器重复执行导致重复发送。

建议状态：

    pending
    processing
    sent
    partially_sent
    completed
    failed
    cancelled

### 阶段八：接收微信发送回执

回调服务收到微信结果后，更新现有 notice_recipients 记录，并保留本地站内通知状态。

建议增加字段：

    {
      wechatMsgId,
      wechatTemplateId,
      wechatDeliveryStatus,
      wechatErrorCode,
      wechatErrorMessage,
      sentAt,
      callbackAt
    }

管理端原有发送记录页面继续使用，只补充微信发送状态，不重新设计页面。

## 6. 测试方案

### 6.1 单人测试

1. 使用真实微信打开体验版或开发版。
2. 通过现有入口授权两个模板。
3. 检查数据库是否生成额度。
4. 管理员发布一条活动通知。
5. 检查微信“服务通知”。
6. 点击消息，确认跳转到球队通知页面。
7. 检查 notice_recipients 和微信发送状态。

### 6.2 两种模板测试

- 发布活动通知，验证“新活动发布提醒”。
- 发布缴费通知，验证“待缴费提醒”。

### 6.3 异常测试

- 用户拒绝授权；
- 用户没有剩余额度；
- 用户关闭服务通知；
- 模板字段超长；
- 模板数据类型错误；
- 同一通知任务重复执行；
- 多名球员中部分用户有额度、部分用户没有额度。

## 7. 验收标准

满足以下条件后，才算完成本次接入：

- 用户可以通过现有页面操作完成一次性订阅。
- 授权结果能按模板分别保存。
- 管理员继续使用原有信息通知发布功能。
- 通知可以自动进入微信“服务通知”。
- 消息卡片可以跳回小程序通知页面。
- 发送成功后额度正确扣减。
- 无额度用户不会被反复发送。
- 管理端可以查看发送结果。
- 微信回执能够更新本地记录。
- 原有小程序内通知列表、已读、权限和发布流程不受影响。

## 8. 开发边界

本次接入暂不包含：

- 长期订阅消息；
- 服务号消息；
- 企业微信机器人；
- 新增独立通知中心页面；
- 改造现有信息通知发布页面的整体结构；
- 在用户无操作时强制弹出订阅授权。

本次开发优先完成：

    现有信息通知发布
    → 微信服务通知
    → 小程序通知详情
    → 发送状态回写

## 9. 下个对话的启动指令

下个对话可以直接使用以下上下文继续：

> 按 docs/WECHAT_SUBSCRIBE_MESSAGE_PLAN.md 执行微信一次性订阅消息接入。先读取当前项目状态和未提交改动，复用现有信息通知发布模块、通知收件人、通知任务和通知工作器，不新增重复通知按钮。先实现模板授权和单人发送闭环，再实现批量发送、回执和验收。任何微信后台URL、Token、EncodingAESKey配置先不要提交，等回调服务端点验证完成后再配置。

