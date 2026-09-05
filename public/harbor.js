(() => {
  const root = document.getElementById("harbor-ui");
  let token = sessionStorage.getItem("inboxharbor-token") || "";
  let catalog = {};
  let config = { includeFullBody: true, channels: [] };
  let mailState = {
    mails: [],
    accounts: [],
    category: "全部",
    account: "全部",
    query: "",
    selectedId: "",
  };
  const esc = (value) => String(value || "");
  function request(url, opts = {}) {
    return fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    }).then(async (r) => {
      const text = await r.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { message: `服务返回异常（HTTP ${r.status}）` };
      }
      if (!r.ok) throw new Error(body.message || "请求失败");
      return body;
    });
  }
  function lock() {
    token = "";
    sessionStorage.removeItem("inboxharbor-token");
    renderLock();
  }
  function renderLock() {
    root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "ih-lock";
    const card = document.createElement("div");
    card.innerHTML =
      '<span class="ih-mark">IH</span><h1>InboxHarbor</h1><p>输入启动终端显示的本机访问口令。</p>';
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.type = "password";
    input.placeholder = "本机访问口令";
    input.required = true;
    const button = document.createElement("button");
    button.className = "ih-button";
    button.textContent = "进入收件港";
    form.append(input, button);
    form.onsubmit = (e) => {
      e.preventDefault();
      token = input.value;
      request("/api/stats")
        .then(() => {
          sessionStorage.setItem("inboxharbor-token", token);
          render();
        })
        .catch((err) => alert(err.message));
    };
    card.append(form);
    box.append(card);
    root.append(box);
  }
  function element(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function navButton(label, page) {
    const b = element("button", page === "overview" ? "active" : "", label);
    b.dataset.page = page;
    return b;
  }
  function render() {
    root.innerHTML = "";
    const shell = element("div", "ih-shell");
    const side = element("aside", "ih-side");
    const brand = element("div", "ih-brand");
    brand.innerHTML =
      '<span class="ih-mark">IH</span><div><b>InboxHarbor</b><small>收件港</small></div>';
    const nav = element("nav", "ih-nav");
    [
      "概览|overview",
      "邮箱账户|accounts",
      "连接器设置|connectors",
      "通知渠道|notifications",
      "使用说明|guide",
    ].forEach((x) => {
      const [a, b] = x.split("|");
      nav.append(navButton(a, b));
    });
    side.append(brand, nav, element("div", "ih-local", "● 本机私有服务"));
    const main = element("main", "ih-main");
    const head = element("header", "ih-head");
    const lockButton = element("button", "ih-button ih-button-quiet", "锁定");
    lockButton.onclick = lock;
    head.append(element("div"), lockButton);
    main.append(
      head,
      overview(),
      accounts(),
      connectors(),
      notifications(),
      guide(),
    );
    shell.append(side, main);
    const mobile = element("nav", "ih-mobile");
    [
      "概览|overview",
      "账户|accounts",
      "设置|connectors",
      "通知|notifications",
      "帮助|guide",
    ].forEach((x) => {
      const [a, b] = x.split("|");
      mobile.append(navButton(a, b));
    });
    shell.append(mobile);
    root.append(shell);
    root
      .querySelectorAll("[data-page]")
      .forEach((b) => (b.onclick = () => show(b.dataset.page)));
    load();
  }
  function show(page) {
    root
      .querySelectorAll(".ih-page")
      .forEach((n) => n.classList.toggle("active", n.id === "ih-" + page));
    root
      .querySelectorAll("[data-page]")
      .forEach((n) => n.classList.toggle("active", n.dataset.page === page));
  }
  function handleAuthorizationError(error) {
    alert(error.message);
    if (/未配置.*(CLIENT|OAuth)|请填写.*Client/i.test(error.message)) {
      show("connectors");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
  function overview() {
    const s = element("section", "ih-page active");
    s.id = "ih-overview";
    s.innerHTML = `<div class="ih-mail-head"><div><h1>邮件中心</h1><p>聚合查看所有账户的重要邮件与验证码。</p></div><div class="ih-mail-head-actions"><span id="ih-mail-summary">0 封邮件</span><button id="ih-compose" class="ih-button">写邮件</button></div></div>
      <div class="ih-mail-categories" id="ih-mail-categories" aria-label="邮件分类"></div>
      <div class="ih-mail-tools"><label class="ih-mail-search"><span>搜索</span><input id="ih-mail-search" placeholder="搜索主题、发件人或正文"></label><label><span>邮箱账户</span><select id="ih-mail-account"><option value="全部">全部账户</option></select></label></div>
      <div class="ih-mail-workspace"><div class="ih-mail-list" id="ih-mail-list"></div><article class="ih-mail-reader" id="ih-mail-reader"><div class="ih-mail-empty"><b>选择一封邮件</b><span>正文会在这里清晰呈现。</span></div></article></div>`;
    s.querySelector("#ih-compose").onclick = openCompose;
    s.querySelector("#ih-mail-search").oninput = (event) => {
      mailState.query = event.target.value.trim().toLowerCase();
      renderMailCenter();
    };
    s.querySelector("#ih-mail-account").onchange = (event) => {
      mailState.account = event.target.value;
      renderMailCenter();
    };
    return s;
  }

  const mailCategories = [
    "全部",
    "已发送",
    "验证码",
    "通知",
    "账单",
    "社交",
    "推广",
    "其他",
  ];

  function formatMailTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function visibleMails() {
    return mailState.mails.filter((mail) => {
      if (mailState.category !== "全部" && mail.category !== mailState.category)
        return false;
      if (mailState.account !== "全部" && mail.account !== mailState.account)
        return false;
      if (!mailState.query) return true;
      return `${mail.subject || ""} ${mail.sender || ""} ${mail.content || ""}`
        .toLowerCase()
        .includes(mailState.query);
    });
  }

  function renderMailCenter(mails, accounts) {
    if (mails) mailState.mails = mails;
    if (accounts) mailState.accounts = accounts;
    const list = document.getElementById("ih-mail-list");
    if (!list) return;
    const categories = document.getElementById("ih-mail-categories");
    categories.replaceChildren();
    mailCategories.forEach((category) => {
      const count =
        category === "全部"
          ? mailState.mails.length
          : mailState.mails.filter((mail) => mail.category === category).length;
      const button = element(
        "button",
        category === mailState.category ? "active" : "",
        `${category} ${count}`,
      );
      button.onclick = () => {
        mailState.category = category;
        mailState.selectedId = "";
        renderMailCenter();
      };
      categories.append(button);
    });
    const accountSelect = document.getElementById("ih-mail-account");
    const current = mailState.account;
    accountSelect.replaceChildren(new Option("全部账户", "全部"));
    [...new Set(mailState.accounts.map((account) => account.username))].forEach(
      (username) => accountSelect.append(new Option(username, username)),
    );
    accountSelect.value = current;
    const filtered = visibleMails();
    document.getElementById("ih-mail-summary").textContent = `${filtered.length} 封邮件`;
    list.replaceChildren();
    if (!filtered.length) {
      const empty = element("div", "ih-mail-empty");
      empty.append(element("b", "", "没有符合条件的邮件"), element("span", "", "换个分类或搜索词试试。"));
      list.append(empty);
      renderMailReader(null);
      return;
    }
    if (!filtered.some((mail) => mail.id === mailState.selectedId))
      mailState.selectedId = filtered[0].id;
    filtered.forEach((mail) => {
      const button = element(
        "button",
        `ih-mail-row${mail.id === mailState.selectedId ? " active" : ""}`,
      );
      const top = element("span", "ih-mail-row-top");
      top.append(
        element(
          "b",
          "",
          mail.direction === "sent"
            ? `发送至 ${mail.recipient || "未知收件人"}`
            : mail.sender || "未知发件人",
        ),
        element("time", "", formatMailTime(mail.receivedAt)),
      );
      const subject = element("strong", "", mail.subject || "无主题");
      const preview = element("span", "ih-mail-preview", mail.preview || mail.content || "无正文内容");
      const meta = element("span", "ih-mail-row-meta");
      meta.append(
        element("em", `ih-mail-tag ih-mail-tag-${mail.category}`, mail.category || "其他"),
        element("small", "", mail.account || ""),
      );
      button.append(top, subject, preview, meta);
      button.onclick = () => {
        mailState.selectedId = mail.id;
        renderMailCenter();
        if (matchMedia("(max-width: 760px)").matches)
          document.getElementById("ih-mail-reader").scrollIntoView({ behavior: "smooth" });
      };
      list.append(button);
    });
    renderMailReader(filtered.find((mail) => mail.id === mailState.selectedId));
  }

  function renderMailReader(mail) {
    const reader = document.getElementById("ih-mail-reader");
    if (!reader) return;
    reader.replaceChildren();
    if (!mail) {
      const empty = element("div", "ih-mail-empty");
      empty.append(element("b", "", "选择一封邮件"), element("span", "", "正文会在这里清晰呈现。"));
      reader.append(empty);
      return;
    }
    const tag = element("span", `ih-mail-tag ih-mail-tag-${mail.category}`, mail.category || "其他");
    const readerTop = element("div", "ih-reader-top");
    const title = element("h2", "", mail.subject || "无主题");
    const remove = element("button", "ih-button ih-button-danger", "删除邮件");
    remove.onclick = () => deleteMail(mail);
    readerTop.append(tag, remove);
    const meta = element("div", "ih-reader-meta");
    const sender = element("div");
    sender.append(
      element(
        "b",
        "",
        mail.direction === "sent"
          ? mail.account || "未知发件账户"
          : mail.sender || "未知发件人",
      ),
      element(
        "span",
        "",
        mail.direction === "sent"
          ? `发送至 ${mail.recipient || "未知收件人"}`
          : `发送至 ${mail.account || "未知账户"}`,
      ),
    );
    meta.append(sender, element("time", "", formatMailTime(mail.receivedAt)));
    reader.append(readerTop, title, meta);
    if (mail.code && mail.code !== "未发现验证码") {
      const codeBox = element("div", "ih-code-box");
      const copy = element("button", "ih-button ih-button-quiet", "复制验证码");
      copy.onclick = async () => {
        await copyText(mail.code, copy);
        copy.textContent = "已复制";
      };
      codeBox.append(element("span", "", "验证码"), element("strong", "", mail.code), copy);
      reader.append(codeBox);
    }
    const body = element("div", "ih-mail-body", mail.content || "无正文内容");
    reader.append(body);
  }

  async function deleteMail(mail) {
    if (!confirm(`确定从本地归档删除“${mail.subject || "无主题"}”吗？`)) return;
    try {
      await request(`/api/mails/${encodeURIComponent(mail.id)}`, {
        method: "DELETE",
      });
      mailState.mails = mailState.mails.filter((item) => item.id !== mail.id);
      mailState.selectedId = "";
      renderMailCenter();
    } catch (error) {
      alert(error.message);
    }
  }

  function openCompose() {
    const eligible = mailState.accounts.filter((account) => {
      const requiredScope =
        account.provider === "google"
          ? "https://www.googleapis.com/auth/gmail.send"
          : "Mail.Send";
      return (
        account.sendEnabled === true &&
        account.status === "active" &&
        String(account.providerScopes || "").split(/\s+/).includes(requiredScope)
      );
    });
    const dialog = element("dialog", "ih-dialog ih-compose-dialog");
    const form = element("form", "ih-dialog-card ih-compose-card");
    form.method = "dialog";
    form.innerHTML = `<div class="ih-dialog-head"><div><h2>写邮件</h2><p>使用已开启发信权限并重新授权的账户发送。</p></div><button type="button" class="ih-dialog-close" aria-label="关闭">×</button></div>
      <label class="ih-field-label">发件账户<select name="accountId" required><option value="">请选择发件账户</option></select></label>
      <label class="ih-field-label">收件人<input name="to" type="email" placeholder="name@example.com" required></label>
      <label class="ih-field-label">主题<input name="subject" maxlength="200" placeholder="请输入邮件主题" required></label>
      <label class="ih-field-label">正文<textarea name="body" rows="10" maxlength="100000" placeholder="请输入邮件正文" required></textarea></label>
      <p class="ih-dialog-help">${eligible.length ? "发送前请再次核对收件人。" : "暂无可发信账户。请先到邮箱账户开启发信权限，并重新完成 OAuth 授权。"}</p>
      <div class="ih-dialog-actions"><button type="button" class="ih-button ih-button-quiet ih-compose-cancel">取消</button><button type="submit" class="ih-button" ${eligible.length ? "" : "disabled"}>发送邮件</button></div>`;
    const select = form.elements.accountId;
    eligible.forEach((account) =>
      select.append(new Option(`${account.username} · ${account.provider}`, account.id)),
    );
    dialog.append(form);
    document.body.append(dialog);
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    form.querySelector(".ih-dialog-close").onclick = close;
    form.querySelector(".ih-compose-cancel").onclick = close;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      submit.textContent = "正在发送…";
      try {
        const values = new FormData(form);
        const result = await request("/api/mails/send", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(values)),
        });
        if (result.mail) {
          mailState.mails = [result.mail, ...mailState.mails];
          mailState.category = "已发送";
          mailState.selectedId = result.mail.id;
          renderMailCenter();
        }
        close();
        alert(result.message || "邮件已发送");
      } catch (error) {
        form.querySelector(".ih-dialog-help").textContent = error.message;
        submit.disabled = false;
        submit.textContent = "发送邮件";
      }
    };
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.showModal();
  }
  function accounts() {
    const s = element("section", "ih-page");
    s.id = "ih-accounts";
    s.innerHTML =
      '<div class="ih-section-head"><div><h1>邮箱账户</h1><p class="ih-section-copy">统一管理 Google 与 Microsoft 邮箱授权、收件和发信权限。</p></div><div class="ih-section-actions"><button id="ih-fetch" class="ih-button ih-button-quiet">手动取件</button><button id="ih-add" class="ih-button">添加邮箱</button></div></div><div class="ih-account-surface" id="ih-accounts-list">正在加载账户…</div>';
    return s;
  }
  function notifications() {
    const s = element("section", "ih-page");
    s.id = "ih-notifications";
    s.innerHTML =
      '<div class="ih-section-head"><div><p class="ih-eyebrow">FULL BODY DELIVERY</p><h2>通知渠道</h2></div><label>完整正文 <input id="ih-full" type="checkbox" checked></label></div><div class="ih-layout"><div><div class="ih-channels" id="ih-channel-list"></div><button id="ih-save" class="ih-button">保存通知设置</button></div><aside class="ih-card ih-guide" id="ih-channel-guide"><p class="ih-eyebrow">CONFIGURATION</p><h3>选择一个渠道</h3><p>Telegram、Bark、微信、钉钉和 Webhook 都在这里配置；凭据不会回显。</p></aside></div>';
    return s;
  }
  function connectors() {
    const s = element("section", "ih-page");
    s.id = "ih-connectors";
    s.innerHTML = `
      <div class="ih-section-head"><div><h1>连接器设置</h1><p class="ih-section-copy">每个平台只配置一次应用，之后可以逐个授权任意多个邮箱。</p></div></div>
      <div class="ih-connector-status" id="cx-summary" aria-live="polite"></div>
      <div class="ih-connector-layout">
        <form class="ih-connector-form" id="cx-form">
          <section class="ih-setup-block">
            <div class="ih-setup-heading"><span>1</span><div><h2>外部访问地址</h2><p>填写浏览器访问 InboxHarbor 的完整地址，用于生成 Google 回调地址。</p></div></div>
            <label class="ih-field-label">PUBLIC_BASE_URL<input id="cx-base" placeholder="https://mail.example.com" autocomplete="url"><small>格式：必须包含 https://；公网地址不能带路径或参数。</small></label>
            <div class="ih-copy-field"><code id="cx-callback">保存地址后自动生成</code><button type="button" id="cx-copy" class="ih-button ih-button-quiet">复制回调地址</button></div><p class="ih-callback-note">此地址只需复制到 Google 控制台的 Authorized redirect URIs，请勿直接在浏览器打开；直接打开显示“这里是 Google OAuth 回调地址，不是登录页面”属于正常现象。</p>
          </section>
          <section class="ih-setup-block">
            <div class="ih-setup-heading"><span>2</span><div><h2>Microsoft 邮箱</h2><p>一个应用配置可供所有 Outlook、Hotmail 与 Microsoft 365 邮箱分别授权。</p></div></div>
            <label class="ih-field-label">Application (client) ID<input id="cx-ms" placeholder="00001111-aaaa-2222-bbbb-3333cccc4444" autocomplete="off"><small>格式：36 位 UUID，只填写“应用程序(客户端) ID”，不需要 Client Secret。</small></label>
            <details class="ih-tutorial"><summary>Microsoft 新手配置教程（展开逐步操作）</summary><ol><li>打开 <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer">Microsoft Entra 应用注册</a>并登录；若链接停在首页，依次点“Microsoft Entra ID → 管理 → 应用注册”。</li><li>点击“新注册”。名称可填 <code>InboxHarbor</code>；若要同时授权 Outlook/Hotmail 和企业 Microsoft 365，账户类型选“任何组织目录中的账户和个人 Microsoft 账户”；重定向 URI 暂时留空，然后点“注册”。</li><li>注册完成会进入“概述”。复制“应用程序(客户端) ID”（36 位 UUID）并粘贴到本页上方；不要复制“对象 ID”或“目录 ID”。</li><li>左侧点“管理 → 身份验证”，向下找到“高级设置 → 允许公共客户端流”，选“是”并保存。InboxHarbor 使用设备代码登录，因此不用创建 Client Secret。</li><li>左侧点“API 权限 → 添加权限 → Microsoft Graph → 委托的权限”，搜索并勾选 <code>Mail.Read</code>；需要发送邮件时再勾选 <code>Mail.Send</code>，最后点“添加权限”。</li><li>回到本页点“保存并检测配置”，再到“邮箱账户”添加地址并逐个点“授权”。出现设备代码后，按提示打开微软登录页，必须登录当前这一行对应的邮箱。另见 <a href="https://learn.microsoft.com/zh-cn/entra/identity-platform/quickstart-register-app" target="_blank" rel="noopener noreferrer">微软官方注册教程</a>。</li></ol></details>
          </section>
          <section class="ih-setup-block">
            <div class="ih-setup-heading"><span>3</span><div><h2>Google 邮箱</h2><p>一个 Web OAuth 客户端可供多个 Gmail 或 Google Workspace 邮箱分别授权。</p></div></div>
            <label class="ih-field-label">Google Client ID<input id="cx-google" placeholder="123456789012-abcdef.apps.googleusercontent.com" autocomplete="off"><small>格式：通常以数字开头，并以 <code>.apps.googleusercontent.com</code> 结尾。</small></label>
            <label class="ih-field-label">Google Client Secret<input id="cx-secret" type="password" placeholder="已配置时留空可保持原值" autocomplete="new-password"><small>只在保存时提交；保存后加密存储且页面不会回显。</small></label>
            <label class="ih-clear-secret"><input id="cx-clear" type="checkbox"> 清除已保存的 Google Client Secret</label>
            <details class="ih-tutorial"><summary>Google 新手配置教程（展开逐步操作）</summary><ol><li>打开 <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">Google Cloud 新建项目</a>并登录。项目名称填写 <code>InboxHarbor</code>（也可自定义）；个人账号看到“组织/位置”时保持“无组织”，企业 Workspace 账号按管理员要求选择；点击“创建”，等待右上角通知显示完成。</li><li>点击控制台顶部的项目名称，搜索并选中刚创建的 <code>InboxHarbor</code>。以后每打开一个 Google 配置链接，都先核对顶部显示的是这个项目，避免配置到别的项目。</li><li>打开 <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer">Gmail API</a>，点击“启用”；如果按钮显示“管理”，说明已经启用。</li><li>打开 <a href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noopener noreferrer">Branding</a>。若出现“Get started”，点击后填写 App name：<code>InboxHarbor</code>、User support email：你的常用邮箱、Developer contact information：你的联系邮箱，然后保存并继续。</li><li>打开 <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener noreferrer">Audience</a>。个人 Gmail 选择 External；企业 Workspace 仅限本组织使用时可选 Internal。保持 Publishing status 为 Testing，并在“Test users → Add users”逐个加入所有准备授权的 Gmail 地址。</li><li>打开 <a href="https://console.cloud.google.com/auth/scopes" target="_blank" rel="noopener noreferrer">Data Access</a>，点击“Add or remove scopes”，添加 Gmail API 的 <code>.../auth/gmail.readonly</code>；需要发信再添加 <code>.../auth/gmail.send</code>，保存。</li><li>先在本页填写外部访问地址并复制生成的 Google 回调地址。再打开 <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Clients</a>，点击“Create client”，Application type 选择“Web application”，Name 填 <code>InboxHarbor Web</code>。</li><li>在“Authorized redirect URIs”点击“Add URI”，粘贴本页回调地址，例如 <code>https://mail.example.com/auth/google/callback</code>；不要填首页、不要多斜杠。点击“Create”，复制 Client ID 与 Client Secret 到本页并点“保存并检测配置”。</li><li>到“邮箱账户”添加地址并逐个授权。若仍显示 Access blocked，检查该邮箱是否已加入 Test users、项目是否选对，以及回调地址是否逐字一致。另见 <a href="https://developers.google.com/workspace/gmail/api/auth/web-server" target="_blank" rel="noopener noreferrer">Google 官方 Gmail OAuth 教程</a>。</li></ol></details>
            <p class="ih-callback-note"><b>长期运行提醒：</b>Data Access 还应添加 <code>userinfo.email</code> 用于核对邮箱身份。Google 的 External + Testing 模式使用 Gmail scope 时，授权通常 7 天后失效；完成测试后请按 Audience 页面要求切换到 Production。</p>
          </section>
          <div class="ih-connector-actions"><button type="submit" id="cx-save" class="ih-button">保存并检测配置</button><span id="cx-result" aria-live="polite"></span></div>
        </form>
        <aside class="ih-setup-aside"><h2>如何授权多个邮箱</h2><ol><li>Google 与 Microsoft 的应用配置各保存一次。</li><li>到“邮箱账户”批量添加地址，并选择对应平台。</li><li>在每一行点击“授权”，登录与该行完全相同的邮箱。</li><li>默认只读；开启发信后，需要为该邮箱重新授权。</li></ol><p>程序不会保存邮箱登录密码。OAuth Token 与 Client Secret 使用本机主密钥加密存储。</p><p>更换 Client ID 或 Secret 后，请重新授权该平台已有的全部邮箱。</p></aside>
      </div>`;
    return s;
  }

  function connectorStateCard(label, ready, detail) {
    return `<div class="ih-config-state ${ready ? "ready" : "missing"}"><span>${ready ? "✓" : "!"}</span><div><b>${label}</b><small>${detail}</small></div></div>`;
  }

  async function copyText(value, button) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    const previous = button.textContent;
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent = previous;
    }, 1500);
  }

  async function loadConnectors() {
    const r = await request("/api/v1/connectors");
    const c = r.configuration;
    const ms = document.getElementById("cx-ms");
    const google = document.getElementById("cx-google");
    const secret = document.getElementById("cx-secret");
    const base = document.getElementById("cx-base");
    ms.value = c.microsoft.clientId || "";
    google.value = c.google.clientId || "";
    base.value = c.publicBaseUrl;
    ms.disabled = c.microsoft.managedByEnvironment;
    google.disabled = c.google.clientIdManagedByEnvironment;
    secret.disabled = c.google.clientSecretManagedByEnvironment;
    base.disabled = c.publicBaseUrlManagedByEnvironment;
    [ms, google, secret, base].forEach((input) => {
      if (input.disabled)
        input.title = "该项由服务器环境变量管理，请在 .env 中修改并重建容器。";
    });
    document.getElementById("cx-callback").textContent = c.googleCallbackUrl;
    document.getElementById("cx-summary").innerHTML =
      connectorStateCard(
        "Microsoft",
        c.microsoft.configured,
        c.microsoft.configured
          ? "可授权多个 Microsoft 邮箱"
          : "等待填写 Client ID",
      ) +
      connectorStateCard(
        "Google",
        c.google.clientIdConfigured && c.google.clientSecretConfigured,
        c.google.clientIdConfigured && c.google.clientSecretConfigured
          ? "可授权多个 Google 邮箱"
          : "需要 Client ID 与 Client Secret",
      );
    document.getElementById("cx-copy").onclick = (event) =>
      copyText(c.googleCallbackUrl, event.currentTarget);
    const form = document.getElementById("cx-form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = document.getElementById("cx-save");
      const result = document.getElementById("cx-result");
      button.disabled = true;
      button.textContent = "正在保存…";
      result.textContent = "";
      try {
        await request("/api/v1/connectors", {
          method: "PUT",
          body: JSON.stringify({
            microsoftClientId: ms.disabled ? "" : ms.value,
            googleClientId: google.disabled ? "" : google.value,
            googleClientSecret: secret.disabled ? "" : secret.value,
            clearGoogleClientSecret:
              !secret.disabled && document.getElementById("cx-clear").checked,
            publicBaseUrl: base.disabled ? "" : base.value,
          }),
        });
        const check = await request("/api/v1/connectors/check", {
          method: "POST",
          body: "{}",
        });
        result.textContent = `保存成功。Microsoft：${check.results.microsoft.message} Google：${check.results.google.message}`;
        result.className = "success";
        secret.value = "";
        document.getElementById("cx-clear").checked = false;
        await loadConnectors();
      } catch (error) {
        result.textContent = error.message;
        result.className = "error";
      } finally {
        button.disabled = false;
        button.textContent = "保存并检测配置";
      }
    };
  }
  function guide() {
    const s = element("section", "ih-page");
    s.id = "ih-guide";
    s.innerHTML =
      '<div class="ih-section-head"><div><h1>使用与更新</h1><p class="ih-section-copy">复制命令前，请确认项目目录是 /www/wwwroot/InboxHarbor。</p></div></div><div class="ih-guide-grid"><section class="ih-card"><h2>首次 Docker 手动启动</h2><pre class="ih-command">cd /www/wwwroot/InboxHarbor\ndocker compose build --pull\ndocker compose up -d\ndocker compose ps\ndocker compose exec -T inboxharbor npm run credentials</pre><p class="ih-muted">不需要在宿主机安装 Node.js；程序会自动生成管理口令。</p></section><section class="ih-card"><h2>更新到最新版</h2><pre class="ih-command">git config --global --add safe.directory /www/wwwroot/InboxHarbor\ncd /www/wwwroot/InboxHarbor\ngit remote set-url origin https://github.com/nbbk/inbox-harbor.git\ngit pull --ff-only origin main\ndocker compose up -d --build</pre><p class="ih-muted">第一行用于修复 detected dubious ownership。只信任这个准确目录，不要设置 safe.directory \'*\'。</p></section><section class="ih-card"><h2>后续一键更新</h2><pre class="ih-command">cd /www/wwwroot/InboxHarbor\nchmod +x scripts/update-linux.sh\n./scripts/update-linux.sh</pre><p class="ih-muted">脚本只允许快进更新，不会用 reset 强制覆盖服务器修改。</p></section><section class="ih-card"><h2>非 Docker 临时运行</h2><pre class="ih-command">cd /www/wwwroot/InboxHarbor\nnode --version\nnpm ci --omit=dev\nnpm start</pre><p class="ih-muted">Node 必须为 v24 或更高；关闭终端后程序会停止，生产环境建议使用 Docker。</p></section></div>';
    return s;
  }
  async function load() {
    try {
      const [stats, accounts, notices, mails] = await Promise.all([
        request("/api/stats"),
        request("/api/accounts"),
        request("/api/v1/notifications").catch(() => null),
        request("/api/mails"),
      ]);
      renderAccounts(accounts.accounts);
      renderMailCenter(mails.mails || [], accounts.accounts || []);
      loadConnectors().catch(() => {});
      if (notices) {
        catalog = notices.catalog;
        config = notices.configuration;
        renderChannels();
      }
    } catch (err) {
      alert(err.message);
      if (/口令/.test(err.message)) lock();
    }
  }
  // Account rendering is defined once below, together with filtering and paging.
  async function authorize(a) {
    if (a.provider === "google") {
      const r = await request(
        `/api/auth/google/url?id=${encodeURIComponent(a.id)}`,
      );
      location.assign(r.url);
      return;
    }
    if (a.provider !== "microsoft")
      throw new Error("当前仅支持 Google 与 Microsoft OAuth");
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const r = await request("/api/auth/microsoft/device-code", {
        method: "POST",
        body: JSON.stringify({ accountId: a.id }),
      });
      if (!popup) {
        throw new Error("浏览器阻止了授权窗口，请允许本站弹出窗口后重试。");
      }
      popup.location.replace(r.verificationUri);
      const deadline =
        Date.now() +
        Math.min(Number(r.expiresIn || 600) * 1000, 10 * 60 * 1000);
      alert(`Microsoft 授权页面已打开。\n请在页面输入设备代码：${r.userCode}`);
      await new Promise((resolve, reject) => {
        const poll = async () => {
          if (popup.closed) {
            reject(new Error("授权窗口已关闭，授权已取消。"));
            return;
          }
          if (Date.now() >= deadline) {
            reject(new Error("Microsoft 授权已超时，请重新开始。"));
            return;
          }
          try {
            const p = await request("/api/auth/microsoft/poll-device-token", {
              method: "POST",
              body: JSON.stringify({ deviceCode: r.deviceCode }),
            });
            if (p.status === "completed") {
              resolve();
              return;
            }
            if (p.status === "failed") {
              reject(new Error(p.error || "Microsoft 授权失败"));
              return;
            }
            setTimeout(poll, 5000);
          } catch (error) {
            reject(error);
          }
        };
        setTimeout(poll, 5000);
      });
      if (!popup.closed) popup.close();
      await load();
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      throw error;
    }
  }
  function renderChannels() {
    const list = document.getElementById("ih-channel-list");
    list.textContent = "";
    Object.entries(catalog).forEach(([type, meta]) => {
      const saved = config.channels.find((c) => c.type === type);
      const card = element("div", "ih-channel");
      const top = element("div", "ih-channel-top");
      top.append(
        element("div", "ih-channel-name", `${meta.icon}  ${meta.name}`),
      );
      const actions = element("div", "ih-channel-actions");
      const test = element("button", "ih-test", "测试");
      test.type = "button";
      const on = document.createElement("input");
      on.type = "checkbox";
      on.checked = !!saved?.enabled;
      actions.append(test, on);
      top.append(actions);
      const fields = element("div", "ih-fields");
      meta.fields.forEach((f) => {
        const wrap = element("div", "ih-field");
        const label = element("label", "", f.label);
        const input = document.createElement("input");
        input.placeholder = saved?.configured?.[f.key]
          ? "已配置；留空则保持不变"
          : f.placeholder;
        input.dataset.key = f.key;
        input.type = "password";
        wrap.append(label, input);
        fields.append(wrap);
      });
      test.onclick = async (event) => {
        event.stopPropagation();
        const values = Object.fromEntries(
          [...fields.querySelectorAll("input")]
            .filter((input) => input.value)
            .map((input) => [input.dataset.key, input.value]),
        );
        test.disabled = true;
        test.textContent = "测试中";
        try {
          const result = await request(`/api/v1/notifications/${type}/test`, {
            method: "POST",
            body: JSON.stringify({ config: values }),
          });
          alert(result.message);
        } catch (error) {
          alert(error.message);
        } finally {
          test.disabled = false;
          test.textContent = "测试";
        }
      };
      card.append(top, fields);
      card.onclick = () => {
        const guide = document.getElementById("ih-channel-guide");
        guide.textContent = "";
        const close = element("button", "ih-guide-close", "关闭");
        close.type = "button";
        close.onclick = (event) => {
          event.stopPropagation();
          guide.classList.remove("open");
        };
        guide.append(
          close,
          element("h3", "", meta.name),
          element("p", "", meta.guide),
          element(
            "code",
            "ih-example",
            meta.fields
              .map((field) => `${field.label}: ${field.placeholder}`)
              .join("\n"),
          ),
        );
        guide.classList.add("open");
      };
      card.dataset.type = type;
      list.append(card);
    });
    document.getElementById("ih-full").checked =
      config.includeFullBody !== false;
    document.getElementById("ih-save").onclick = saveChannels;
  }
  async function saveChannels() {
    const channels = [...root.querySelectorAll(".ih-channel")].map((card) => ({
      id: config.channels.find((c) => c.type === card.dataset.type)?.id,
      type: card.dataset.type,
      enabled: card.querySelector(".ih-channel-top input").checked,
      config: Object.fromEntries(
        [...card.querySelectorAll(".ih-field input")]
          .filter((x) => x.value)
          .map((x) => [x.dataset.key, x.value]),
      ),
    }));
    try {
      await request("/api/v1/notifications", {
        method: "PUT",
        body: JSON.stringify({
          includeFullBody: document.getElementById("ih-full").checked,
          channels,
        }),
      });
      alert("通知设置已保存");
      load();
    } catch (e) {
      alert(e.message);
    }
  }
  let allAccounts = [];
  let accountPage = 1;
  let pageSize = 10;
  let providerFilter = "all";
  let statusFilter = "all";
  let searchQuery = "";
  const providerNames = {
    microsoft: "Microsoft",
    google: "Google",
    qq: "历史账户",
    netease: "历史账户",
    other: "历史账户",
  };
  const statusNames = {
    active: "已授权",
    pending: "待授权",
    invalid: "授权失效",
    unsupported: "暂未支持",
  };
  function createSwitch(account, field, label) {
    const wrap = element("label", "ih-switch");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked =
      field === "readEnabled"
        ? account[field] !== false
        : account[field] === true;
    input.setAttribute("aria-label", `${label} ${account.username}`);
    const track = element("span", "ih-switch-track");
    wrap.append(input, track, element("span", "ih-switch-label", label));
    input.onchange = async () => {
      input.disabled = true;
      try {
        await request(
          `/api/accounts/${encodeURIComponent(account.id)}/permissions`,
          { method: "PUT", body: JSON.stringify({ [field]: input.checked }) },
        );
        account[field] = input.checked;
        if (
          field === "sendEnabled" &&
          input.checked &&
          account.status === "active"
        ) {
          alert(
            "发信权限已开启，请点击“授权”重新完成 OAuth，授权平台才会授予发信范围。",
          );
        }
      } catch (error) {
        input.checked = !input.checked;
        alert(error.message);
      } finally {
        input.disabled = false;
      }
    };
    return wrap;
  }
  function openAddAccounts() {
    const dialog = element("dialog", "ih-dialog");
    const form = element("form", "ih-dialog-card");
    form.method = "dialog";
    form.innerHTML =
      '<div class="ih-dialog-head"><div><h2>添加邮箱</h2><p>同一服务商可一次添加多个邮箱，每个账户分别完成 OAuth 授权。</p></div><button type="button" class="ih-dialog-close" aria-label="关闭">×</button></div><label class="ih-field-label">授权服务商<select name="provider" required><option value="google">Google / Gmail</option><option value="microsoft">Microsoft / Outlook</option></select></label><label class="ih-field-label">邮箱地址<textarea name="emails" rows="7" placeholder="name@gmail.com&#10;another@company.com" required></textarea></label><p class="ih-dialog-help">支持换行、逗号或分号分隔。Google Workspace 和 Microsoft 365 自定义域请按实际登录平台选择。</p><div class="ih-dialog-actions"><button type="button" class="ih-button ih-button-quiet">取消</button><button type="submit" class="ih-button">添加账户</button></div>';
    dialog.append(form);
    document.body.append(dialog);
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    form.querySelector(".ih-dialog-close").onclick = close;
    form.querySelector(".ih-button-quiet").onclick = close;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const emails = [
        ...new Set(
          String(values.get("emails"))
            .split(/[\s,;，；]+/)
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean),
        ),
      ];
      if (!emails.length) {
        alert("请至少输入一个邮箱地址。");
        return;
      }
      const submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      submit.textContent = "正在添加…";
      const results = await Promise.allSettled(
        emails.map((username) =>
          request("/api/accounts/add", {
            method: "POST",
            body: JSON.stringify({
              username,
              provider: values.get("provider"),
            }),
          }),
        ),
      );
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length) {
        submit.disabled = false;
        submit.textContent = "添加账户";
        alert(
          `成功 ${emails.length - failed.length} 个，失败 ${failed.length} 个：${failed[0].reason.message}`,
        );
        return;
      }
      close();
      await load();
    };
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.showModal();
  }
  function renderAccounts(accounts) {
    allAccounts = accounts;
    const box = document.getElementById("ih-accounts-list");
    box.textContent = "";
    const counts = {
      all: allAccounts.length,
      google: allAccounts.filter((a) => a.provider === "google").length,
      microsoft: allAccounts.filter((a) => a.provider === "microsoft").length,
    };
    const tabs = element("div", "ih-provider-tabs");
    [
      ["all", "全部账户"],
      ["google", "Google"],
      ["microsoft", "Microsoft"],
    ].forEach(([value, label]) => {
      const button = element(
        "button",
        providerFilter === value ? "active" : "",
        `${label}  ${counts[value]}`,
      );
      button.type = "button";
      button.onclick = () => {
        providerFilter = value;
        accountPage = 1;
        renderAccounts(allAccounts);
      };
      tabs.append(button);
    });
    const tools = element("div", "ih-account-tools");
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "搜索邮箱账户";
    search.value = searchQuery;
    search.setAttribute("aria-label", "搜索邮箱账户");
    const status = document.createElement("select");
    status.setAttribute("aria-label", "授权状态");
    [
      ["all", "全部状态"],
      ["active", "已授权"],
      ["pending", "待授权"],
      ["invalid", "授权失效"],
      ["unsupported", "历史账户"],
    ].forEach(([value, label]) => status.add(new Option(label, value)));
    status.value = statusFilter;
    tools.append(search, status);
    box.append(tabs, tools);
    const table = element("div", "ih-account-table");
    const header = element("div", "ih-account-row ih-account-row-head");
    ["邮箱账户", "服务商", "状态", "权限", "最近检查", "操作"].forEach(
      (value) => header.append(element("div", "", value)),
    );
    table.append(header);
    const filtered = allAccounts.filter(
      (a) =>
        (providerFilter === "all" || a.provider === providerFilter) &&
        (statusFilter === "all" || a.status === statusFilter) &&
        a.username.toLowerCase().includes(searchQuery.toLowerCase()),
    );
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    accountPage = Math.max(1, Math.min(accountPage, pages));
    const pageItems = filtered.slice(
      (accountPage - 1) * pageSize,
      accountPage * pageSize,
    );
    if (!pageItems.length) {
      table.append(element("div", "ih-empty", "没有符合条件的邮箱账户"));
    }
    pageItems.forEach((a) => {
      const row = element("div", "ih-account-row");
      const identity = element("div", "ih-account-identity");
      identity.append(
        element("strong", "", a.username),
        element(
          "span",
          "ih-mobile-meta",
          `${providerNames[a.provider] || "历史账户"} · ${statusNames[a.status] || "待授权"}`,
        ),
      );
      const provider = element(
        "div",
        `ih-provider ih-provider-${a.provider}`,
        providerNames[a.provider] || "历史账户",
      );
      const state = element(
        "div",
        `ih-status ih-status-${a.status || "pending"}`,
        statusNames[a.status] || "待授权",
      );
      const permissions = element("div", "ih-permissions");
      const isSupported = a.provider === "google" || a.provider === "microsoft";
      if (isSupported) {
        permissions.append(
          createSwitch(a, "readEnabled", "读取"),
          createSwitch(a, "sendEnabled", "发信"),
        );
      } else {
        permissions.append(element("span", "ih-muted", "仅可清理"));
      }
      const checked = element(
        "div",
        "ih-last-checked",
        a.lastChecked ? new Date(a.lastChecked).toLocaleString() : "尚未检查",
      );
      const actions = element("div", "ih-account-actions");
      const auth = element("button", "ih-button", "授权");
      auth.type = "button";
      auth.onclick = async () => {
        auth.disabled = true;
        auth.textContent = "正在授权…";
        try {
          await authorize(a);
        } catch (error) {
          handleAuthorizationError(error);
          auth.disabled = false;
          auth.textContent = "授权";
        }
      };
      const del = element("button", "ih-button ih-button-danger", "删除");
      del.type = "button";
      del.onclick = async () => {
        if (!confirm(`删除 ${a.username}？`)) return;
        del.disabled = true;
        try {
          await request(`/api/accounts/${encodeURIComponent(a.id)}`, {
            method: "DELETE",
          });
          await load();
        } catch (error) {
          del.disabled = false;
          alert(error.message);
        }
      };
      if (isSupported) actions.append(auth);
      actions.append(del);
      row.append(identity, provider, state, permissions, checked, actions);
      table.append(row);
    });
    box.append(table);
    const pager = element("div", "ih-pager");
    const summary = element(
      "span",
      "ih-pager-summary",
      `共 ${filtered.length} 个账户`,
    );
    const size = document.createElement("select");
    size.setAttribute("aria-label", "每页展示数量");
    [10, 20, 50].forEach((value) =>
      size.add(new Option(`${value} 条/页`, value)),
    );
    size.value = String(pageSize);
    size.onchange = () => {
      pageSize = Number(size.value);
      accountPage = 1;
      renderAccounts(allAccounts);
    };
    const pagesBox = element("div", "ih-page-buttons");
    const previous = element("button", "ih-page-button", "‹");
    previous.setAttribute("aria-label", "上一页");
    previous.disabled = accountPage === 1;
    previous.onclick = () => {
      accountPage--;
      renderAccounts(allAccounts);
    };
    pagesBox.append(previous);
    const start = Math.max(1, Math.min(accountPage - 2, pages - 4));
    const end = Math.min(pages, start + 4);
    for (let page = start; page <= end; page++) {
      const button = element(
        "button",
        `ih-page-button${page === accountPage ? " active" : ""}`,
        String(page),
      );
      button.setAttribute("aria-label", `第 ${page} 页`);
      button.onclick = () => {
        accountPage = page;
        renderAccounts(allAccounts);
      };
      pagesBox.append(button);
    }
    const next = element("button", "ih-page-button", "›");
    next.setAttribute("aria-label", "下一页");
    next.disabled = accountPage === pages;
    next.onclick = () => {
      accountPage++;
      renderAccounts(allAccounts);
    };
    pagesBox.append(next);
    const jump = element("form", "ih-page-jump");
    const jumpInput = document.createElement("input");
    jumpInput.type = "number";
    jumpInput.min = 1;
    jumpInput.max = pages;
    jumpInput.placeholder = "页码";
    jumpInput.setAttribute("aria-label", "跳转页码");
    const jumpButton = element("button", "ih-button ih-button-quiet", "跳转");
    jump.append(jumpInput, jumpButton);
    jump.onsubmit = (event) => {
      event.preventDefault();
      accountPage = Math.max(
        1,
        Math.min(pages, Number(jumpInput.value) || accountPage),
      );
      renderAccounts(allAccounts);
    };
    pager.append(summary, size, pagesBox, jump);
    box.append(pager);
    search.oninput = () => {
      searchQuery = search.value;
      accountPage = 1;
      renderAccounts(allAccounts);
      requestAnimationFrame(() => {
        const input = document.querySelector(
          "#ih-accounts-list input[type=search]",
        );
        input?.focus();
        input?.setSelectionRange(searchQuery.length, searchQuery.length);
      });
    };
    status.onchange = () => {
      statusFilter = status.value;
      accountPage = 1;
      renderAccounts(allAccounts);
    };
    document.getElementById("ih-add").onclick = openAddAccounts;
    document.getElementById("ih-fetch").onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "正在取件…";
      try {
        await request("/api/accounts/fetch-mail", {
          method: "POST",
          body: "{}",
        });
        await load();
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
        button.textContent = "手动取件";
      }
    };
  }
  token ? render() : renderLock();
})();
