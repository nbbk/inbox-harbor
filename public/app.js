document.addEventListener('DOMContentLoaded', () => {
  let currentAccounts = [];
  let currentMails = [];
  let selectedAccountIds = new Set();
  let activeProviderFilter = 'all';

  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      item.classList.add('active');
      document.getElementById(targetTab).classList.add('active');

      if (targetTab === 'tab-codes') {
        loadMails();
      }
    });
  });

  const providerTabs = document.querySelectorAll('.provider-tab');
  providerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      providerTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeProviderFilter = tab.getAttribute('data-provider');
      applyFilters();
    });
  });

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '<i class="fa-solid fa-circle-info text-primary"></i>';
    if (type === 'success') icon = '<i class="fa-solid fa-circle-check text-success"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation text-danger"></i>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  window.copyToClipboard = function(text, label = '内容') {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`${label} 已复制到剪贴板！`, 'success');
    }).catch(err => {
      showToast('复制失败', 'error');
    });
  };

  window.togglePassword = function(id) {
    const elem = document.getElementById(`pass-${id}`);
    const icon = document.getElementById(`eye-${id}`);
    if (elem.dataset.masked === 'true') {
      elem.textContent = elem.dataset.password || '（未设置）';
      elem.dataset.masked = 'false';
      if (icon) icon.className = 'fa-solid fa-eye-slash';
    } else {
      elem.textContent = '••••••••';
      elem.dataset.masked = 'true';
      if (icon) icon.className = 'fa-solid fa-eye';
    }
  };

  window.editPassword = async function(id, oldPwd = '') {
    const newPwd = prompt('请输入或修正该账号的明文密码：', oldPwd);
    if (newPwd === null) return;
    try {
      const res = await fetch('/api/accounts/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password: newPwd.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast('密码更新成功！', 'success');
        loadAccounts();
      }
    } catch (e) {
      showToast('更新密码失败', 'error');
    }
  };

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      document.getElementById('stat-total-accounts').textContent = data.totalAccounts;
      document.getElementById('stat-active-accounts').textContent = data.activeAccounts;
      document.getElementById('stat-total-codes').textContent = data.totalCodes;
      document.getElementById('stat-total-mails').textContent = data.totalMails;
      document.getElementById('nav-code-count').textContent = data.totalCodes;

      document.getElementById('count-all').textContent = data.totalAccounts;
      document.getElementById('count-ms').textContent = data.microsoftAccounts || 0;
      document.getElementById('count-gg').textContent = data.googleAccounts || 0;
    } catch (err) {
      console.error('加载统计失败', err);
    }
  }

  async function loadAccounts() {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      if (data.success) {
        currentAccounts = data.accounts;
        applyFilters();
        loadStats();
      }
    } catch (err) {
      console.error('加载账号列表失败', err);
    }
  }

  function applyFilters() {
    const q = document.getElementById('search-account').value.toLowerCase();
    const filtered = currentAccounts.filter(acc => {
      const p = acc.provider || 'microsoft';
      const matchProvider = activeProviderFilter === 'all' || p === activeProviderFilter;
      const matchSearch = acc.username.toLowerCase().includes(q) || 
                          acc.note.toLowerCase().includes(q) ||
                          acc.password.toLowerCase().includes(q);
      return matchProvider && matchSearch;
    });

    renderAccountsTable(filtered);
  }

  function renderAccountsTable(accounts) {
    const tbody = document.getElementById('accounts-tbody');
    tbody.innerHTML = '';

    if (accounts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">当前分类下暂无邮箱账号，请先批量导入或点击上方按钮添加。</td></tr>`;
      return;
    }

    accounts.forEach((acc, index) => {
      const tr = document.createElement('tr');
      const isChecked = selectedAccountIds.has(acc.id) ? 'checked' : '';

      let statusBadge = '';
      if (acc.status === 'active') {
        statusBadge = '<span class="status-tag tag-active" title="OAuth2 认证成功"><i class="fa-solid fa-circle"></i> 活跃正常</span>';
      } else if (acc.status === 'invalid') {
        const detail = acc.errorDetail || '账号已被封禁或 Token 失效';
        statusBadge = `<span class="status-tag tag-invalid" title="${detail}"><i class="fa-solid fa-circle-xmark"></i> 封禁/失效</span>`;
      } else {
        statusBadge = '<span class="status-tag tag-pending"><i class="fa-solid fa-clock"></i> 待检测</span>';
      }

      const p = acc.provider || 'microsoft';
      const providerBadge = p === 'google'
        ? '<span class="provider-badge google"><i class="fa-brands fa-google"></i> Gmail</span>'
        : '<span class="provider-badge microsoft"><i class="fa-brands fa-microsoft"></i> Outlook</span>';

      const shortNote = acc.note ? (acc.note.length > 25 ? acc.note.substr(0, 25) + '...' : acc.note) : '无';

      let extraAction = '';
      if (p === 'google') {
        extraAction = `<button class="btn btn-outline btn-sm btn-oauth-google" data-id="${acc.id}" title="打开网页跳转谷歌授权获取 OAuth2 Token" style="color: #f87171; border-color: rgba(239,68,68,0.4);"><i class="fa-brands fa-google"></i> 授权</button>`;
      } else {
        extraAction = `<button class="btn btn-outline btn-sm btn-oauth-ms" data-id="${acc.id}" title="打开网页跳转微软官方登录获取 OAuth2 Token" style="color: #60a5fa; border-color: rgba(96,165,250,0.4);"><i class="fa-brands fa-microsoft"></i> 授权</button>`;
      }

      tr.innerHTML = `
        <td><input type="checkbox" class="acc-checkbox" data-id="${acc.id}" ${isChecked}></td>
        <td>${index + 1}</td>
        <td>${providerBadge}</td>
        <td style="font-weight: 600; color: #fff;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span onclick="copyToClipboard('${acc.username}', '邮箱账号')" title="点击直接复制邮箱账号" style="cursor: pointer; font-size: 14px; color: #60a5fa; font-weight: 600; text-decoration: underline; text-decoration-color: rgba(96,165,250,0.3); text-underline-offset: 3px;" onmouseover="this.style.color='#93c5fd'" onmouseout="this.style.color='#60a5fa'">
              ${acc.username}
            </span>
            <button class="btn btn-primary btn-sm" style="padding: 3px 10px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #2563eb, #3b82f6); border: none; border-radius: 6px; color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(37,99,235,0.3);" onclick="copyToClipboard('${acc.username}', '邮箱账号')" title="点击复制邮箱账号">
              <i class="fa-regular fa-copy"></i> 复制
            </button>
          </div>
        </td>
        <td>
          ${acc.password ? `
            <span id="pass-${acc.id}" data-password="${acc.password}" data-masked="true" class="code-font" style="font-size: 14px;">••••••••</span>
            <button class="btn btn-outline btn-sm" style="padding: 3px 8px; margin-left: 4px; font-size: 12px;" onclick="togglePassword('${acc.id}')" title="显示/隐藏密码">
              <i id="eye-${acc.id}" class="fa-solid fa-eye"></i>
            </button>
            <button class="btn btn-primary btn-sm" style="padding: 3px 10px; margin-left: 4px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #d97706, #f59e0b); border: none; border-radius: 6px; color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(217,119,6,0.3);" onclick="copyToClipboard('${acc.password}', '密码')" title="复制密码">
              <i class="fa-regular fa-copy"></i> 复制
            </button>
            <button class="btn btn-outline btn-sm" style="padding: 3px 8px; margin-left: 4px; font-size: 12px;" onclick="editPassword('${acc.id}', '${acc.password}')" title="修改密码">
              <i class="fa-solid fa-pen"></i>
            </button>
          ` : `
            <span onclick="editPassword('${acc.id}', '')" style="cursor: pointer; color: #f59e0b; font-size: 13px;">
              <i class="fa-solid fa-pen-to-square"></i> 点击补充密码
            </span>
          `}
        </td>
        <td>${statusBadge}</td>
        <td title="${acc.note}"><span class="code-font">${shortNote}</span></td>
        <td><span style="font-size: 12px; color: var(--text-muted);">${new Date(acc.lastChecked).toLocaleString()}</span></td>
        <td style="text-align: right;">
          <button class="btn btn-primary btn-sm btn-fetch-single" data-id="${acc.id}" title="自动取件">
            <i class="fa-solid fa-bolt"></i> 取件
          </button>
          ${extraAction}
          <button class="btn btn-secondary btn-sm btn-check-single" data-id="${acc.id}" title="在线检测">
            <i class="fa-solid fa-heart-pulse"></i>
          </button>
          <button class="btn btn-danger btn-sm btn-delete-single" data-id="${acc.id}" title="删除">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    document.querySelectorAll('.acc-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        if (e.target.checked) selectedAccountIds.add(id);
        else selectedAccountIds.delete(id);
      });
    });

    document.querySelectorAll('.btn-fetch-single').forEach(btn => {
      btn.addEventListener('click', () => fetchMailSingle(btn.getAttribute('data-id')));
    });

    document.querySelectorAll('.btn-oauth-google').forEach(btn => {
      btn.addEventListener('click', () => openGoogleAuthPopup(btn.getAttribute('data-id')));
    });

    document.querySelectorAll('.btn-oauth-ms').forEach(btn => {
      btn.addEventListener('click', () => openMicrosoftAuthPopup(btn.getAttribute('data-id')));
    });

    document.querySelectorAll('.btn-check-single').forEach(btn => {
      btn.addEventListener('click', () => checkStatusSingle(btn.getAttribute('data-id')));
    });

    document.querySelectorAll('.btn-delete-single').forEach(btn => {
      btn.addEventListener('click', () => deleteAccountSingle(btn.getAttribute('data-id')));
    });
  }

  function openGoogleAuthPopup(accId) {
    const width = 600;
    const height = 700;
    const left = (window.screen.width / 2) - (width / 2);
    const top = (window.screen.height / 2) - (height / 2);
    
    showToast('正在打开谷歌官方 OAuth2 授权登录窗口...', 'info');
    window.open(`/auth/google/login?id=${accId}`, 'google_oauth_popup', `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`);
  }

  let deviceCodePollTimer = null;

  async function openMicrosoftAuthPopup(accId) {
    if (deviceCodePollTimer) clearInterval(deviceCodePollTimer);

    showToast('正在向微软发起官方设备授权请求...', 'info');

    try {
      const res = await fetch('/api/auth/microsoft/device-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();

      if (data.success && data.userCode) {
        document.getElementById('ms-user-code').textContent = data.userCode;
        document.getElementById('ms-verify-link').href = data.verificationUri || 'https://microsoft.com/devicelogin';
        document.getElementById('ms-poll-status').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在等待您在网页中输入验证码完成授权...';
        
        document.getElementById('modal-ms-device').style.display = 'flex';

        // Auto Poll every 3 seconds
        deviceCodePollTimer = setInterval(async () => {
          try {
            const pollRes = await fetch('/api/auth/microsoft/poll-device-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accountId: accId, deviceCode: data.deviceCode })
            });
            const pollData = await pollRes.json();

            if (pollData.success && pollData.status === 'completed') {
              clearInterval(deviceCodePollTimer);
              deviceCodePollTimer = null;

              document.getElementById('ms-poll-status').innerHTML = '<span style="color: #10b981; font-weight: bold;"><i class="fa-solid fa-circle-check"></i> 🎉 授权成功！已绑定保存！</span>';
              showToast(`🎉 微软账号 [${pollData.account.username}] 授权成功！`, 'success');
              
              setTimeout(() => {
                document.getElementById('modal-ms-device').style.display = 'none';
                loadAccounts();
              }, 1200);
            } else if (pollData.status === 'failed') {
              clearInterval(deviceCodePollTimer);
              deviceCodePollTimer = null;
              document.getElementById('ms-poll-status').innerHTML = `<span style="color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> 授权超时或失败</span>`;
            }
          } catch(e) {}
        }, 3000);
      } else {
        showToast(data.message || '获取设备码失败', 'error');
      }
    } catch(err) {
      showToast('请求设备码网络异常', 'error');
    }
  }

  const btnCloseMsDevice = document.getElementById('btn-close-ms-device');
  if (btnCloseMsDevice) {
    btnCloseMsDevice.addEventListener('click', () => {
      if (deviceCodePollTimer) clearInterval(deviceCodePollTimer);
      document.getElementById('modal-ms-device').style.display = 'none';
    });
  }

  // --- TELEGRAM BOT SETTINGS MODAL HANDLERS ---
  const modalTgSettings = document.getElementById('modal-tg-settings');
  const btnTgSettings = document.getElementById('btn-tg-settings');
  const btnCloseTgModal = document.getElementById('btn-close-tg-modal');
  const btnSaveTgConfig = document.getElementById('btn-save-tg-config');
  const btnTestTgPush = document.getElementById('btn-test-tg-push');

  if (btnTgSettings) {
    btnTgSettings.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/tg/config');
        const data = await res.json();
        if (data.success && data.tgConfig) {
          document.getElementById('tg-token-input').value = data.tgConfig.token || '';
          document.getElementById('tg-chatid-input').value = data.tgConfig.chatId || '';
          document.getElementById('tg-enabled-toggle').checked = !!data.tgConfig.enabled;
          document.getElementById('tg-poll-interval').value = data.tgConfig.autoPollInterval || 2;
        }
      } catch (e) {}
      modalTgSettings.style.display = 'flex';
    });
  }

  if (btnCloseTgModal) {
    btnCloseTgModal.addEventListener('click', () => {
      modalTgSettings.style.display = 'none';
    });
  }

  if (btnSaveTgConfig) {
    btnSaveTgConfig.addEventListener('click', async () => {
      const token = document.getElementById('tg-token-input').value.trim();
      const chatId = document.getElementById('tg-chatid-input').value.trim();
      const enabled = document.getElementById('tg-enabled-toggle').checked;
      const interval = document.getElementById('tg-poll-interval').value;

      try {
        const res = await fetch('/api/tg/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, chatId, enabled, autoPollInterval: interval })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Telegram 推送及 2 秒极速自动轮询配置已保存！', 'success');
          modalTgSettings.style.display = 'none';
        }
      } catch (err) {
        showToast('保存 TG 配置失败', 'error');
      }
    });
  }

  if (btnTestTgPush) {
    btnTestTgPush.addEventListener('click', async () => {
      const token = document.getElementById('tg-token-input').value.trim();
      const chatId = document.getElementById('tg-chatid-input').value.trim();

      showToast('正在向 Telegram 发起测试推送...', 'info');
      try {
        const res = await fetch('/api/tg/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, chatId })
        });
        const data = await res.json();
        if (data.success) {
          showToast('测试消息已成功推送至您的 Telegram 账户！', 'success');
        } else {
          showToast(`TG 推送失败: ${data.message}`, 'error');
        }
      } catch (err) {
        showToast('测试接口调用失败', 'error');
      }
    });
  }

  document.getElementById('select-all').addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('.acc-checkbox').forEach(cb => {
      cb.checked = checked;
      const id = cb.getAttribute('data-id');
      if (checked) selectedAccountIds.add(id);
      else selectedAccountIds.delete(id);
    });
  });

  document.getElementById('search-account').addEventListener('input', applyFilters);

  // Quick Add Outlook Tool Handler
  const btnAddOutlookTool = document.getElementById('btn-add-outlook-tool');
  if (btnAddOutlookTool) {
    btnAddOutlookTool.addEventListener('click', async () => {
      const email = prompt('请输入 Outlook/Hotmail 邮箱地址（例如 test@outlook.com，留空将发起直接网页登录授权）：');
      if (email === null) return;

      try {
        const res = await fetch('/api/accounts/add-outlook-tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: email })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`正在打开微软官方网页授权登录...`, 'info');
          document.querySelector('[data-provider="microsoft"]').click();
          loadAccounts();
          openMicrosoftAuthPopup(data.account.id);
        }
      } catch (err) {
        showToast('工具调用失败', 'error');
      }
    });
  }

  // Quick Add Gmail Tool Handlers
  async function addGmailAccountTool(isMock = false) {
    let email = '';
    if (!isMock) {
      email = prompt('请输入 Gmail 邮箱地址（例如 your_name@gmail.com）：');
      if (email === null) return;
    }

    try {
      const res = await fetch('/api/accounts/add-gmail-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: email,
          isMock: isMock,
          note: isMock ? 'Google OAuth2 Token (演示账号)' : 'Gmail App Password / OAuth'
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`成功添加 Gmail 账号 [${data.account.username}]！`, 'success');
        document.querySelector('[data-provider="google"]').click();
        loadAccounts();

        if (!isMock) {
          openGoogleAuthPopup(data.account.id);
        }
      } else {
        showToast(data.message || '添加失败', 'error');
      }
    } catch (err) {
      showToast('快捷工具调用失败', 'error');
    }
  }

  const btnAddGmailTool = document.getElementById('btn-add-gmail-tool');
  if (btnAddGmailTool) {
    btnAddGmailTool.addEventListener('click', () => addGmailAccountTool(false));
  }

  const btnGenGmailDemo = document.getElementById('btn-generate-gmail-demo');
  if (btnGenGmailDemo) {
    btnGenGmailDemo.addEventListener('click', () => addGmailAccountTool(true));
  }

  async function sendTestMailSingle(id, email) {
    const target = prompt('请输入接收测试邮件的邮箱（默认发送给自己）：', email);
    if (target === null) return;

    showToast(`正在通过账号发起测试邮件发送...`, 'info');
    try {
      const res = await fetch('/api/accounts/send-test-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromId: id, targetEmail: target })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`测试邮件已发送成功！随机验证码为: ${data.testCode}`, 'success');
        
        setTimeout(() => {
          fetch('/api/accounts/fetch-mail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [] })
          }).then(r => r.json()).then(d => {
            if (d.success) {
              loadAccounts();
              loadMails();
            }
          }).catch(e => {});
        }, 3000);
      } else {
        showToast(data.message || '发送失败', 'error');
      }
    } catch (err) {
      showToast('发送接口异常', 'error');
    }
  }

  const btnSendTest = document.getElementById('btn-send-test');
  if (btnSendTest) {
    btnSendTest.addEventListener('click', () => {
      const activeAcc = currentAccounts.find(a => a.status === 'active' && a.provider === 'microsoft');
      if (!activeAcc) {
        showToast('没有可用的微软活跃账号来发送测试邮件', 'error');
        return;
      }
      sendTestMailSingle(activeAcc.id, activeAcc.username);
    });
  }

  async function fetchMailSingle(id) {
    showToast('正在发起官方接口取件...', 'info');
    try {
      const res = await fetch('/api/accounts/fetch-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`取件完成，提取到 ${data.fetchedCount} 封邮件消息`, 'success');
        loadAccounts();
        loadMails();
      }
    } catch (err) {
      showToast('取件失败', 'error');
    }
  }

  async function checkStatusSingle(id) {
    showToast('正在向官方服务器发起活跃校验...', 'info');
    try {
      const res = await fetch('/api/accounts/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] })
      });
      const data = await res.json();
      if (data.success) {
        loadAccounts();
        showToast('官方状态校验完成！', 'success');
      }
    } catch (err) {
      showToast('检测失败', 'error');
    }
  }

  async function deleteAccountSingle(id) {
    if (!confirm('确定要删除该账号吗？')) return;
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('已删除', 'success');
        selectedAccountIds.delete(id);
        loadAccounts();
      }
    } catch (err) {
      showToast('删除失败', 'error');
    }
  }

  document.getElementById('btn-batch-fetch').addEventListener('click', async () => {
    const ids = Array.from(selectedAccountIds);
    showToast(`开始针对 ${ids.length > 0 ? ids.length : '全部'} 个账号发起取件...`, 'info');
    try {
      const res = await fetch('/api/accounts/fetch-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`批量取件完成！提取到 ${data.fetchedCount} 封新邮件`, 'success');
        loadAccounts();
        loadMails();
      }
    } catch (err) {
      showToast('批量取件失败', 'error');
    }
  });

  document.getElementById('btn-quick-fetch').addEventListener('click', () => {
    document.getElementById('btn-batch-fetch').click();
  });

  document.getElementById('btn-batch-check').addEventListener('click', async () => {
    const ids = Array.from(selectedAccountIds);
    showToast('正在向官方服务器批量发起校验...', 'info');
    try {
      const res = await fetch('/api/accounts/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`官方校验完成！刷新了 ${data.checkedCount} 个账号的状态`, 'success');
        loadAccounts();
      }
    } catch (err) {
      showToast('检测失败', 'error');
    }
  });

  document.getElementById('btn-batch-delete').addEventListener('click', async () => {
    const ids = Array.from(selectedAccountIds);
    if (ids.length === 0) {
      showToast('请先勾选要删除的账号', 'error');
      return;
    }
    if (!confirm(`确定要删除选中的 ${ids.length} 个账号吗？`)) return;

    try {
      const res = await fetch('/api/accounts/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`成功删除 ${ids.length} 个账号`, 'success');
        selectedAccountIds.clear();
        loadAccounts();
      }
    } catch (err) {
      showToast('删除失败', 'error');
    }
  });

  document.getElementById('btn-batch-export').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      let listToExport = data.accounts || currentAccounts;

      if (selectedAccountIds.size > 0) {
        listToExport = listToExport.filter(a => selectedAccountIds.has(a.id));
      }

      let csvRows = ['name,url,username,password,note,status'];
      listToExport.forEach(acc => {
        const isGg = acc.provider === 'google' || (acc.username && acc.username.toLowerCase().includes('gmail'));
        const name = isGg ? 'google' : 'microsoft';
        const url = isGg ? 'https://mail.google.com' : 'https://outlook.live.com';
        const uname = acc.username || '';
        const pwd = acc.password || '';
        const note = (acc.note || '').replace(/"/g, '""');
        const status = acc.status || 'active';

        csvRows.push(`"${name}","${url}","${uname}","${pwd}","${note}","${status}"`);
      });

      const csvString = '\uFEFF' + csvRows.join('\n');
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `mail_accounts_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast(`已成功导出 ${listToExport.length} 条带密码账号 (适配 Chrome 自动填充)`, 'success');
    } catch(e) {
      showToast('导出 CSV 失败', 'error');
    }
  });

  document.getElementById('btn-submit-import').addEventListener('click', async () => {
    const text = document.getElementById('import-text').value.trim();
    if (!text) {
      showToast('请输入要导入的内容', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`批量处理完成！新增 ${data.addedCount || 0} 个账号，更新 ${data.updatedCount || 0} 个已有账号。`, 'success');
        document.getElementById('import-text').value = '';
        document.querySelector('[data-tab="tab-accounts"]').click();
        loadAccounts();
      }
    } catch (err) {
      showToast('导入失败', 'error');
    }
  });

  async function loadMails() {
    try {
      const res = await fetch('/api/mails');
      const data = await res.json();
      if (data.success) {
        currentMails = data.mails;
        renderMailFeed(currentMails);
      }
    } catch (err) {
      console.error('获取邮件失败', err);
    }
  }

  function renderMailFeed(mails) {
    const container = document.getElementById('mail-feed-container');
    container.innerHTML = '';

    if (mails.length === 0) {
      container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px;">暂无验证码邮件。系统已开启 2 秒全自动探查取件与 TG 推送。</div>`;
      return;
    }

    mails.forEach(mail => {
      const card = document.createElement('div');
      card.className = 'code-card';

      const codeText = mail.code || '未发现验证码';
      const codeTypeBadge = mail.codeType ? `<span class="code-type-tag">${mail.codeType}</span>` : '';
      const mailContent = mail.content || mail.preview || '无正文内容';

      const providerBadge = mail.provider === 'google'
        ? '<span class="provider-badge google"><i class="fa-brands fa-google"></i> Gmail</span>'
        : '<span class="provider-badge microsoft"><i class="fa-brands fa-microsoft"></i> Outlook</span>';

      const safeAccount = escapeHtml(mail.account || '');
      const safeSender = escapeHtml(mail.sender || '');
      const safeSubject = escapeHtml(mail.subject || '');
      const safeCodeText = escapeHtml(codeText || '');

      let linksHtml = '';
      if (mail.links && mail.links.length > 0) {
        linksHtml += `<div class="link-box-title"><i class="fa-solid fa-link text-primary"></i> 智能提取验证/激活链接：</div><div class="link-list">`;
        mail.links.forEach((link, idx) => {
          const safeLink = escapeHtml(link);
          const encodedLink = encodeURI(link);
          linksHtml += `
            <div class="link-item">
              <span class="link-url" title="${safeLink}">${safeLink}</span>
              <div class="link-actions">
                <button class="btn btn-outline btn-sm" onclick="copyToClipboard('${safeLink.replace(/'/g, "\\'")}', '验证链接')"><i class="fa-regular fa-copy"></i> 复制</button>
                <a href="${encodedLink}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm"><i class="fa-solid fa-arrow-up-right-from-square"></i> 打开</a>
              </div>
            </div>
          `;
        });
        linksHtml += `</div>`;
      }

      card.innerHTML = `
        <div style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span>${providerBadge} <strong style="margin-left: 4px;">${safeAccount}</strong></span>
          ${codeTypeBadge}
        </div>
        <div class="code-badge-box">
          <span class="giant-code">${safeCodeText}</span>
          <button class="btn-copy" onclick="copyToClipboard('${safeCodeText.replace(/'/g, "\\'")}', '验证码')">
            <i class="fa-regular fa-copy"></i> 复制验证码
          </button>
        </div>
        ${linksHtml}
        <div class="mail-meta">
          <span><strong>发件人：</strong> ${safeSender}</span>
          <span><strong>主题：</strong> ${safeSubject}</span>
          <span><strong>收取时间：</strong> ${new Date(mail.receivedAt).toLocaleString()}</span>
        </div>
        <div class="mail-body-label"><i class="fa-solid fa-align-left"></i> 完整邮件正文内容：</div>
        <div class="mail-full-body">${escapeHtml(mailContent)}</div>
      `;

      container.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  document.getElementById('btn-clear-mails').addEventListener('click', async () => {
    if (!confirm('确定要清空历史邮件数据吗？')) return;
    try {
      await fetch('/api/mails/clear', { method: 'POST' });
      showToast('历史邮件已清空', 'success');
      loadMails();
      loadStats();
    } catch (err) {
      showToast('清空失败', 'error');
    }
  });

  document.getElementById('btn-global-refresh').addEventListener('click', () => {
    loadAccounts();
    loadMails();
    showToast('数据已同步', 'success');
  });

  loadAccounts();
  loadMails();

  window.exportMsTxt = function() {
    showToast('正在导出微软邮箱账号密码...', 'info');
    window.location.href = '/api/export-ms-txt';
  };

  // AUTOMATIC 1-SECOND FRONTEND REFRESH LOOP
  setInterval(() => {
    loadAccounts();
    loadMails();
  }, 1000);
});
