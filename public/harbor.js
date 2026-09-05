(() => {
  const root = document.getElementById("harbor-ui");
  let token = sessionStorage.getItem("inboxharbor-token") || "";
  let catalog = {};
  let config = { includeFullBody: true, channels: [] };
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
    s.innerHTML =
      '<div class="ih-hero"><div><p>你的邮件，安静地靠岸。</p><h1>一处查看所有重要邮件。</h1><span>默认只读；需要时可为单个账户开启发信权限。</span></div><div class="ih-number"><b id="ih-total">0</b><span>已连接邮箱</span></div></div><div class="ih-stats"><div class="ih-card"><span>活跃账户</span><b id="ih-active">0</b></div><div class="ih-card"><span>邮件归档</span><b id="ih-mails">0</b></div><div class="ih-card"><span>通知渠道</span><b id="ih-channels">0</b></div></div>';
    return s;
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
            <div class="ih-copy-field"><code id="cx-callback">保存地址后自动生成</code><button type="button" id="cx-copy" class="ih-button ih-button-quiet">复制回调地址</button></div>
          </section>
          <section class="ih-setup-block">
            <div class="ih-setup-heading"><span>2</span><div><h2>Microsoft 邮箱</h2><p>一个应用配置可供所有 Outlook、Hotmail 与 Microsoft 365 邮箱分别授权。</p></div></div>
            <label class="ih-field-label">Application (client) ID<input id="cx-ms" placeholder="00001111-aaaa-2222-bbbb-3333cccc4444" autocomplete="off"><small>格式：36 位 UUID，只填写“应用程序(客户端) ID”，不需要 Client Secret。</small></label>
            <details class="ih-tutorial"><summary>Microsoft 新手配置教程</summary><ol><li>打开 Microsoft Entra 管理中心，进入“应用注册”，点击“新注册”。</li><li>需要同时管理个人和企业邮箱时，选择“任何组织目录中的账户和个人 Microsoft 账户”。</li><li>创建后复制“应用程序(客户端) ID”到上方。</li><li>进入“身份验证”→“高级设置”，把“允许公共客户端流”设为“是”。</li><li>进入“API 权限”，添加 Microsoft Graph 委托权限 <code>Mail.Read</code>；需要发信再添加 <code>Mail.Send</code>。</li></ol></details>
          </section>
          <section class="ih-setup-block">
            <div class="ih-setup-heading"><span>3</span><div><h2>Google 邮箱</h2><p>一个 Web OAuth 客户端可供多个 Gmail 或 Google Workspace 邮箱分别授权。</p></div></div>
            <label class="ih-field-label">Google Client ID<input id="cx-google" placeholder="123456789012-abcdef.apps.googleusercontent.com" autocomplete="off"><small>格式：通常以数字开头，并以 <code>.apps.googleusercontent.com</code> 结尾。</small></label>
            <label class="ih-field-label">Google Client Secret<input id="cx-secret" type="password" placeholder="已配置时留空可保持原值" autocomplete="new-password"><small>只在保存时提交；保存后加密存储且页面不会回显。</small></label>
            <label class="ih-clear-secret"><input id="cx-clear" type="checkbox"> 清除已保存的 Google Client Secret</label>
            <details class="ih-tutorial"><summary>Google 新手配置教程</summary><ol><li>打开 Google Cloud Console，新建或选择项目，并启用 Gmail API。</li><li>进入“Google Auth Platform”，完成 Branding、Audience 和 Data Access；个人使用通常选择 External。</li><li>应用处于 Testing 时，在 Audience 的 Test users 中加入每一个要授权的 Gmail。</li><li>进入 Clients，创建“Web application”类型的 OAuth Client。</li><li>在 Authorized redirect URIs 中粘贴本页生成的回调地址，必须逐字一致。</li><li>创建后复制 Client ID 与 Client Secret 到上方并保存。</li></ol></details>
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
      '<div class="ih-card"><p class="ih-eyebrow">GET STARTED</p><h2>开始使用</h2><p class="ih-muted">默认只授权读取邮件。打开单个账户的发信开关后，重新 OAuth 授权即可获得对应发送权限。</p></div>';
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
      document.getElementById("ih-total").textContent = stats.totalAccounts;
      document.getElementById("ih-active").textContent = stats.activeAccounts;
      document.getElementById("ih-mails").textContent = stats.totalMails;
      document.getElementById("ih-channels").textContent = notices
        ? (notices.configuration.channels || []).filter((c) => c.enabled).length
        : 0;
      renderAccounts(accounts.accounts);
      loadConnectors().catch(() => {});
      const feed = document.getElementById("ih-overview");
      const old = feed.querySelector(".ih-mail-feed");
      if (old) old.remove();
      const mailBox = element("div", "ih-card ih-mail-feed");
      (mails.mails || []).slice(0, 8).forEach((m) => {
        const d = element("details", "ih-account");
        const sum = element(
          "summary",
          "",
          `${m.subject || "无主题"} · ${m.account || ""}`,
        );
        d.append(sum, element("pre", "ih-muted", m.content || m.preview || ""));
        mailBox.append(d);
      });
      feed.append(mailBox);
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
