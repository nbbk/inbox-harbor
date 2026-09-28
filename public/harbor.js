(() => {
  const root = document.getElementById("harbor-ui");
  let currentUser = null;
  let pendingRecoveryCodes = null;
  let branding = { logoDataUrl: "" };
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
    sender: "",
    dateFrom: "",
    dateTo: "",
    selectedId: "",
    page: 1,
    pageSize: 50,
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
    facets: {},
  };
  let mailRequestSequence = 0;
  let activeLoadSequence = 0;
  let sessionEpoch = 0;
  let historySequence = 0;
  let historyPage = 1;
  const preferenceKey = () => currentUser ? `inboxharbor.mail-preferences.${currentUser.id}` : "";
  function readPreferences() {
    try { const value = JSON.parse(localStorage.getItem(preferenceKey()) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
  }
  function writePreferences() {
    try {
      const value = { category: mailState.category, account: mailState.account, query: mailState.query, sender: mailState.sender, dateFrom: mailState.dateFrom, dateTo: mailState.dateTo, pageSize: mailState.pageSize };
      localStorage.setItem(preferenceKey(), JSON.stringify(value));
    } catch {}
  }
  function restorePreferences() {
    const value = readPreferences();
    for (const key of ["category","account","query","sender","dateFrom","dateTo","pageSize"]) if (value[key] !== undefined) mailState[key] = value[key];
    if (!["全部","已发送","验证码","通知","账单","社交","推广","其他"].includes(mailState.category)) mailState.category = "全部";
    for (const key of ["account","query","sender","dateFrom","dateTo"]) mailState[key] = typeof mailState[key] === "string" ? mailState[key].slice(0,500) : (key === "account" ? "全部" : "");
    for (const key of ["dateFrom","dateTo"]) if (!/^\d{4}-\d{2}-\d{2}$/.test(mailState[key])) mailState[key] = "";
    mailState.pageSize = [20,50,100].includes(Number(mailState.pageSize)) ? Number(mailState.pageSize) : 50;
    mailState.page = 1; mailState.selectedId = "";
  }
  function resetMailState() {
    clearTimeout(mailState.searchTimer);
    mailState = { mails: [], accounts: [], category:"全部", account:"全部", query:"", sender:"", dateFrom:"", dateTo:"", selectedId:"", page:1, pageSize:50, pagination:{page:1,pageSize:50,total:0,totalPages:1}, facets:{} };
    ++activeLoadSequence; ++mailRequestSequence; ++historySequence;
    allAccounts = []; providerFilter = "all"; statusFilter = "all"; searchQuery = ""; accountPage = 1;
    catalog = {}; config = { includeFullBody:false, shareLinkDays:30, channels:[] };
  }
  const esc = (value) => String(value || "");
  function request(url, opts = {}) {
    const epoch = sessionEpoch;
    return fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
      credentials: "same-origin",
    }).then(async (r) => {
      const text = await r.text();
      if (epoch !== sessionEpoch) throw new Error("会话已切换，请使用当前页面。");
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { message: `服务返回异常（HTTP ${r.status}）` };
      }
      if (!r.ok) {
        if (r.status === 401 && !url.startsWith("/api/auth/")) lock();
        throw new Error([body.message || body.error?.label || "请求失败", body.error?.hint].filter(Boolean).join("："));
      }
      return body;
    });
  }
  function lock() {
    ++sessionEpoch;
    currentUser = null;
    pendingRecoveryCodes = null;
    resetMailState();
    try { localStorage.removeItem("inboxharbor.active-user"); } catch {}
    root.querySelector(".ih-recovery-notice")?.remove();
    renderLock();
  }
  function brandMark() {
    const mark = element("span", "ih-mark");
    if (branding.logoDataUrl) {
      const image = document.createElement("img");
      image.src = branding.logoDataUrl;
      image.alt = "InboxHarbor Logo";
      mark.append(image);
    } else mark.textContent = "IH";
    return mark;
  }
  function refreshBrandMarks() {
    root.querySelectorAll(".ih-mark:not(.ih-logo-preview .ih-mark)").forEach(mark => mark.replaceWith(brandMark()));
  }
  function renderLock() {
    root.innerHTML = "";
    const box = element("div", "ih-lock");
    const card = element("div");
    card.append(brandMark(), element("h1", "", "InboxHarbor"), element("p", "", "私有、克制的邮件工作台。"));
    const form = element("form", "ih-auth-form");
    const email = document.createElement("input");
    email.type = "email"; email.placeholder = "邮箱地址"; email.required = true;
    email.autocomplete = "username"; email.setAttribute("aria-label", "邮箱地址");
    const input = document.createElement("input");
    input.type = "password"; input.placeholder = "密码"; input.required = true;
    input.autocomplete = "current-password"; input.setAttribute("aria-label", "密码");
    const button = element("button", "ih-button ih-auth-primary", "登录");
    button.type = "submit";
    form.append(email, input, button);
    form.onsubmit = async (e) => {
      e.preventDefault(); button.disabled = true;
      try {
        const result = await request("/api/auth/login", {method:"POST",body:JSON.stringify({email:email.value,password:input.value})});
        currentUser = result.user; try { localStorage.setItem("inboxharbor.active-user", currentUser.id); } catch {} restorePreferences(); render();
      } catch (error) { alert(error.message); button.disabled = false; }
    };
    const actions = element("div", "ih-auth-actions");
    const action = (label, handler) => {
      const control = element("button", "ih-button ih-button-quiet", label);
      control.type = "button"; control.onclick = handler; actions.append(control);
    };
    if (!authConfig.ownerInitialized) action("首次设置 Owner", renderBootstrap);
    if (authConfig.allowPublicRegistration) action("创建账号", () => renderRegistration());
    if (pendingInviteToken) action("接受邀请", () => renderRegistration(pendingInviteToken));
    action("忘记密码", renderRecoveryReset);
    card.append(form, actions); box.append(card); root.append(box);
  }
  function displayRecoveryCodes(codes){pendingRecoveryCodes=Array.isArray(codes)?codes.filter(Boolean):[];}
  function renderRecoveryNotice() {
    root.querySelector(".ih-recovery-notice")?.remove();
    if (!pendingRecoveryCodes?.length) return;
    const previousFocus = document.activeElement;
    const box = element("dialog", "ih-recovery-notice");
    box.setAttribute("aria-labelledby", "ih-recovery-title");
    box.setAttribute("aria-describedby", "ih-recovery-description");
    const title = element("h2", "", "请保存恢复码"); title.id = "ih-recovery-title";
    const description = element("p", "ih-section-copy", "这些恢复码只显示这一次。请复制或下载到离线密码管理器。");
    description.id = "ih-recovery-description";
    const codes = element("pre", "ih-recovery-codes", pendingRecoveryCodes.join("\n"));
    const status = element("p", "ih-recovery-status"); status.setAttribute("role", "status");
    const actions = element("div", "ih-recovery-actions");
    const copy = element("button", "ih-button ih-button-quiet", "复制恢复码");
    copy.type = "button";
    copy.onclick = async () => {
      try {
        if (!navigator.clipboard) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(pendingRecoveryCodes.join("\n"));
        status.textContent = "已复制恢复码。";
      } catch { status.textContent = "无法自动复制，请选择恢复码复制，或点击下载。"; }
    };
    const download = element("button", "ih-button ih-button-quiet", "下载恢复码");
    download.type = "button";
    download.onclick = () => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([pendingRecoveryCodes.join("\n") + "\n"], {type:"text/plain"}));
      link.download = "inboxharbor-recovery-codes.txt";
      link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    const close = element("button", "ih-button", "我已安全保存");
    close.type = "button";
    close.onclick = () => {
      pendingRecoveryCodes = null; box.close(); box.remove();
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
      else root.querySelector(".ih-head button")?.focus();
    };
    box.addEventListener("cancel", event => { event.preventDefault(); status.textContent = "保存恢复码后，请点击“我已安全保存”。"; });
    actions.append(copy, download, close);
    box.append(title, description, codes, status, actions);
    root.append(box); box.showModal(); copy.focus();
  }
  function renderBootstrap(){renderAuthForm("初始化收件港","用启动终端显示的本机管理口令，创建唯一 Owner。",async values=>{const created=await request("/api/auth/bootstrap",{method:"POST",headers:{Authorization:`Bearer ${values.recovery}`},body:JSON.stringify({email:values.email,password:values.password})});displayRecoveryCodes(created.user.recoveryCodes);const result=await request("/api/auth/login",{method:"POST",body:JSON.stringify({email:values.email,password:values.password})});currentUser=result.user; try { localStorage.setItem("inboxharbor.active-user", currentUser.id); } catch {} authConfig.ownerInitialized=true; restorePreferences(); render();},true);}
  function renderRecoveryReset(){renderAuthForm("恢复访问","输入邮箱、一次性恢复码和新密码。使用后会退出所有设备。",async values=>{await request('/api/auth/recovery/reset',{method:'POST',body:JSON.stringify({email:values.email,code:values.recovery,newPassword:values.password})});alert('密码已重置，请登录');renderLock();},true);}
  function renderRegistration(inviteToken=""){renderAuthForm(inviteToken?"接受邀请":"创建账号",inviteToken?"设置你的登录邮箱和密码。":"公开注册已由管理员开启。",async values=>{const endpoint=inviteToken?"/api/auth/invitations/accept":"/api/auth/register";const created=await request(endpoint,{method:"POST",body:JSON.stringify(inviteToken?{token:inviteToken,email:values.email,password:values.password}:{email:values.email,password:values.password})});displayRecoveryCodes(created.user.recoveryCodes);const result=await request("/api/auth/login",{method:"POST",body:JSON.stringify({email:values.email,password:values.password})});currentUser=result.user; try { localStorage.setItem("inboxharbor.active-user", currentUser.id); } catch {} restorePreferences(); render();});}
  function renderAuthForm(title,description,submit,needsRecovery=false){root.innerHTML="";const box=element("div","ih-lock"),card=element("div");card.append(brandMark(),element("h1","",title),element("p","",description));const form=element("form","ih-auth-form");const email=document.createElement("input");email.type="email";email.placeholder="邮箱地址";email.required=true;const password=document.createElement("input");password.type="password";password.placeholder="至少 12 位密码";password.minLength=12;password.required=true;form.append(email,password);let recovery;if(needsRecovery){recovery=document.createElement("input");recovery.type="password";recovery.placeholder=title==="恢复访问"?"一次性恢复码":"本机管理口令（仅首次使用）";recovery.required=true;form.append(recovery);}const button=element("button","ih-button ih-auth-primary","继续");form.append(button);form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{await submit({email:email.value,password:password.value,recovery:recovery?.value});}catch(error){alert(error.message);button.disabled=false;}};const back=element("button","ih-button ih-button-quiet","返回登录");back.type="button";back.onclick=renderLock;form.append(back);card.append(form);box.append(card);root.append(box);}
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
    ++sessionEpoch;
    restorePreferences();
    root.innerHTML = "";
    const shell = element("div", "ih-shell");
    const side = element("aside", "ih-side");
    const brand = element("div", "ih-brand");
    brand.innerHTML =
      '<div><b>InboxHarbor</b><small>收件港</small></div>';
    brand.prepend(brandMark());
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
      <div class="ih-mail-tools">
        <label class="ih-mail-search"><span>搜索</span><input id="ih-mail-search" placeholder="搜索主题、发件人或正文"></label>
        <label><span>发件人</span><input id="ih-mail-sender" placeholder="例如 alerts@example.com"></label>
        <label><span>邮箱账户</span><select id="ih-mail-account"><option value="全部">全部账户</option></select></label>
        <label><span>起始日期</span><input id="ih-mail-date-from" type="date"></label>
        <label><span>结束日期</span><input id="ih-mail-date-to" type="date"></label>
        <button id="ih-mail-reset" class="ih-button ih-button-quiet" type="button">重置筛选</button>
      </div>
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
    const scheduleFilter = () => { ++mailRequestSequence; writePreferences(); clearTimeout(mailState.searchTimer); mailState.searchTimer = setTimeout(() => loadMailPage(1), 250); };
    s.querySelector("#ih-mail-search").oninput = (event) => { mailState.query = event.target.value.trim(); scheduleFilter(); };
    s.querySelector("#ih-mail-sender").oninput = (event) => { mailState.sender = event.target.value.trim(); scheduleFilter(); };
    s.querySelector("#ih-mail-account").onchange = (event) => { mailState.account = event.target.value; writePreferences(); loadMailPage(1); };
    s.querySelector("#ih-mail-date-from").onchange = (event) => { mailState.dateFrom = event.target.value; writePreferences(); loadMailPage(1); };
    s.querySelector("#ih-mail-date-to").onchange = (event) => { mailState.dateTo = event.target.value; writePreferences(); loadMailPage(1); };
    s.querySelector("#ih-mail-reset").onclick = () => {
      mailState.category="全部"; mailState.account="全部"; mailState.query=""; mailState.sender=""; mailState.dateFrom=""; mailState.dateTo=""; mailState.page=1; mailState.selectedId="";
      writePreferences();
      ["#ih-mail-search","#ih-mail-sender","#ih-mail-date-from","#ih-mail-date-to"].forEach(sel => { const input=s.querySelector(sel); if(input) input.value=""; });
      const account=s.querySelector("#ih-mail-account"); if(account) account.value="全部";
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
    return mailState.mails;
  }

  function renderMailCenter(mails, accounts) {
    const search=document.getElementById("ih-mail-search"), sender=document.getElementById("ih-mail-sender"), from=document.getElementById("ih-mail-date-from"), to=document.getElementById("ih-mail-date-to");
    if(search) search.value=mailState.query; if(sender) sender.value=mailState.sender; if(from) from.value=mailState.dateFrom; if(to) to.value=mailState.dateTo;
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
        writePreferences();
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
    accountSelect.value = [...accountSelect.options].some(o => o.value === current) ? current : "全部";
    if (accountSelect.value !== current) { mailState.account = "全部"; writePreferences(); }
    const filtered = visibleMails();
    document.getElementById("ih-mail-summary").textContent = `共 ${mailState.pagination.total || 0} 封 · 本页 ${filtered.length} 封`;
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
    clearTimeout(mailState.searchTimer);
    const sequence = ++mailRequestSequence;
    if (!currentUser) return;
    if (mailState.dateFrom && mailState.dateTo && mailState.dateFrom > mailState.dateTo) { document.getElementById("ih-mail-summary").textContent = "起始日期不能晚于结束日期"; return; }
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(mailState.pageSize) });
      if (mailState.query) params.set("q", mailState.query);
      if (mailState.sender) params.set("sender", mailState.sender);
      if (mailState.account !== "全部") params.set("account", mailState.account);
      if (mailState.dateFrom) params.set("dateFrom", mailState.dateFrom);
      if (mailState.dateTo) params.set("dateTo", mailState.dateTo);
      if (mailState.category === "已发送") params.set("direction", "sent");
      else { params.set("direction", "received"); if (mailState.category !== "全部") params.set("category", mailState.category); }
      const result = await request(`/api/mails?${params}`);
      if (sequence !== mailRequestSequence || !currentUser) return;
      if (page > (result.pagination?.totalPages || page)) return loadMailPage(result.pagination.totalPages);
      mailState.page = result.pagination?.page || page;
      mailState.pagination = result.pagination || mailState.pagination;
      mailState.facets = result.facets || mailState.facets;
      mailState.selectedId = "";
      renderMailCenter(result.mails || []);
      writePreferences();
    } catch (error) { if (sequence === mailRequestSequence) alert(error.message); }
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
      const codeBox = element("div", "ih-code-box ih-code-box-prominent");
      const copy = element("button", "ih-button ih-button-quiet", "复制验证码");
      copy.onclick = async () => { const ok = await copyText(mail.code, copy); if (ok) copy.textContent = "已复制"; };
      const related = mailState.mails.filter(item => item.id !== mail.id && item.account === mail.account && item.sender === mail.sender && item.code && item.code !== "未发现验证码").sort((a,b) => new Date(b.receivedAt||0)-new Date(a.receivedAt||0));
      const newest = related[0];
      const freshness = !Number.isFinite(Date.parse(mail.receivedAt)) ? "邮件时间未知，无法比较新旧" : newest && new Date(newest.receivedAt||0) > new Date(mail.receivedAt||0) ? "本页同账户、同发件人有更新验证码，请核对后复制" : "本页同账户、同发件人中最新；其他页可能有更新邮件";
      codeBox.append(element("span", "", "验证码（邮件内容识别，未验证有效性）"), element("strong", "", mail.code), copy, element("small", "", `${freshness} · ${formatMailTime(mail.receivedAt)}`));
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
    s.innerHTML = '<div class="ih-section-head"><div><h1>邮箱账户</h1><p class="ih-section-copy">统一管理 Google 与 Microsoft 邮箱授权、收件和发信权限。</p></div><div class="ih-section-actions"><button id="ih-fetch" class="ih-button ih-button-quiet">手动取件</button><button id="ih-add" class="ih-button">添加邮箱</button></div></div><div id="ih-fetch-summary" class="ih-fetch-summary" role="status"></div><div class="ih-account-surface" id="ih-accounts-list">正在加载账户…</div>';
    s.querySelector("#ih-fetch").onclick = async () => {
      const button=s.querySelector("#ih-fetch"), summary=s.querySelector("#ih-fetch-summary");
      button.disabled=true; button.textContent="取件中…"; summary.textContent="正在检查账户…";
      try {
        const result=await request("/api/accounts/fetch-mail",{method:"POST",body:JSON.stringify({})});
        const failed=Number(result.failedCount||0), succeeded=Number(result.succeededCount||0);
        summary.textContent = `检查完成：${succeeded} 个成功，${failed} 个需处理，${Number(result.skippedCount||0)} 个已暂停；新增 ${Number(result.fetchedCount||0)} 封通知邮件。`;
        await load();
      } catch(error) { summary.textContent=error.message; }
      finally { button.disabled=false; button.textContent="手动取件"; }
    };
    s.querySelector("#ih-add").onclick = openAddAccounts;
    return s;
  }
  function notifications() {
    const s = element("section", "ih-page");
    s.id = "ih-notifications";
    s.innerHTML = '<div class="ih-section-head"><div><h2>通知渠道</h2><p class="ih-section-copy">配置推送渠道与共享阅读规则。</p></div></div><div class="ih-layout"><div><section class="ih-share-settings" aria-labelledby="ih-share-title"><div class="ih-share-icon" aria-hidden="true">🔗</div><div class="ih-share-copy"><h3 id="ih-share-title">共享阅读链接</h3><p>通知中的“查看邮件”链接免登录、只读，过期后自动失效。</p></div><label class="ih-share-field" for="ih-share-days"><span>有效期</span><span class="ih-share-input"><input id="ih-share-days" type="number" min="1" max="365" value="30" inputmode="numeric" aria-label="查看链接有效期（天）" aria-describedby="ih-share-hint"><b>天</b></span><small id="ih-share-hint">1–365 天，默认 30 天</small></label></section><div class="ih-channels" id="ih-channel-list"></div><div class="ih-save-row"><button id="ih-save" class="ih-button">保存通知设置</button><span>保存后对新生成的链接生效</span></div></div><aside class="ih-card ih-guide" id="ih-channel-guide"><p>选择一个渠道</p><h3>配置说明</h3><p>所有渠道只推送摘要与免登录只读链接；凭据不会回显。</p></aside></div><section class="ih-card ih-delivery-history"><div class="ih-section-head"><div><h3>通知历史</h3><p class="ih-section-copy">仅展示当前账户的投递状态，不包含凭据。</p></div><button id="ih-history-refresh" class="ih-button ih-button-quiet">刷新历史</button></div><div id="ih-delivery-history" class="ih-simple-list">正在加载…</div></section>';
    const historyControls = element("div","ih-history-controls");
    const historyState = document.createElement("select"); historyState.id="ih-history-state"; historyState.setAttribute("aria-label","通知状态");
    [["","全部状态"],["failed","失败"],["delivered","渠道已接受"],["sending","发送中"]].forEach(([v,l])=>historyState.add(new Option(l,v)));
    historyState.onchange=()=>loadNotificationHistory(1); historyControls.append(historyState);
    s.querySelector(".ih-delivery-history").insertBefore(historyControls,s.querySelector("#ih-delivery-history"));
    const pager=element("div","ih-history-pager"); pager.id="ih-history-pager"; s.querySelector(".ih-delivery-history").append(pager);
    s.querySelector("#ih-history-refresh").onclick=()=>loadNotificationHistory(historyPage);
    return s;
  }
  async function loadNotificationHistory(page = 1) {
    const box=document.getElementById("ih-delivery-history"); if(!box || !currentUser)return;
    const sequence=++historySequence, epoch=sessionEpoch; historyPage=page;
    const refresh=document.getElementById("ih-history-refresh"); if(refresh)refresh.disabled=true;
    box.textContent="正在加载…";
    try {
      const params=new URLSearchParams({page:String(page),pageSize:"20"});
      const state=document.getElementById("ih-history-state")?.value; if(state)params.set("state",state);
      const result=await request("/api/v1/notifications/deliveries?"+params);
      if(sequence!==historySequence || epoch!==sessionEpoch || !box.isConnected)return;
      box.replaceChildren();
      const stateLabels={pending:"等待发送",sending:"发送中",delivered:"渠道已接受",failed:"发送失败"};
      (result.deliveries||[]).forEach(item=>{
        const row=element("div","ih-simple-row ih-delivery-row"), detail=element("div","ih-delivery-detail");
        const title=item.kind==="test" ? "渠道测试" : item.mail?.subject || "原邮件已删除";
        detail.append(element("b","",(catalog[item.channelType]?.name||item.channelType||"通知")+" · "+title));
        detail.append(element("small","", "最近尝试："+formatMailTime(item.updatedAt||item.createdAt)+" · 尝试 "+(item.attempts||0)+" 次"));
        if(item.mail?.account)detail.append(element("small","",item.mail.account));
        if(item.error)detail.append(element("small","ih-delivery-error",item.error.label+"："+item.error.hint));
        if(item.nextRetryAt)detail.append(element("small","","预计重试："+formatMailTime(item.nextRetryAt)));
        else if(item.state==="failed")detail.append(element("small","",item.kind==="test"?"测试不会自动重试，请修正配置后再次测试。":"暂无自动重试计划，请检查渠道配置。"));
        row.append(detail,element("span","ih-delivery-state",stateLabels[item.state]||"状态未知"));box.append(row);
      });
      if(!(result.deliveries||[]).length)box.textContent="暂无符合条件的通知记录。";
      const pager=document.getElementById("ih-history-pager");pager.replaceChildren();
      const previous=element("button","ih-button ih-button-quiet","上一页记录"),next=element("button","ih-button ih-button-quiet","下一页记录");
      previous.disabled=page<=1;next.disabled=page*20>=result.total;
      previous.onclick=()=>loadNotificationHistory(page-1);next.onclick=()=>loadNotificationHistory(page+1);
      pager.append(previous,element("span","","共 "+(result.total||0)+" 条 · 渠道接受不代表终端已读"),next);
    } catch(error) { if(sequence===historySequence&&epoch===sessionEpoch)box.textContent="通知历史暂时不可用："+error.message; }
    finally { if(sequence===historySequence&&refresh?.isConnected)refresh.disabled=false; }
  }
  function profile() {
    const s = element("section", "ih-page"); s.id="ih-profile";
    s.innerHTML='<div class="ih-section-head"><div><h1>个人中心</h1><p class="ih-section-copy">管理你的登录安全、用量和邮件共享链接。</p></div></div><div class="ih-profile-grid"><section class="ih-card"><h2>账户信息</h2><p id="ih-profile-identity">正在读取…</p><div id="ih-profile-quota" class="ih-quota"></div><button id="ih-recovery" class="ih-button ih-button-quiet" type="button">重新生成恢复码</button></section><form id="ih-password-form" class="ih-card"><h2>修改密码</h2><label class="ih-field-label">当前密码<input name="currentPassword" type="password" required></label><label class="ih-field-label">新密码<input name="newPassword" type="password" minlength="12" required></label><div class="ih-section-actions"><button class="ih-button" type="submit">更新密码</button><button class="ih-button ih-button-quiet" type="button" id="ih-logout-all">退出全部设备</button></div></form></div><section class="ih-card"><div class="ih-section-head"><div><h2>我的共享链接</h2><p class="ih-section-copy">已撤销或过期链接不会再公开邮件内容。</p></div></div><div id="ih-shares" class="ih-simple-list"></div></section>';
    if(currentUser?.role==='user'){const danger=element('button','ih-button ih-button-danger','永久删除我的账户');danger.id='ih-delete-account';danger.type='button';s.append(danger);}s.querySelector('#ih-password-form').onsubmit=async e=>{e.preventDefault();try{await request('/api/auth/change-password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});alert('密码已更新，请重新登录');lock();}catch(error){alert(error.message);}};
    s.querySelector('#ih-logout-all').onclick=async()=>{await request('/api/auth/logout-all',{method:'POST'});lock();}; return s;
  }
  function admin(){const s=element('section','ih-page');s.id='ih-admin';s.innerHTML='<div class="ih-section-head"><div><h1>管理后台</h1><p class="ih-section-copy">仅展示必要的成员、邀请与实例审计信息。</p></div></div><div class="ih-admin-grid"><section class="ih-card"><h2>成员</h2><div id="ih-users" class="ih-simple-list"></div></section><section class="ih-card"><h2>创建邀请</h2><form id="ih-invite-form"><label class="ih-field-label">邮箱（可留空）<input name="email" type="email" placeholder="member@example.com"></label><label class="ih-field-label">角色<select name="role"><option value="user">成员</option><option value="admin">管理员</option></select></label><label class="ih-field-label">有效期（小时）<input name="ttlHours" type="number" min="1" max="720" value="72"></label><button class="ih-button" type="submit">生成邀请链接</button></form><div id="ih-invite-result" class="ih-invite-result"></div><div id="ih-invites" class="ih-simple-list"></div></section></div><section class="ih-card ih-owner-only" id="ih-public-registration"><h2>公开注册</h2><p>关闭时仅可通过邀请创建成员。</p><label class="ih-switch"><input type="checkbox" id="ih-public-toggle"><span class="ih-switch-track"></span><span class="ih-switch-label">允许公开注册</span></label></section><section class="ih-card"><h2>审计日志</h2><div id="ih-audit" class="ih-simple-list"></div></section>';if(currentUser?.role==='owner')s.append(brandingSettings());return s;}
  function brandingSettings() {
    const section = element("section", "ih-card ih-branding-settings");
    section.append(element("h2", "", "站点 Logo"), element("p", "ih-section-copy", "统一显示在登录页和侧边栏。支持 PNG、JPEG、WebP，最大 128 KB；留空使用默认 IH 标志。"));
    const preview = element("div", "ih-logo-preview"); preview.append(brandMark());
    const label = element("label", "ih-field-label", "上传 Logo");
    const input = document.createElement("input"); input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp"; input.id = "ih-logo-upload";
    label.htmlFor = input.id; label.append(input);
    const status = element("p", "ih-section-copy"); status.setAttribute("role", "status");
    const actions = element("div", "ih-section-actions");
    const save = element("button", "ih-button", "保存 Logo"); save.type = "button"; save.disabled = true;
    const reset = element("button", "ih-button ih-button-quiet", "恢复默认 Logo"); reset.type = "button";
    let candidate = branding.logoDataUrl, reading = 0;
    function showPreview(value) {
      preview.replaceChildren();
      if (value) { const image = document.createElement("img"); image.src = value; image.alt = "Logo 预览"; preview.append(image); }
      else preview.append(element("span", "ih-mark", "IH"));
    }
    input.onchange = async () => {
      const version = ++reading, file = input.files[0]; save.disabled = true;
      if (!file) return;
      if (!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size > 128 * 1024) {
        status.textContent = "请选择不超过 128 KB 的 PNG、JPEG 或 WebP 图片。"; input.value = ""; return;
      }
      try {
        const value = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); });
        const image = new Image(); image.src = value; await image.decode();
        if (version !== reading) return;
        candidate = value; showPreview(candidate); save.disabled = false; status.textContent = "预览已更新，点击保存后全站生效。";
      } catch { if (version === reading) status.textContent = "图片无法读取，请选择有效图片。"; }
    };
    async function persist(value) {
      ++reading; save.disabled = true; reset.disabled = true; input.disabled = true;
      try {
        branding = await request("/api/v1/branding", {method:"PUT",body:JSON.stringify({logoDataUrl:value})});
        candidate = branding.logoDataUrl; showPreview(candidate); refreshBrandMarks(); input.value = "";
        status.textContent = value ? "Logo 已保存，登录页和侧边栏已同步更新。" : "已恢复默认 IH 标志。";
      } catch (error) { status.textContent = error.message; save.disabled = false; }
      finally { reset.disabled = false; input.disabled = false; }
    }
    save.onclick = () => persist(candidate); reset.onclick = () => persist("");
    actions.append(save,reset); section.append(preview,label,actions,status); return section;
  }
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
            <details class="ih-tutorial" id="microsoft-long-term-guide"><summary>Microsoft 新手配置教程（展开逐步操作）</summary>
