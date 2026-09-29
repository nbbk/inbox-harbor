const POLICY_VERSION = '2026-09-29';
const DEFAULT_CONTACT_EMAIL = 'nianbaa@gmail.com';
function readLegalSettings(auth) {
  return { operatorName: auth.setting('legal_operator_name', ''), contactEmail: auth.setting('legal_contact_email', DEFAULT_CONTACT_EMAIL), updatedAt: auth.setting('legal_updated_at', '') };
}
function validateLegalSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('公开信息格式无效');
  const { operatorName, contactEmail } = body;
  if (typeof operatorName !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(operatorName) || [...operatorName.trim()].length > 100) throw new Error('运营者名称最多 100 个字符，不能包含控制字符');
  if (typeof contactEmail !== 'string' || contactEmail.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(contactEmail.trim())) throw new Error('请填写有效的公开联系邮箱');
  return { operatorName: operatorName.trim(), contactEmail: contactEmail.trim() };
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderLegalPage(kind, settings, siteName) {
  const name = escapeHtml(siteName), operator = escapeHtml(settings.operatorName || '本部署站点运营者（Owner）');
  const email = escapeHtml(settings.contactEmail), contact = '<a href="mailto:' + email + '">' + email + '</a>';
  const privacy = kind === 'privacy', title = privacy ? '隐私权政策' : '服务条款';
  const sections = privacy ? [
    ['适用范围与运营者', '<p>本政策说明 ' + name + ' 如何处理您的个人信息和邮件数据。本服务是基于 InboxHarbor（收件港）部署的多邮箱管理工作台，提供 Google / Microsoft 邮箱授权、邮件同步、检索分类、验证码提取、可选发信与通知功能。</p><p>本部署运营者：' + operator + '。隐私、访问、更正、删除及投诉联系邮箱：' + contact + '。软件源代码作者不因此自动成为本部署的数据运营者。</p>'],
    ['我们访问和保存哪些数据', '<ul><li>站点账号：注册邮箱、角色、密码的不可逆哈希、登录会话、恢复码的校验数据，以及必要的安全与操作审计记录。</li><li>连接邮箱：邮箱地址、服务商、授权范围、OAuth 访问令牌与刷新令牌、同步游标、时间和错误状态。本服务不要求您提供 Google 或 Microsoft 邮箱的登录密码。</li><li>邮件：发件人、收件人和抄送、主题、时间、正文文本与摘要、附件元信息、正文中的验证码和链接，以及分类、收藏、置顶、已读等本服务内状态。需要发送邮件时，还会处理您填写的收件人、主题和正文。</li><li>通知与偏好：您填写的通知接收地址、机器人或接口凭据、SMTP 凭据、过滤规则、静默时段、投递记录和共享链接。请勿在公开联系邮箱或运营者名称中填写密码、密钥等秘密。</li></ul>'],
    ['处理目的与授权范围', '<p>数据仅用于您使用的邮件管理、同步、搜索、分类、验证码识别、发送、通知及必要的安全维护。分类与验证码提取使用程序规则，不把邮件提交给通用人工智能模型训练。</p><p>Google 默认请求 gmail.readonly 和邮箱身份信息；仅在您主动开启发信并重新授权时请求 gmail.send。Microsoft 请求身份信息、offline_access 与 Mail.Read；可选发信请求 Mail.Send。最终范围以服务商授权页面为准。刷新令牌用于您离线时继续同步，不表示永久授权，您或服务商都可能撤销授权。</p><p>本站对 Google API 数据的使用和向其他应用的转移遵守 <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noreferrer">Google API Services User Data Policy</a>，包括 Limited Use 要求。不会出售 Google 用户数据，或将其用于广告定向、信用评估或训练通用人工智能模型。人工访问仅限取得您明确同意的支持、安全调查、遵守法律等该政策允许的情形。</p>'],
    ['第三方服务与共享链接', '<p>同步与发信会与 Google Gmail API 或 Microsoft Graph 通信。您启用通知后，所选 Telegram、Bark、WxPusher、PushPlus、Server酱、企业微信、钉钉、SMTP 或自定义 Webhook 接收方会收到账户、发件人、主题、时间、摘要及邮件查看链接；摘要可能包含验证码等敏感内容。仅启用您信任的渠道，群聊内其他成员也可能看到通知。</p><p><strong>邮件查看链接免登录、只读，持有有效链接的人可以查看对应邮件内容。</strong>请将链接当作秘密保管。有效期由通知设置控制，您可在个人中心撤销链接。撤销或到期不能收回第三方已经下载、复制或转发的内容。</p><p>本服务不出售邮件或将其用于广告。除完成您选择的功能、经您明确同意或依法必要的情形外，不向无关第三方披露邮件。服务商按自己的政策处理所接收的数据：<a href="https://policies.google.com/privacy" rel="noreferrer">Google 隐私政策</a>、<a href="https://privacy.microsoft.com/privacystatement" rel="noreferrer">Microsoft 隐私声明</a>；通知渠道请查阅相应服务商政策。</p>'],
    ['存储位置与安全', '<p>业务数据保存在运营者部署服务器的数据目录和 SQLite 数据库中；“自托管”不表示数据只保存在您的浏览器或个人电脑。邮件与凭据等业务载荷使用 AES-256-GCM 加密，账号标识、时间、状态等部分元数据并非全库加密。站点登录密码使用哈希保存。</p><p>这不是端到端加密：服务器必须解密数据才能同步和展示邮件，掌握服务器及主密钥的运营者具有访问能力。普通用户的业务数据按用户隔离。运营者负责 HTTPS、服务器权限、主密钥与备份安全，并将人员访问限制在必要范围内。无法承诺任何系统绝无安全风险。</p><p>服务器、备份及您选择的第三方服务可能位于不同国家或地区；具体部署位置和备份安排请通过本页联系方式查询，不能仅从邮箱服务商推断存储地点。</p>'],
    ['保留期限与删除', '<p>邮件归档、账号配置和操作记录按功能需要保留，直至您删除、注销，或运营者依据实际维护与法定义务清理。本版本未为全部数据设置统一的固定天数自动清理期限，不应将本站作为唯一邮件备份。</p><ul><li>在邮件中心删除邮件，仅删除本服务的归档，不会删除 Google / Microsoft 中的原邮件；为避免重复同步，可能保留相应邮件的删除标识。</li><li>暂停同步或在服务商侧撤回授权，会停止相应后续访问，但不会自动删除本站已经同步的数据。彻底退出时请同时删除本站数据。</li><li>您可在个人中心撤销共享链接、注销站点账号；注销需要验证当前密码。也可以联系运营者提出访问、更正或删除请求。为保护账号，运营者会核实请求人的身份，但不会索取邮箱密码或完整 OAuth 令牌。</li><li>删除在线数据不等于立即擦除已有备份或第三方通知副本。备份保留和清理安排、必要的安全审计或依法保留例外，由运营者向您说明；第三方副本需向对应服务商申请处理。</li></ul>'],
    ['Cookie、浏览器存储与访问记录', '<p>本服务使用会话 Cookie 保持登录，使用浏览器本地存储和会话存储保存筛选偏好、页面位置等体验设置。这些是登录和界面功能所需，不用于广告追踪。退出登录或清理浏览器数据可能清除部分状态。</p><p>服务器或反向代理可能为运行、安全和排错记录访问时间、IP 地址、请求路径及错误信息。页面使用的外部资源服务可能收到加载请求的网络信息。运营者应限制日志内容与保留期限，避免记录邮件正文、密码、令牌和完整共享链接。</p>'],
    ['您的选择、未成年人及政策更新', '<p>您可以选择不连接邮箱、不启用发信或第三方通知。可在 <a href="https://myaccount.google.com/connections" rel="noreferrer">Google 第三方连接</a> 或 <a href="https://account.live.com/consent/Manage" rel="noreferrer">Microsoft 应用授权管理</a> 撤销授权；工作或学校账户还可能需要组织管理员处理。</p><p>本服务面向能够自行管理邮箱并作出有效授权的用户。未成年人应在适用法律要求下取得监护人同意；若发现未经适当授权处理未成年人信息，请联系运营者。</p><p>政策发生实质变化时，运营者应通过站内或适当渠道告知；新增处理目的或权限需要依法另行说明并取得相应授权。联系邮箱：' + contact + '。</p>']
  ] : [
    ['服务与运营者', '<p>' + name + ' 是多邮箱管理工具，支持通过官方 OAuth 连接 Google / Microsoft 邮箱，集中读取、搜索与分类邮件、提取验证码、可选发信及第三方通知。本部署由 ' + operator + ' 运营，联系邮箱为 ' + contact + '。</p><p>请在使用前阅读本条款与<a href="/privacy">隐私权政策</a>。本条款说明服务使用规则，不替代您与邮箱或通知服务商之间的约定。</p>'],
    ['账号与授权', '<p>请仅连接您拥有或有权管理的邮箱，提供真实且可联系的账号信息，妥善保管站点密码、恢复码和共享链接。不要向他人提供账号会话或 OAuth 凭据。发现异常访问时请及时修改站点密码、撤销服务商授权并联系运营者。</p><p>邮箱读取与发送权限分别由您选择并在服务商页面授权。开启发信后，发送行为及收件人由您确认。授权可能因服务商策略、组织规则、密码或安全事件失效，长期同步不能保证永不需要重新授权。</p>'],
    ['合理使用', '<p>不得未经许可访问他人邮箱、窃取验证码、传播恶意程序、发送垃圾邮件、侵犯他人隐私或知识产权，或绕过服务商限流、配额和安全措施。不得利用本站实施违法行为或干扰其他用户正常使用。</p><p>请确保您有权处理、转发或分享邮件及其中涉及的第三方信息。启用通知前核对接收方；公开群聊、第三方机器人和自定义 Webhook 会扩大数据可见范围。</p>'],
    ['数据与共享', '<p>您保留对自己的内容依法享有的权利。您授权本服务在实现您选择的功能所必要的范围内访问、存储、展示和传输这些内容，具体见隐私权政策。</p><p>免登录邮件链接可由持有者访问，撤销不能收回已经复制的内容。删除本站归档不会删除上游原邮件；撤回 OAuth 也不会自动清空本站历史数据。请按隐私政策中的步骤管理和删除数据。</p>'],
    ['可用性与功能限制', '<p>同步和通知受网络、服务商接口、配额、服务器维护及配置影响，可能延迟、中断或失败。分类和验证码提取可能不准确，请以原始邮件为准。本站不应作为紧急通知、唯一备份或对时效有关键要求的唯一渠道。</p><p>运营者应采取合理维护措施，但不承诺连续无故障或符合所有特殊用途。发生数据或服务问题时请及时联系运营者。任何责任限制均以适用法律允许的范围为限，不排除依法不得排除的权利和责任。</p>'],
    ['暂停、终止与注销', '<p>您可停止使用、撤销邮箱授权、停用通知或注销站点账号。若出现滥用、安全风险或法律要求，运营者可采取必要的访问限制；在可行且合法的情况下说明原因并提供联系渠道。结束服务后的数据处理按隐私权政策执行。</p><p>如运营者计划停止服务，应在可行范围内提前通知，并说明数据取回或删除安排。本条款本身不构成固定存储期限、免费期限或付费订阅承诺。</p>'],
    ['第三方、开源软件与更新', '<p>Google、Microsoft 和通知渠道由各自运营者提供，本站与其并非同一服务，不代表取得其背书或通过其全部审核。使用第三方服务还需遵守其条款。</p><p>底层 InboxHarbor 源代码的使用受仓库开源许可证约束；源代码许可与本部署的服务条款分别适用。运营者可因功能、安全或法律变化更新条款，并对实质变化作适当通知，不以页面改动自动扩大邮箱权限。</p>'],
    ['联系与争议处理', '<p>对服务、数据处理或账号限制有疑问，请联系 ' + contact + '，说明相关账号和问题，但请勿发送密码、恢复码、OAuth 令牌或不必要的完整邮件。双方应先尝试沟通解决，依法保留通过适用的投诉和争议解决途径维护权利的权利。</p>']
  ];
  const toc = sections.map(([h], i) => '<a href="#section-' + i + '">' + (i + 1) + '. ' + h + '</a>').join('');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>' + title + ' · ' + name + '</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f8fa;color:#17324d;font:16px/1.85 system-ui,sans-serif}main{max-width:900px;margin:40px auto;padding:40px;background:#fff;border:1px solid #dbe7ec;border-radius:18px}a{color:#096d94;text-underline-offset:3px;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:12px 24px}h1{font-size:32px;line-height:1.3}h2{font-size:21px;margin-top:36px}p,li{overflow-wrap:anywhere}li{margin:10px 0}.meta{color:#526b7c;font-size:14px}.toc{display:grid;background:#f4f8fa;padding:18px;border-radius:12px}footer{border-top:1px solid #dbe7ec;margin-top:36px;padding-top:20px}@media(max-width:600px){main{margin:0;border:0;border-radius:0;padding:24px 20px}h1{font-size:28px}}@media print{body{background:#fff}main{margin:0;max-width:none;border:0}.toc{display:none}}</style></head><body><main><nav aria-label="公开页面"><a href="/">' + name + ' 首页 / 登录</a><a href="/privacy">隐私权政策</a><a href="/terms">服务条款</a></nav><header><h1>' + title + '</h1><p class="meta">内容版本：' + POLICY_VERSION + (settings.updatedAt ? ' · 运营信息更新：' + escapeHtml(settings.updatedAt.slice(0,10)) : '') + '</p></header><nav class="toc" aria-label="目录">' + toc + '</nav>' + sections.map(([h, content],i) => '<section id="section-' + i + '"><h2>' + (i+1) + '. ' + h + '</h2>' + content + '</section>').join('') + '<footer>联系运营者：' + contact + ' · <a href="/">返回首页</a></footer></main></body></html>';
}
function registerLegalRoutes(app, auth, readSiteName) {
  for (const kind of ['privacy','terms']) app.get('/' + kind, (req,res) => {
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});
    res.type('html').send(renderLegalPage(kind, readLegalSettings(auth), readSiteName(auth)));
  });
  app.put('/api/v1/legal-settings', (req,res) => {
    if (req.user?.role !== 'owner') return res.status(403).json({success:false,message:'仅 Owner 可以修改公开运营信息'});
    try {
      const value = validateLegalSettings(req.body);
      auth.db.exec('BEGIN IMMEDIATE');
      try {
        auth.setSetting('legal_operator_name', value.operatorName);
        auth.setSetting('legal_contact_email', value.contactEmail);
        auth.setSetting('legal_updated_at', new Date().toISOString());
        auth.audit(req.user, 'instance.legal.updated', 'instance', null, {});
        auth.db.exec('COMMIT');
      } catch (error) { auth.db.exec('ROLLBACK'); throw error; }
      res.set('Cache-Control','no-store').json({success:true,...readLegalSettings(auth)});
    } catch (error) { res.status(400).json({success:false,message:error.message}); }
  });
}
module.exports = { readLegalSettings, validateLegalSettings, renderLegalPage, registerLegalRoutes };
