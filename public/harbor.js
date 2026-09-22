(() => {
  const root = document.getElementById("harbor-ui");
  let currentUser = null;
  let pendingRecoveryCodes = null;
  let authConfig = { ownerInitialized: true, allowPublicRegistration: false };
  const pendingInviteToken = new URLSearchParams(location.search).get("invite") || "";
  if (pendingInviteToken) history.replaceState({}, "", location.pathname);
  let catalog = {};
  let config = { includeFullBody: false, shareLinkDays: 30, channels: [] };
  let mailState = {
    mails: [],
    accounts: [],
    category: "全部",
    account: "全部",
    query: "",
    selectedId: "",
    page: 1,
    pageSize: 50,
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
    facets: {},
  };
  const esc = (value) => String(value || "");
  function request(url, opts = {}) {
    return fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
      credentials: "same-origin",
    }).then(async (r) => {
      const text = await r.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { message: `服务返回异常（HTTP ${r.status}）` };
      }
      if (!r.ok) {
        if (r.status === 401 && !url.startsWith("/api/auth/")) lock();
        throw new Error(body.message || "请求失败");
      }
      return body;
    });
  }
  function lock() {
    currentUser = null;
    renderLock();
  }
  function renderLock() {
    root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "ih-lock";
    const card = document.createElement("div");
    card.innerHTML = '<span class="ih-mark">IH</span><h1>InboxHarbor</h1><p>私有、克制的邮件工作台。</p>';
    const form = document.createElement("form");
    const email = document.createElement("input");
    email.type = "email";
    email.placeholder = "邮箱地址";
    email.required = true;
    const input = document.createElement("input"); input.type = "password"; input.placeholder = "密码"; input.required = true;
    const button = document.createElement("button");
    button.className = "ih-button";
    button.textContent = "登录";
    form.append(email, input, button);
    form.onsubmit = (e) => {
      e.preventDefault();
      request("/api/auth/login", {method:"POST",body:JSON.stringify({email:email.value,password:input.value})})
        .then((result) => { currentUser=result.user; render(); })
        .catch((err) => alert(err.message));
    };
    if (!authConfig.ownerInitialized) {
      const bootstrap = element("button", "ih-button ih-button-quiet", "首次设置 Owner");
      bootstrap.type="button"; bootstrap.onclick=()=>renderBootstrap(); form.append(bootstrap);
    }
    if (authConfig.allowPublicRegistration) { const register=element("button","ih-button ih-button-quiet","创建账号");register.type="button";register.onclick=()=>renderRegistration();form.append(register); }
    const invite = pendingInviteToken;
    if(invite){const accept=element("button","ih-button ih-button-quiet","接受邀请");accept.type="button";accept.onclick=()=>renderRegistration(invite);form.append(accept);}
    card.append(form);
    const forgot=element("button","ih-button ih-button-quiet","忘记密码");forgot.type="button";forgot.onclick=renderRecoveryReset;card.append(forgot);
    box.append(card);
    root.append(box);
  }
  function displayRecoveryCodes(codes){pendingRecoveryCodes=Array.isArray(codes)?codes.filter(Boolean):[];}
  function renderRecoveryNotice(){if(!pendingRecoveryCodes?.length)return;const box=element('section','ih-card ih-recovery-notice');box.setAttribute('role','status');box.append(element('h2','','请保存恢复码'),element('p','ih-section-copy','这些恢复码只显示这一次。请复制或下载到离线密码管理器。'),element('pre','ih-recovery-codes',pendingRecoveryCodes.join('\n')));const copy=element('button','ih-button ih-button-quiet','复制恢复码');copy.type='button';copy.onclick=async()=>{await navigator.clipboard?.writeText(pendingRecoveryCodes.join('\n'));copy.textContent='已复制';};const download=element('button','ih-button ih-button-quiet','下载恢复码');download.type='button';download.onclick=()=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([pendingRecoveryCodes.join('\n')+'\n'],{type:'text/plain'}));link.download='inboxharbor-recovery-codes.txt';link.click();URL.revokeObjectURL(link.href);};const close=element('button','ih-button','我已安全保存');close.type='button';close.onclick=()=>{pendingRecoveryCodes=null;box.remove();};box.append(copy,download,close);root.append(box);}
  function renderBootstrap(){renderAuthForm("初始化收件港","用启动终端显示的本机管理口令，创建唯一 Owner。",async values=>{const created=await request("/api/auth/bootstrap",{method:"POST",headers:{Authorization:`Bearer ${values.recovery}`},body:JSON.stringify({email:values.email,password:values.password})});displayRecoveryCodes(created.user.recoveryCodes);const result=await request("/api/auth/login",{method:"POST",body:JSON.stringify({email:values.email,password:values.password})});currentUser=result.user;authConfig.ownerInitialized=true;render();},true);}
  function renderRecoveryReset(){renderAuthForm("恢复访问","输入邮箱、一次性恢复码和新密码。使用后会退出所有设备。",async values=>{await request('/api/auth/recovery/reset',{method:'POST',body:JSON.stringify({email:values.email,code:values.recovery,newPassword:values.password})});alert('密码已重置，请登录');renderLock();},true);}
  function renderRegistration(inviteToken=""){renderAuthForm(inviteToken?"接受邀请":"创建账号",inviteToken?"设置你的登录邮箱和密码。":"公开注册已由管理员开启。",async values=>{const endpoint=inviteToken?"/api/auth/invitations/accept":"/api/auth/register";const created=await request(endpoint,{method:"POST",body:JSON.stringify(inviteToken?{token:inviteToken,email:values.email,password:values.password}:{email:values.email,password:values.password})});displayRecoveryCodes(created.user.recoveryCodes);const result=await request("/api/auth/login",{method:"POST",body:JSON.stringify({email:values.email,password:values.password})});currentUser=result.user;render();});}
  function renderAuthForm(title,description,submit,needsRecovery=false){root.innerHTML="";const box=element("div","ih-lock"),card=element("div");card.append(element("span","ih-mark","IH"),element("h1","",title),element("p","",description));const form=element("form");const email=document.createElement("input");email.type="email";email.placeholder="邮箱地址";email.required=true;const password=document.createElement("input");password.type="password";password.placeholder="至少 12 位密码";password.minLength=12;password.required=true;form.append(email,password);let recovery;if(needsRecovery){recovery=document.createElement("input");recovery.type="password";recovery.placeholder="本机管理口令（仅首次使用）";recovery.required=true;form.append(recovery);}const button=element("button","ih-button","继续");form.append(button);form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{await submit({email:email.value,password:password.value,recovery:recovery?.value});}catch(error){alert(error.message);button.disabled=false;}};const back=element("button","ih-button ih-button-quiet","返回登录");back.type="button";back.onclick=renderLock;form.append(back);card.append(form);box.append(card);root.append(box);}
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
      "个人中心|profile",
      ...(currentUser?.role === "owner" || currentUser?.role === "admin" ? ["管理后台|admin"] : []),
      "使用说明|guide",
    ].forEach((x) => {
      const [a, b] = x.split("|");
      nav.append(navButton(a, b));
    });
    side.append(brand, nav, element("div", "ih-local", "● 本机私有服务"));
    const main = element("main", "ih-main");
    const head = element("header", "ih-head");
    const who = element("div", "ih-user-menu");
    who.append(element("span", "ih-user-email", currentUser?.email || ""), element("span", "ih-role", currentUser?.role === "owner" ? "Owner" : currentUser?.role === "admin" ? "管理员" : "成员"));
    const logout = element("button", "ih-button ih-button-quiet", "退出");
    logout.onclick = async()=>{try{await request("/api/auth/logout",{method:"POST"});}finally{lock();}};
    head.append(who, logout);
    main.append(
      head,
      overview(),
      accounts(),
      connectors(),
      notifications(),
      profile(),
      ...(currentUser?.role === "owner" || currentUser?.role === "admin" ? [admin()] : []),
      guide(),
    );
    shell.append(side, main);
    const mobile = element("nav", "ih-mobile");
    [
      "概览|overview",
      "账户|accounts",
      "设置|connectors",
      "通知|notifications",
      "我的|profile",
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
    renderRecoveryNotice();
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
    s.innerHTML = `<div class="ih-mail-head"><div><h1>邮件中心</h1><p>聚合查看所有账户的重要邮件与验证码。</p></div><div class="ih-mail-head-actions"><span id="ih-mail-summary">0 封邮件</span><button id="ih-mail-refresh" class="ih-button ih-button-quiet">刷新列表</button><button id="ih-compose" class="ih-button">写邮件</button></div></div>
      <div class="ih-mail-categories" id="ih-mail-categories" aria-label="邮件分类"></div>
      <div class="ih-mail-tools"><label class="ih-mail-search"><span>搜索</span><input id="ih-mail-search" placeholder="搜索主题、发件人或正文"></label><label><span>邮箱账户</span><select id="ih-mail-account"><option value="全部">全部账户</option></select></label></div>
      <div class="ih-mail-workspace"><div class="ih-mail-list" id="ih-mail-list"></div><article class="ih-mail-reader" id="ih-mail-reader"><div class="ih-mail-empty"><b>选择一封邮件</b><span>正文会在这里清晰呈现。</span></div></article></div><div class="ih-mail-pager" id="ih-mail-pager"></div>`;
    s.querySelector("#ih-mail-refresh").onclick = async () => {
      const button = s.querySelector("#ih-mail-refresh");
      button.disabled = true; button.textContent = "刷新中…";
      try {
        const accounts = await request("/api/accounts");
        mailState.accounts = accounts.accounts || [];
        await loadMailPage(mailState.page || 1);
      } catch (error) { alert(error.message); }
      finally { button.disabled = false; button.textContent = "刷新列表"; }
    };
    s.querySelector("#ih-compose").onclick = openCompose;
    s.querySelector("#ih-mail-search").oninput = (event) => {
      mailState.query = event.target.value.trim().toLowerCase();
      clearTimeout(mailState.searchTimer);
      mailState.searchTimer = setTimeout(() => loadMailPage(1), 250);
    };
    s.querySelector("#ih-mail-account").onchange = (event) => {
      mailState.account = event.target.value;
      loadMailPage(1);
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
      if (mailState.category === "全部" && mail.direction === "sent") return false;
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
      const count = mailState.facets[category] ?? (category === "全部" ? mailState.mails.filter((mail) => mail.direction !== "sent").length : mailState.mails.filter((mail) => mail.category === category).length);
      const button = element(
        "button",
        category === mailState.category ? "active" : "",
        `${category} ${count}`,
      );
      button.onclick = () => {
        mailState.category = category;
        mailState.selectedId = "";
        loadMailPage(1);
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
      renderMailPager();
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
    renderMailPager();
  }

  function renderMailPager() {
    const pager = document.getElementById("ih-mail-pager");
    if (!pager) return;
    pager.replaceChildren();
    const { page = 1, total = 0, totalPages = 1 } = mailState.pagination || {};
    const previous = element("button", "ih-button ih-button-quiet", "上一页");
    const next = element("button", "ih-button ih-button-quiet", "下一页");
    previous.disabled = page <= 1;
    next.disabled = page >= totalPages;
    previous.onclick = () => loadMailPage(page - 1);
    next.onclick = () => loadMailPage(page + 1);
    pager.append(previous, element("span", "", `第 ${page} / ${totalPages} 页 · 共 ${total} 封`), next);
  }

  async function loadMailPage(page) {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(mailState.pageSize) });
      if (mailState.query) params.set("q", mailState.query);
      if (mailState.account !== "全部") params.set("account", mailState.account);
      if (mailState.category === "已发送") params.set("direction", "sent");
      else {
        params.set("direction", "received");
        if (mailState.category !== "全部") params.set("category", mailState.category);
      }
      const result = await request(`/api/mails?${params}`);
      mailState.page = result.pagination?.page || page;
      mailState.pagination = result.pagination || mailState.pagination;
      mailState.facets = result.facets || mailState.facets;
      mailState.selectedId = "";
      renderMailCenter(result.mails || []);
    } catch (error) {
      alert(error.message);
    }
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
    const actions = element("div", "ih-reader-actions");
    const category = document.createElement("select");
    category.setAttribute("aria-label", "修改邮件分类");
    ["验证码", "通知", "账单", "社交", "推广", "其他"].forEach((value) =>
      category.add(new Option(value, value)),
    );
    category.value = mail.category === "已发送" ? "其他" : mail.category;
    category.disabled = mail.direction === "sent";
    category.onchange = async () => {
      const result = await request(`/api/mails/${encodeURIComponent(mail.id)}/category`, {
        method: "PATCH",
        body: JSON.stringify({ category: category.value }),
      });
      Object.assign(mail, result.mail);
      renderMailCenter();
    };
    const star = element("button", "ih-button ih-button-quiet", mail.isStarred ? "取消收藏" : "收藏");
    star.onclick = () => updateMailState(mail, { isStarred: !mail.isStarred });
    const pin = element("button", "ih-button ih-button-quiet", mail.isPinned ? "取消置顶" : "置顶");
    pin.onclick = () => updateMailState(mail, { isPinned: !mail.isPinned });
    const remove = element("button", "ih-button ih-button-danger", "删除邮件");
    remove.onclick = () => deleteMail(mail);
    actions.append(category, star, pin, remove);
    readerTop.append(tag, actions);
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
    if (mail.recipient || (mail.cc && mail.cc.length)) {
      const recipients = element("div", "ih-mail-recipients");
      if (mail.recipient) recipients.append(element("span", "", `收件人：${mail.recipient}`));
      if (mail.cc?.length) recipients.append(element("span", "", `抄送：${mail.cc.join(", ")}`));
      reader.append(recipients);
    }
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
    if (mail.hasAttachments) {
      const attachments = element("div", "ih-attachments");
      attachments.append(element("b", "", "附件"));
      for (const item of mail.attachments || [])
        attachments.append(element("span", "", `${item.name} · ${Math.ceil((item.size || 0) / 1024)} KB`));
      if (!(mail.attachments || []).length)
        attachments.append(element("span", "", "此邮件包含附件，当前版本仅展示附件信息。"));
      reader.append(attachments);
    }
    if (!mail.isRead) updateMailState(mail, { isRead: true }, false);
  }

  async function updateMailState(mail, changes, rerender = true) {
    try {
      const result = await request(`/api/mails/${encodeURIComponent(mail.id)}/state`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      Object.assign(mail, result.mail);
      if (rerender) renderMailCenter();
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteMail(mail) {
    if (!confirm(`确定从本地归档删除“${mail.subject || "无主题"}”吗？`)) return;
    try {
      await request(`/api/mails/${encodeURIComponent(mail.id)}`, {
        method: "DELETE",
      });
      mailState.mails = mailState.mails.filter((item) => item.id !== mail.id);
      mailState.facets[mail.category] = Math.max(0, (mailState.facets[mail.category] || 1) - 1);
      if (mail.direction !== "sent")
        mailState.facets["全部"] = Math.max(0, (mailState.facets["全部"] || 1) - 1);
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
          mailState.facets["已发送"] = (mailState.facets["已发送"] || 0) + 1;
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
      '<div class="ih-section-head"><div><p class="ih-eyebrow">SUMMARY DELIVERY</p><h2>通知渠道</h2><p class="ih-section-copy">配置推送渠道与共享阅读规则。</p></div></div><div class="ih-layout"><div><section class="ih-share-settings" aria-labelledby="ih-share-title"><div class="ih-share-icon" aria-hidden="true">🔗</div><div class="ih-share-copy"><h3 id="ih-share-title">共享阅读链接</h3><p>通知中的“查看邮件”链接免登录、只读，过期后自动失效。</p></div><label class="ih-share-field" for="ih-share-days"><span>有效期</span><span class="ih-share-input"><input id="ih-share-days" type="number" min="1" max="365" value="30" inputmode="numeric" aria-label="查看链接有效期（天）" aria-describedby="ih-share-hint"><b>天</b></span><small id="ih-share-hint">1–365 天，默认 30 天</small></label></section><div class="ih-channels" id="ih-channel-list"></div><div class="ih-save-row"><button id="ih-save" class="ih-button">保存通知设置</button><span>保存后对新生成的链接生效</span></div></div><aside class="ih-card ih-guide" id="ih-channel-guide"><p class="ih-eyebrow">CONFIGURATION</p><h3>选择一个渠道</h3><p>所有渠道只推送摘要与免登录只读链接；凭据不会回显。</p></aside></div>';
    return s;
  }
  function profile() {
    const s = element("section", "ih-page"); s.id="ih-profile";
    s.innerHTML='<div class="ih-section-head"><div><h1>个人中心</h1><p class="ih-section-copy">管理你的登录安全、用量和邮件共享链接。</p></div></div><div class="ih-profile-grid"><section class="ih-card"><h2>账户信息</h2><p id="ih-profile-identity">正在读取…</p><div id="ih-profile-quota" class="ih-quota"></div><button id="ih-recovery" class="ih-button ih-button-quiet" type="button">重新生成恢复码</button></section><form id="ih-password-form" class="ih-card"><h2>修改密码</h2><label class="ih-field-label">当前密码<input name="currentPassword" type="password" required></label><label class="ih-field-label">新密码<input name="newPassword" type="password" minlength="12" required></label><div class="ih-section-actions"><button class="ih-button" type="submit">更新密码</button><button class="ih-button ih-button-quiet" type="button" id="ih-logout-all">退出全部设备</button></div></form></div><section class="ih-card"><div class="ih-section-head"><div><h2>我的共享链接</h2><p class="ih-section-copy">已撤销或过期链接不会再公开邮件内容。</p></div></div><div id="ih-shares" class="ih-simple-list"></div></section>';
    if(currentUser?.role==='user'){const danger=element('button','ih-button ih-button-danger','永久删除我的账户');danger.id='ih-delete-account';danger.type='button';s.append(danger);}s.querySelector('#ih-password-form').onsubmit=async e=>{e.preventDefault();try{await request('/api/auth/change-password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});alert('密码已更新，请重新登录');lock();}catch(error){alert(error.message);}};
    s.querySelector('#ih-logout-all').onclick=async()=>{await request('/api/auth/logout-all',{method:'POST'});lock();}; return s;
  }
  function admin(){const s=element('section','ih-page');s.id='ih-admin';s.innerHTML='<div class="ih-section-head"><div><h1>管理后台</h1><p class="ih-section-copy">仅展示必要的成员、邀请与实例审计信息。</p></div></div><div class="ih-admin-grid"><section class="ih-card"><h2>成员</h2><div id="ih-users" class="ih-simple-list"></div></section><section class="ih-card"><h2>创建邀请</h2><form id="ih-invite-form"><label class="ih-field-label">邮箱（可留空）<input name="email" type="email" placeholder="member@example.com"></label><label class="ih-field-label">角色<select name="role"><option value="user">成员</option><option value="admin">管理员</option></select></label><label class="ih-field-label">有效期（小时）<input name="ttlHours" type="number" min="1" max="720" value="72"></label><button class="ih-button" type="submit">生成邀请链接</button></form><div id="ih-invite-result" class="ih-invite-result"></div><div id="ih-invites" class="ih-simple-list"></div></section></div><section class="ih-card ih-owner-only" id="ih-public-registration"><h2>公开注册</h2><p>关闭时仅可通过邀请创建成员。</p><label class="ih-switch"><input type="checkbox" id="ih-public-toggle"><span class="ih-switch-track"></span><span class="ih-switch-label">允许公开注册</span></label></section><section class="ih-card"><h2>审计日志</h2><div id="ih-audit" class="ih-simple-list"></div></section>';return s;}
  async function loadUserAreas(){
    const profileIdentity=document.getElementById('ih-profile-identity'); if(profileIdentity){profileIdentity.textContent=`${currentUser.email} · ${currentUser.role}`;const quota=await request(`/api/auth/users/${encodeURIComponent(currentUser.id)}/quota`).catch(()=>({quota:null}));const q=quota.quota||{};document.getElementById('ih-profile-quota').textContent=`邮箱账户：${q.mail_account_limit??'未限制'} · 通知渠道：${q.notification_limit??'未限制'}`;const links=await request('/api/share-links').catch(()=>({links:[]}));const box=document.getElementById('ih-shares');box.replaceChildren();(links.links||[]).forEach(link=>{const row=element('div','ih-simple-row');row.append(element('span','',`${link.mailSubject||'邮件'} · ${link.expiresAt||'无期限'}`));const revoke=element('button','ih-button ih-button-quiet','撤销');revoke.onclick=async()=>{await request(`/api/share-links/${link.id}/revoke`,{method:'POST'});loadUserAreas();};row.append(revoke);box.append(row);});if(!(links.links||[]).length)box.textContent='暂无共享链接。';}
    if(!(currentUser.role==='owner'||currentUser.role==='admin'))return;
    const [users,invites,audit]=await Promise.all([request('/api/auth/users'),request('/api/auth/invitations'),request('/api/auth/audit')]);const userBox=document.getElementById('ih-users');if(!userBox)return;userBox.replaceChildren();users.users.forEach(user=>{const row=element('div','ih-simple-row');row.append(element('span','',`${user.email} · ${user.role} · ${user.enabled?'启用':'已停用'}`));if(user.role!=='owner'){const toggle=element('button','ih-button ih-button-quiet',user.enabled?'停用':'启用');toggle.onclick=async()=>{await request(`/api/auth/users/${user.id}`,{method:'PATCH',body:JSON.stringify({enabled:!user.enabled})});loadUserAreas();};row.append(toggle);if(currentUser.role==='owner'){const role=element('select');role.append(new Option('成员','user'),new Option('管理员','admin'));role.value=user.role;role.onchange=async()=>{await request(`/api/auth/users/${user.id}`,{method:'PATCH',body:JSON.stringify({role:role.value})});loadUserAreas();};const erase=element('button','ih-button ih-button-danger','删除');erase.onclick=async()=>{const currentPassword=prompt(`输入当前 Owner 密码以删除 ${user.email}`);if(!currentPassword||!confirm(`永久删除 ${user.email} 及其全部数据？`))return;try{await request(`/api/auth/users/${user.id}`,{method:'DELETE',body:JSON.stringify({currentPassword})});loadUserAreas();}catch(error){alert(error.message);}};row.append(role,erase);}}userBox.append(row);});
    const inviteBox=document.getElementById('ih-invites');inviteBox.replaceChildren();invites.invitations.forEach(invite=>{const row=element('div','ih-simple-row');row.append(element('span','',`${invite.email||'通用邀请'} · ${invite.role} · ${invite.accepted_at?'已接受':invite.revoked_at?'已撤销':'有效'}`));if(!invite.accepted_at&&!invite.revoked_at){const cancel=element('button','ih-button ih-button-quiet','撤销');cancel.onclick=async()=>{await request(`/api/auth/invitations/${invite.id}`,{method:'DELETE'});loadUserAreas();};row.append(cancel);}inviteBox.append(row);});
    const form=document.getElementById('ih-invite-form');form.onsubmit=async e=>{e.preventDefault();try{const values=Object.fromEntries(new FormData(form));const out=await request('/api/auth/invitations',{method:'POST',body:JSON.stringify(values)});const url=`${location.origin}${location.pathname}?invite=${encodeURIComponent(out.token)}`;const result=document.getElementById('ih-invite-result');result.textContent=url;await navigator.clipboard?.writeText(url);loadUserAreas();}catch(error){alert(error.message);}};
    const auditBox=document.getElementById('ih-audit');auditBox.replaceChildren();audit.events.forEach(event=>auditBox.append(element('div','ih-simple-row',`${event.created_at} · ${event.actor_email||'系统'} · ${event.action}`)));
    const publicBlock=document.getElementById('ih-public-registration');if(currentUser.role!=='owner')publicBlock.remove();else {const toggle=document.getElementById('ih-public-toggle');toggle.checked=authConfig.allowPublicRegistration;toggle.onchange=async()=>{const result=await request('/api/auth/settings/public-registration',{method:'PUT',body:JSON.stringify({enabled:toggle.checked})});authConfig.allowPublicRegistration=result.enabled;};}
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
        request("/api/mails?direction=received&page=1&pageSize=50"),
      ]);
      renderAccounts(accounts.accounts);
      mailState.pagination = mails.pagination || mailState.pagination;
      mailState.facets = mails.facets || mailState.facets;
      renderMailCenter(mails.mails || [], accounts.accounts || []);
      loadConnectors().catch(() => {});
      if (notices) {
        catalog = notices.catalog;
        config = notices.configuration;
        renderChannels();
      }
      loadUserAreas().catch(() => {});
      setTimeout(()=>{const recovery=document.getElementById('ih-recovery');if(recovery)recovery.onclick=async()=>{const currentPassword=prompt('输入当前密码以生成新恢复码');if(!currentPassword)return;try{const result=await request('/api/auth/recovery/regenerate',{method:'POST',body:JSON.stringify({currentPassword})});alert(`请立即保存以下恢复码（仅显示一次）：\n${result.recoveryCodes.join('\n')}`);}catch(error){alert(error.message);}};const remove=document.getElementById('ih-delete-account');if(remove)remove.onclick=async()=>{const currentPassword=prompt('输入当前密码以永久删除账户');if(!currentPassword)return;if(!confirm('邮件、账户、通知和共享链接将被永久删除。'))return;try{await request('/api/auth/me',{method:'DELETE',body:JSON.stringify({currentPassword})});lock();}catch(error){alert(error.message);}};},0);
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
      // Members can use only provider-controlled endpoints.  The server
      // enforces the same rule; this is an intentionally clear UI affordance.
      if (currentUser?.role !== "owner" && ["email", "webhook"].includes(type)) return;
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
        if (currentUser?.role !== "owner" && type === "bark" && f.key === "serverUrl") {
          input.disabled = true;
          input.placeholder = "成员仅可使用官方 api.day.app";
          input.title = "成员不能配置自定义 Bark 服务地址";
        }
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
    if (currentUser?.role !== "owner") {
      const note = element("p", "ih-section-copy", "仅 Owner（宿主机运营者）可配置 SMTP、通用 Webhook 与自定义 Bark 服务地址；成员和管理员仅可使用官方推送服务。");
      list.prepend(note);
    }
    document.getElementById("ih-share-days").value = config.shareLinkDays || 30;
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
          includeFullBody: false,
          shareLinkDays: Number(document.getElementById("ih-share-days").value) || 30,
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
          createSwitch(a, "syncEnabled", "同步"),
        );
      } else {
        permissions.append(element("span", "ih-muted", "仅可清理"));
      }
      const checked = element(
        "div",
        "ih-last-checked",
        a.lastSyncAt
          ? `${new Date(a.lastSyncAt).toLocaleString()} · ${a.syncStatus === "failed" ? "失败" : "正常"}`
          : a.lastSyncError || "尚未同步",
      );
      const actions = element("div", "ih-account-actions");
      const fetchButton = element("button", "ih-button ih-button-quiet", "取件");
      fetchButton.type = "button";
      fetchButton.onclick = async () => {
        fetchButton.disabled = true; fetchButton.textContent = "取件中…";
        try { await request("/api/accounts/fetch-mail", { method: "POST", body: JSON.stringify({ ids: [a.id] }) }); await load(); }
        catch (error) { alert(error.message); }
        finally { fetchButton.disabled = false; fetchButton.textContent = "取件"; }
      };
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
      const revoke = element("button", "ih-button ih-button-quiet", "撤销授权");
      revoke.type = "button";
      revoke.disabled = a.status !== "active";
      revoke.onclick = async () => {
        if (!confirm(`撤销 ${a.username} 的 OAuth 授权？之后需要重新授权才能取件。`)) return;
        await request(`/api/accounts/${encodeURIComponent(a.id)}/revoke`, { method: "POST" });
        await load();
      };
      actions.append(fetchButton);
      if (isSupported) actions.append(auth, revoke);
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
  (async()=>{try{authConfig=await request("/api/auth/config");if(authConfig.user){currentUser=authConfig.user;render();}else renderLock();}catch(error){renderLock();}})();
})();