<p><b>长期使用目标：</b>一次交互授权后，由收件港通过离线访问刷新令牌并持续同步。微软没有 Google 的 Testing / Production 发布开关，也不需要添加 Google 式测试用户。正确配置可以减少重复登录，但无法承诺永久免授权；企业登录频率与安全策略仍然有效。</p>
<ol>
<li><b>准备管理应用的账号。</b>打开 <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer">Microsoft Entra 应用注册</a>并登录。若停在首页，依次进入“Microsoft Entra ID → 应用注册”；新版导航也可能显示“Entra ID → 应用注册”。若没有目录或没有注册权限，请让有权限的目录管理员创建应用；要授权的 Outlook/Hotmail 邮箱可以与管理应用的账号不同。<a href="https://learn.microsoft.com/zh-cn/entra/identity-platform/quickstart-register-app" target="_blank" rel="noopener noreferrer">官方：注册应用与前置条件</a></li>
<li><b>创建兼容当前收件港的应用。</b>点击“新注册”，名称填 <code>InboxHarbor</code>。支持的账户类型选择“任何组织目录中的账户和个人 Microsoft 账户”，以支持 Outlook/Hotmail/Live 与 Microsoft 365 工作或学校账号。当前收件港使用 <code>common</code> 登录端点；不要为此教程选择仅单个租户，否则需要另行适配程序端点。重定向 URI 留空，点击“注册”。已有应用先核对账户类型，无需每次更新重新创建。</li>
<li><b>复制正确的 ID。</b>在应用“概述”复制“应用程序(客户端) ID / Application (client) ID”，这是类似 <code>00001111-aaaa-2222-bbbb-3333cccc4444</code> 的 UUID，粘贴到本页 Microsoft 输入框。不要复制对象 ID 或目录(租户) ID。</li>
<li><b>启用设备代码所需的公共客户端流。</b>在该应用左侧进入“管理 → 身份验证 / Authentication”，找到“高级设置 → 允许公共客户端流 / Allow public client flows”，选“是 / Yes”并保存。当前收件港使用设备代码授权，不需要创建 Client Secret，也无需设置 Web、SPA 或 Google 回调地址。<a href="https://learn.microsoft.com/zh-cn/entra/identity-platform/scenario-desktop-app-registration" target="_blank" rel="noopener noreferrer">官方：公共客户端与设备代码配置</a></li>
<li><b>添加读取邮件的委托权限。</b>进入“API 权限 → 添加权限 → Microsoft Graph → 委托的权限 / Delegated permissions”，搜索并勾选 <code>Mail.Read</code>。需要发送邮件再添加 <code>Mail.Send</code>，然后点击“添加权限”。这里选择委托权限；应用程序权限 / Application permissions 是另一种接入方式，不能代替当前逐邮箱授权。<a href="https://learn.microsoft.com/zh-cn/graph/permissions-reference#mailread" target="_blank" rel="noopener noreferrer">官方：Mail.Read 权限</a></li>
<li><b>确认离线访问与身份范围。</b>仍在 Microsoft Graph 的委托权限中，搜索并添加 <code>offline_access</code>，以及 <code>openid</code>、<code>profile</code>、<code>email</code>（已存在则保留），点“添加权限”。<code>offline_access</code> 用于获取刷新令牌，其他范围用于登录身份信息；收件港的授权请求已包含这些范围。仅在控制台添加权限不会给已有授权自动补发令牌，配置完成后还要执行第 9 步授权。<a href="https://learn.microsoft.com/zh-cn/entra/identity-platform/scopes-oidc#the-offline_access-scope" target="_blank" rel="noopener noreferrer">官方：离线访问与身份权限</a></li>
<li><b>企业账号按组织要求获得同意。</b>如果授权时出现“需要管理员批准”，请将应用 Client ID 和所需委托权限提供给该邮箱所属组织的管理员。管理员在 <a href="https://entra.microsoft.com/" target="_blank" rel="noopener noreferrer">Entra 管理中心</a>检查企业应用的权限与用户分配，确认用途后按组织政策授予同意；自己租户的应用也可在“应用注册 → API 权限”查看“代表组织授予管理员同意”入口。其他租户的管理员需要在各自组织处理，本项目管理员的同意不能代替全部组织。个人微软账号通常由本人同意；不要为了授权关闭 MFA 或组织安全策略。<a href="https://learn.microsoft.com/zh-cn/entra/identity/enterprise-apps/grant-admin-consent" target="_blank" rel="noopener noreferrer">官方：授予管理员同意</a></li>
<li><b>保存到收件港。</b>回到本页点击“保存并检测配置”，检查 Microsoft 配置结果。若 Client ID 输入框被环境变量管理而不可编辑，需要部署管理员修改对应环境配置并重启服务。配置检测成功不代表邮箱已授权，也不能保证企业条件访问策略允许登录。</li>
<li><b>逐个邮箱完成首次授权。</b>进入“邮箱账户 → 添加邮箱”，服务商选 Microsoft，填写实际登录邮箱地址。点击该行“授权”，复制本次设备代码，打开弹窗给出的微软验证链接（通常是 <a href="https://microsoft.com/devicelogin" target="_blank" rel="noopener noreferrer">微软设备登录页</a>），输入代码，选择与该行相同的账号，按提示完成 MFA 并同意权限。保留收件港页面等待显示成功；代码过期就重新发起，不要反复使用旧代码。设备代码的短有效期仅限制这次登录操作，不是邮箱长期授权期限。<a href="https://learn.microsoft.com/zh-cn/entra/identity-platform/v2-oauth2-device-code" target="_blank" rel="noopener noreferrer">官方：设备代码授权流程</a></li>
<li><b>验证长期同步。</b>开启该邮箱的读取和自动同步，确认轮询间隔，点击“手动取件”并检查结果。服务器保持运行时，关闭浏览器也能继续后台同步；稍后查看最近同步时间，并在服务重启后再次检查。刷新令牌会用于换取新令牌，不需要自己定期打开微软登录页。开启发信权限后，请重新授权该邮箱。</li>
<li><b>保留授权数据。</b>更新或迁移服务器时，完整保留并备份数据目录、数据库和原加密主密钥；Docker 部署保留持久化挂载。不要删除企业应用、撤销同意或反复重建 Client ID 来“续期”。正常更新无需重新创建应用；更换 Client ID 后需要重新授权已有 Microsoft 邮箱。</li>
<li><b>企业长期运行检查。</b>若企业邮箱总在固定时间要求登录，让管理员在“Entra ID → 条件访问 → 策略”核对适用的会话控制（如登录频率），并检查是否限制设备代码流、要求合规设备或拦截高风险登录。管理员结合登录日志按组织规定评估；收件港无法绕过这些要求。浏览器的“保持登录”不会取消后台令牌的策略限制。<a href="https://learn.microsoft.com/zh-cn/entra/identity/conditional-access/concept-session-lifetime" target="_blank" rel="noopener noreferrer">官方：登录频率与会话策略</a></li>
</ol>
<p><b>长期有效的含义：</b>微软文档列出多数非 SPA 场景刷新令牌默认寿命为 90 天，并会在使用时返回新的刷新令牌；这不等于每 90 天必须人工登录，也不等于永不过期。持续运行、正常刷新与保存新令牌支持长期使用；长时间停机、用户或管理员撤销授权、账号变化和组织策略仍可能要求重新登录。不要通过注册 SPA 或添加更长寿命 Client Secret 来延长本系统设备代码授权。<a href="https://learn.microsoft.com/zh-cn/entra/identity-platform/refresh-tokens" target="_blank" rel="noopener noreferrer">官方：刷新令牌寿命与撤销</a></p>
<p><b>完成检查：</b>账户类型匹配 → 公共客户端流已启用 → Graph 委托权限及 offline_access 已配置 → 用户或管理员同意 → 逐邮箱授权成功 → 自动同步及重启后取件正常。</p>
<p><b>常见问题：</b>提示需要 <code>client_secret</code>：检查第 4 步公共客户端设置及 Client ID；账号不支持：检查第 2 步账户类型；需要管理员批准或条件访问拒绝：按第 7、12 步处理；<code>authorization_pending</code>：本次用户确认尚未完成；设备代码过期：重新点击授权；<code>invalid_grant</code> 或要求交互登录：检查撤销、失效或组织策略后重新授权，重复保存 Client ID 不能修复失效令牌。企业账号还必须具备可用的 Exchange Online 邮箱。</p>
</details>
          </section>
          <section class="ih-setup-block">
            <div class="ih-setup-heading"><span>3</span><div><h2>Google 邮箱</h2><p>一个 Web OAuth 客户端可供多个 Gmail 或 Google Workspace 邮箱分别授权。</p></div></div>
            <label class="ih-field-label">Google Client ID<input id="cx-google" placeholder="123456789012-abcdef.apps.googleusercontent.com" autocomplete="off"><small>格式：通常以数字开头，并以 <code>.apps.googleusercontent.com</code> 结尾。</small></label>
            <label class="ih-field-label">Google Client Secret<input id="cx-secret" type="password" placeholder="已配置时留空可保持原值" autocomplete="new-password"><small>只在保存时提交；保存后加密存储且页面不会回显。</small></label>
            <label class="ih-clear-secret"><input id="cx-clear" type="checkbox"> 清除已保存的 Google Client Secret</label>
            <details class="ih-tutorial" id="google-long-term-guide"><summary>Google 新手配置教程（长期使用 · 展开逐步操作）</summary>
<p><b>配置目标：</b>让收件港通过刷新令牌持续同步，避免 Testing 模式导致每 7 天重新授权。External 应用最终必须显示 <b>In production（正式版）</b>；发布与通过验证是两件事。以下按 Google 控制台现有菜单说明，中文翻译可能略有不同。<a href="https://support.google.com/cloud/answer/15549945?hl=zh-Hans" target="_blank" rel="noopener noreferrer">官方：发布状态与 7 天限制</a></p>
<ol>
<li><b>先确定使用范围。</b>个人 Gmail 或需要接入组织外邮箱：选择 External。仅同一个 Google Workspace / Cloud Identity 组织使用，且项目归该组织所有：可选 Internal，由组织管理员批准所需访问；普通 @gmail.com 不能走 Internal。个人自用及少量用户符合 Google 个人使用豁免时可以不提交验证，但仍有未验证提示及用户上限；面向公众运营不要仅凭“人数少”判断豁免。<a href="https://support.google.com/cloud/answer/13464323?hl=zh-Hans" target="_blank" rel="noopener noreferrer">官方：个人使用与组织内部使用豁免</a></li>
<li><b>准备固定的 HTTPS 访问地址。</b>确认域名已解析、证书有效，浏览器能正常打开收件港，例如 <code>https://mail.example.com</code>。在本页“外部访问地址”填写实际地址。不要填写服务器内网地址；示例域名需要换成你自己的域名。之后不要随意变更域名。</li>
<li><b>新建或选择 Google 项目。</b>打开 <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">新建项目</a>，填写名称 <code>InboxHarbor</code>，个人账号选择“无组织”，点“创建”。已有 Client ID 就选择它所属的原项目，不必重复创建。每次打开以下链接都检查控制台顶部项目名称；所有步骤必须在同一项目完成。</li>
<li><b>启用 Gmail API。</b>打开 <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer">Gmail API 配置页</a>，点击“启用（Enable）”；显示“管理（Manage）”表示已启用。</li>
<li><b>初始化 OAuth 品牌信息。</b>打开 <a href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noopener noreferrer">Branding（品牌）</a>。首次点击“Get started / 开始使用”，填写应用名称、用户支持邮箱、开发者联系邮箱；向导中的 Audience 按第 1 步选择并保存。已有配置则检查这些字段。Google 控制台的品牌 Logo 与收件港管理后台的站点 Logo 分别设置。</li>
<li><b>准备域名与公开信息。</b>在 Branding 填写真实的应用首页、隐私政策地址，以及控制台要求的其他信息；公开服务的首页要说明收件港用途，隐私政策应说明邮件数据的访问、保存、共享与删除方式。链接必须可访问，不能填写不存在的页面。在“Authorized domains / 已获授权的网域”填自己的根域名（如 <code>example.com</code>，不带 https 或路径）。需要域名验证时，打开 <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Search Console</a>，添加“网域”资源，在域名 DNS 中添加其给出的 TXT 记录，再点“验证”；使用项目所有者或编辑者账号完成。<a href="https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification" target="_blank" rel="noopener noreferrer">官方：品牌与域名验证要求</a></li>
<li><b>声明收件港实际使用的权限。</b>打开 <a href="https://console.cloud.google.com/auth/scopes" target="_blank" rel="noopener noreferrer">Data Access（数据访问）</a> → “Add or remove scopes / 添加或移除范围”。搜索或手动输入 <code>https://www.googleapis.com/auth/gmail.readonly</code> 和 <code>https://www.googleapis.com/auth/userinfo.email</code>，勾选后点“Update / 更新”并保存。前者读取邮件，后者核对授权邮箱身份。需要发信时再添加 <code>https://www.googleapis.com/auth/gmail.send</code>；不必添加全邮箱 <code>https://mail.google.com/</code> 权限。<a href="https://developers.google.com/workspace/gmail/api/auth/scopes" target="_blank" rel="noopener noreferrer">官方：Gmail 权限范围</a></li>
<li><b>创建 Web 客户端并配置回调。</b>先复制本页生成的 Google 回调地址。打开 <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Clients（客户端）</a> → “Create client / 创建客户端”，类型选“Web application / Web 应用”，名称填 <code>InboxHarbor Web</code>。在“Authorized redirect URIs / 已获授权的重定向 URI”点“Add URI”，粘贴完整回调，例如 <code>https://mail.example.com/auth/google/callback</code>。协议、域名、路径、端口及末尾斜杠必须逐字一致；只填首页或填到 JavaScript origins 不能代替此项。已有 Web 客户端可直接编辑它并保存。</li>
<li><b>将客户端配置保存到收件港。</b>创建后复制 Client ID 和 Client Secret，分别粘贴到本页对应输入框，点击“保存并检测配置”。已有客户端可从 Clients 打开详情查看；若密钥不再可见，按控制台提供的密钥管理操作处理，不要把 Client ID 当作 Secret。密钥不要发到截图、聊天或公开仓库。检测通过只说明本地配置可用，不代表 Google 已批准授权或发布。</li>
<li><b>切换到正式版，这是避免 7 天失效的关键。</b>打开 <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener noreferrer">Audience（目标对象）</a>，External 应用在“Publishing status / 发布状态”点击“Publish app / 发布应用”，阅读提示后确认；回到页面核实显示 <b>In production</b>。已经显示正式版就不必再操作。Internal 按组织内部应用流程配置，不必寻找 External 的发布按钮。<b>不要把长期实例留在 Testing。</b>添加 Test users 只能解决测试期间的访问限制，不能延长测试令牌期限。</li>
<li><b>公开服务完成相应验证。</b>若不符合第 1 步的豁免，按 <a href="https://console.cloud.google.com/auth/verification" target="_blank" rel="noopener noreferrer">Verification Center（验证中心）</a> 提示提交验证；找不到入口时从 Google Auth Platform 左侧菜单进入。先补齐 Branding、域名和隐私政策；若显示 Draft Branding，点击“Verify Branding”，成功显示“Ready to publish”后点击“Publish branding”（这与 Audience 的发布应用不同）。品牌发布后再申请数据访问验证，并核对 Data Access 中的范围，为每个范围填写使用理由，准备展示登录、授权及使用邮件功能的演示视频，按表单提交并留意开发者邮箱中的审核回复。<code>gmail.readonly</code> 属受限范围；服务器保存或传输相关数据时还可能需要按 Google 要求完成第三方安全评估。审核未通过时不能把“已发布”当作“已验证”。<a href="https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification" target="_blank" rel="noopener noreferrer">官方：受限权限验证与安全评估</a></li>
<li><b>正式发布后重新授权每个邮箱。</b>不要依赖测试阶段取得的旧令牌。返回“邮箱账户”，对之前在 Testing 时授权的邮箱先“撤销授权”，再“授权”；新邮箱先“添加邮箱”。在 Google 页面选择与该行完全相同的邮箱，并同意所需权限。只在确认是自己创建或信任的应用、符合使用条件且 Google 提供继续入口时处理未验证提示；若只有禁止访问页面，应回查项目、受众和验证状态。收件港已请求离线访问，无需在控制台另找“永久令牌”开关。<a href="https://developers.google.com/identity/protocols/oauth2/web-server#offline" target="_blank" rel="noopener noreferrer">官方：离线访问与刷新令牌</a></li>
<li><b>开启并验证后台同步。</b>回到邮箱账户开启读取与自动同步，检查轮询间隔，点击“手动取件”，确认同步成功。关闭网页后保持服务器和容器运行，稍后检查“最近同步”是否更新；更新或重启后也应能继续取件。超过 7 天后再检查一次，可确认没有继续依赖测试阶段令牌。开启发信权限后，要重新授权该邮箱。</li>
<li><b>保留持久化数据和密钥。</b>服务器更新、迁移时完整保留并备份收件港的数据目录及原加密主密钥，不要删除数据库、重新生成密钥或丢弃 Docker 持久化挂载。正常更新不需要重复建立 OAuth 客户端；更换客户端或凭据后按页面提示重新授权。</li>
</ol>
<p><b>完成检查：</b>同一个 Google 项目 → Gmail API 已启用 → 回调完全一致 → External 显示 In production（或符合条件的 Internal）→ 验证通过或符合豁免 → 发布后重新授权 → 自动同步成功。</p>
<p><b>长期使用的边界：</b>正式版消除了 Testing 的固定 7 天限制，但任何配置都不能保证永久免授权。主动撤销、涉及 Gmail 权限的密码变更、长时间未使用刷新令牌、令牌数量上限或组织安全策略都可能使令牌失效。出现 <code>invalid_grant</code> 时应检查这些原因并重新授权；重复添加测试用户无法解决。<a href="https://developers.google.com/identity/protocols/oauth2#expiration" target="_blank" rel="noopener noreferrer">官方：刷新令牌失效原因</a></p>
<p><b>常见错误：</b><code>403 access_denied</code> 且提示“测试中”：检查是否选错项目、是否仍为 Testing；长期使用按第 10–12 步处理。<code>redirect_uri_mismatch</code>：按第 8 步逐字核对回调。<code>org_internal</code>：当前邮箱不属于所选组织，按第 1 步检查受众。只有暂时测试时才在 Audience → Test users → Add users 添加邮箱。</p>
</details>
            <p class="ih-callback-note"><b>长期使用：</b>请展开上方教程完成正式发布及重新授权；仅添加测试用户仍会受到 7 天限制。正式版支持自动续期，但不保证永久免授权。</p>
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
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      const previous = button.textContent; button.textContent = "已复制"; setTimeout(() => { button.textContent = previous; }, 1500);
      return true;
    } catch {
      try {
        const area = document.createElement("textarea"); area.value = value; area.setAttribute("readonly",""); document.body.append(area); area.select();
        const ok = document.execCommand("copy"); area.remove(); if (!ok) throw new Error("copy failed");
        const previous = button.textContent; button.textContent = "已复制"; setTimeout(() => { button.textContent = previous; }, 1500);
        return true;
      } catch { button.textContent = "请手动复制"; return false; }
    }
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
    const loadSequence = ++activeLoadSequence;
    const epoch = sessionEpoch;
    try {
      const [accounts, notices] = await Promise.all([
        request("/api/accounts"),
        request("/api/v1/notifications").catch(() => null),
      ]);
      if (loadSequence !== activeLoadSequence || !currentUser) return;
      try { const validAccounts = new Set((accounts.accounts||[]).map(a=>a.username)); if(mailState.account !== "全部" && !validAccounts.has(mailState.account)) mailState.account="全部"; } catch {}
      renderAccounts(accounts.accounts);
      mailState.accounts = accounts.accounts || [];
      await loadMailPage(mailState.page || 1);
      if (loadSequence !== activeLoadSequence || epoch !== sessionEpoch || !currentUser) return;
      loadConnectors().catch(() => {});
      if (notices) { catalog = notices.catalog; config = notices.configuration; renderChannels(); loadNotificationHistory().catch(()=>{}); }
      loadUserAreas().catch(() => {});
      setTimeout(()=>{const recovery=document.getElementById('ih-recovery');if(recovery)recovery.onclick=async()=>{const currentPassword=prompt('输入当前密码以生成新恢复码');if(!currentPassword)return;try{const result=await request('/api/auth/recovery/regenerate',{method:'POST',body:JSON.stringify({currentPassword})});displayRecoveryCodes(result.recoveryCodes);renderRecoveryNotice();}catch(error){alert(error.message);}};const remove=document.getElementById('ih-delete-account');if(remove)remove.onclick=async()=>{const currentPassword=prompt('输入当前密码以永久删除账户');if(!currentPassword)return;if(!confirm('邮件、账户、通知和共享链接将被永久删除。'))return;try{await request('/api/auth/me',{method:'DELETE',body:JSON.stringify({currentPassword})});lock();}catch(error){alert(error.message);}};},0);
    } catch (err) {
      if (epoch !== sessionEpoch) return;
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
        const values = Object.fromEntries([...fields.querySelectorAll("input")].filter(input => input.value).map(input => [input.dataset.key, input.value]));
        const status = element("small","ih-inline-feedback"); status.setAttribute("role","status"); test.parentElement.querySelector(".ih-inline-feedback")?.remove(); test.parentElement.append(status);
        test.disabled=true; test.textContent="测试中…"; status.textContent="正在发送测试通知…";
        try { const result=await request(`/api/v1/notifications/${type}/test`,{method:"POST",body:JSON.stringify({config:values})}); status.textContent=result.message||"测试请求已接受。"; status.className="ih-inline-feedback success"; }
        catch(error) { status.textContent=error.message; status.className="ih-inline-feedback error"; }
        finally { test.disabled=false; test.textContent="测试"; if(test.isConnected)loadNotificationHistory(1); }
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
      const health = a.health || {};
      const healthState = health.state || (a.syncStatus === "failed" ? "network" : a.lastSyncAt ? "normal" : "unsynced");
      const healthLabel = health.label || ({normal:"同步正常",network:"网络异常",authorization:"需要重新授权",permission:"权限不足",paused:"同步已暂停",unsynced:"尚未同步",configuration:"连接器未配置",sync_failed:"同步失败",syncing:"同步中",unsupported:"历史账户"}[healthState] || "状态未知");
      const checked = element("div", "ih-last-checked");
      checked.append(element("b", "", healthLabel), element("small", "", health.lastSyncedAt ? `最近同步：${new Date(health.lastSyncedAt).toLocaleString()}` : "最近同步：尚未同步"), element("small", "", health.nextSyncAt ? `下次同步：${new Date(health.nextSyncAt).toLocaleString()}` : "下次同步：未安排"), element("small", "", health.hint || a.lastSyncError || ""));
      if (["authorization","permission","configuration","sync_failed","network"].includes(healthState)) {
        const recover = element("button", "ih-button ih-button-quiet", healthState === "authorization" ? "重新授权" : ["sync_failed","network"].includes(healthState) ? "重试同步" : healthState === "configuration" ? (currentUser?.role === "owner" ? "配置连接器" : "联系管理员") : "检查权限");
        recover.type="button";
        recover.onclick=async()=>{ if(healthState==="configuration"){if(currentUser?.role==="owner")show("connectors");else checked.append(element("small","","请联系此站点 Owner 检查连接器设置。"));return;} recover.disabled=true;try{if(["authorization","permission"].includes(healthState))await authorize(a);else await request("/api/accounts/fetch-mail",{method:"POST",body:JSON.stringify({ids:[a.id]})});await load();}catch(error){handleAuthorizationError(error);}finally{recover.disabled=false;}};
        checked.append(recover);
      }
      const actions = element("div", "ih-account-actions");
      const fetchButton = element("button", "ih-button ih-button-quiet", "取件");
      fetchButton.type = "button";
      fetchButton.onclick = async () => {
        fetchButton.disabled = true; fetchButton.textContent = "取件中…";
        try {
          const result = await request("/api/accounts/fetch-mail", { method: "POST", body: JSON.stringify({ ids: [a.id] }) });
          const item = (result.results || []).find(row => row.accountId === a.id);
          fetchButton.title = item?.health?.hint || "";
          await load();
        } catch (error) { alert(error.message); }
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

  }
  (async()=>{try{[authConfig,branding]=await Promise.all([request("/api/auth/config"),request("/api/auth/branding").catch(()=>({logoDataUrl:""}))]);if(authConfig.user){currentUser=authConfig.user;render();}else renderLock();}catch(error){renderLock();}})();
})();
