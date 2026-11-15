'use strict';
const $ = s => typeof document !== 'undefined' && document ? document.querySelector(s) : null;
const $$ = s => typeof document !== 'undefined' && document ? [...document.querySelectorAll(s)] : [];
let currentUser = null, data = null, selectedAccount = '', currentPage = 'overview';
const escapeHtml = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = x => Number(x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = x => new Date(x * 1000).toLocaleString('vi-VN');

async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const d = await r.json();
  if (!r.ok) throw Error(typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail));
  return d;
}

function notice(text) {
  const el = $('#notice');
  if (el) {
    el.hidden = false;
    el.textContent = text;
  }
}

async function action(fn) {
  try { await fn(); } catch (e) { notice(e.message); }
}

async function load() {
  data = await api('/dashboard');
  render();
  if (currentUser.role === 'admin' && (currentPage === 'lab' || currentPage === 'monitor')) {
    await loadAdmin();
  }
}

const pages = {
  overview: ['Tổng quan', 'Một góc nhìn. Toàn bộ danh mục.'],
  accounts: ['Tài khoản & EA', 'Kết nối có kiểm soát.'],
  orders: ['Nhật ký lệnh', 'Mọi tín hiệu đều có dấu vết.'],
  assistant: ['Trợ lý cá nhân', 'Trợ lý đàm thoại Vercel AI SDK 6 & Generative UI.'],
  lab: ['Research Lab', 'Hàng đợi phê duyệt ToolLoopAgent & LangGraph WFO.'],
  monitor: ['Giám sát hệ thống', 'TimescaleDB + Redis + LangSmith Tracing.']
};

function navigate(page) {
  currentPage = page;
  $$('.page').forEach(x => x.hidden = x.id !== page);
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('#page-name').textContent = pages[page][0];
  $('#page-title').textContent = pages[page][1];
  action(load);
}

function table(headers, rows) {
  return rows.length
    ? `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<div class="empty">Chưa có dữ liệu. Tạo tài khoản Replay và bật copy để bắt đầu.</div>';
}

function badge(s) {
  return `<span class="badge ${['unknown', 'waiting_approval', 'paused'].includes(s) ? 'warn' : ''}">${escapeHtml(s).toUpperCase()}</span>`;
}

function render() {
  const a = data.accounts;
  const stats = [
    ['Tổng Balance', money(a.reduce((s, x) => s + x.balance, 0)), 'TimescaleDB snapshot / Postgres'],
    ['Tổng Equity', money(a.reduce((s, x) => s + x.equity, 0)), 'Vốn thả nổi cập nhật thời gian thực'],
    ['Copy đang bật', `${a.filter(x => x.enabled).length} / ${a.length}`, 'Redis Stream & Pub/Sub'],
    ['Chờ đối soát', data.orders.filter(x => ['unknown', 'intent'].includes(x.state)).length, 'Distributed Lock bảo vệ']
  ];
  $('#stats').innerHTML = stats.map(([l, v, n]) => `
    <div class="stat">
      <span class="stat-icon">↗</span>
      <div class="stat-label">${l}</div>
      <div class="stat-value">${v}</div>
      <small>${n}</small>
    </div>
  `).join('');

  if (!a.some(x => x.id === selectedAccount)) selectedAccount = a[0]?.id || '';
  $('#chart-account').innerHTML = a.map(x => `<option value="${x.id}" ${x.id === selectedAccount ? 'selected' : ''}>${escapeHtml(x.mode + ' · ' + x.login)}</option>`).join('');
  chart();

  for (const [id, key] of [['execution-state', 'execution_heartbeat'], ['research-state', 'research_heartbeat']]) {
    $('#' + id).textContent = Date.now() / 1000 - Number(data.health[key] || 0) < 20
      ? 'Online · Redis heartbeat đồng bộ'
      : 'Chưa có heartbeat / offline';
  }

  $('#orders-table').innerHTML = table(
    ['ID / NGUỒN', 'CHIỀU', 'GIÁ TÍN HIỆU', 'TRẠNG THÁI', 'ORDER / DEAL', 'THỜI ĐIỂM'],
    data.orders.map(d => [
      escapeHtml(d.id) + ' / ' + badge(d.source),
      escapeHtml(d.side),
      money(d.price),
      badge(d.state),
      escapeHtml(d.ticket || '—') + ' / ' + escapeHtml(d.deal || '—'),
      date(d.created)
    ])
  );

  $('#account-list').innerHTML = a.map(x => `
    <article class="card" data-account="${x.id}">
      <div class="account-head">
        <div>
          <h2>${escapeHtml(x.login)} <span class="badge">${x.mode}</span></h2>
          <small>${escapeHtml(x.server)} · ${x.seen ? date(x.seen) : 'Chưa có heartbeat'} ${x.cached_heartbeat ? '· Redis Cache: OK' : ''}</small>
        </div>
        ${badge(x.enabled ? 'copy on' : 'paused')}
      </div>
      <form class="risk-form">
        <label>Rủi ro / lệnh (%)<input name="risk" type="number" min="0.01" max="1" step="0.01" value="${x.risk}" required></label>
        <label>Spread tối đa ($/oz)<input name="max_spread" type="number" min="0.01" max="2" step="0.01" value="${x.max_spread}" required></label>
        <label>Số lệnh tối đa<input name="max_positions" type="number" min="1" max="3" value="${x.max_positions}" required></label>
        <label>Drawdown tối đa (%)<input name="max_dd" type="number" min="1" max="20" step="0.1" value="${x.max_dd}" required></label>
        <button type="submit">Lưu giới hạn</button>
      </form>
      <div class="account-actions">
        <button class="primary toggle">${x.enabled ? 'Tạm dừng copy' : 'Bật copy'}</button>
        ${x.mode === 'DEMO' ? '<button class="pair">Lấy mã ghép nối</button><button class="revoke">Thu hồi EA</button>' : ''}
        <span class="fine muted">Balance ${money(x.balance)} · Equity ${money(x.equity)}</span>
      </div>
      <div class="pair-result"></div>
    </article>
  `).join('');

  $$('[data-account]').forEach(card => {
    const x = a.find(x => x.id === card.dataset.account), form = card.querySelector('form');
    const values = () => ({ ...Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, Number(v)])), enabled: !!x.enabled });
    form.onsubmit = e => {
      e.preventDefault();
      action(async () => {
        await api(`/accounts/${x.id}/risk`, 'PUT', values());
        notice('Đã lưu giới hạn.');
        await load();
      });
    };
    card.querySelector('.toggle').onclick = () => action(async () => {
      await api(`/accounts/${x.id}/risk`, 'PUT', { ...values(), enabled: !x.enabled });
      await load();
    });
    const pair = card.querySelector('.pair');
    if (pair) pair.onclick = () => action(async () => {
      const p = await api(`/accounts/${x.id}/pair`, 'POST');
      const el = card.querySelector('.pair-result');
      el.className = 'pair-result code';
      el.textContent = `Mã dùng một lần (5 phút): ${p.code}`;
    });
    const revoke = card.querySelector('.revoke');
    if (revoke) revoke.onclick = () => action(async () => {
      await api(`/accounts/${x.id}/revoke`, 'POST');
      notice('Đã thu hồi credential và tạm dừng copy.');
      await load();
    });
  });
}

function chart() {
  const s = data.series.filter(x => x.account_id === selectedAccount), svg = $('#equity-chart');
  $('#chart-source').textContent = data.accounts.find(x => x.id === selectedAccount)?.mode === 'REPLAY' ? 'SYNTHETIC REPLAY' : 'MT5 DEMO (TimescaleDB)';
  if (s.length < 2) {
    svg.innerHTML = '<text x="380" y="115" text-anchor="middle" fill="#8196a8" font-size="13">Chờ dữ liệu tài khoản • tạo Replay để bắt đầu</text>';
    return;
  }
  const min = Math.min(...s.flatMap(x => [x.equity, x.balance])) - 5, max = Math.max(...s.flatMap(x => [x.equity, x.balance])) + 5;
  const pts = k => s.map((v, i) => `${45 + i / (s.length - 1) * 700},${200 - (v[k] - min) / (max - min) * 175}`).join(' ');
  svg.innerHTML = [0, .25, .5, .75, 1].map(t => `
    <line x1="45" x2="745" y1="${200 - t * 175}" y2="${200 - t * 175}" stroke="#23313e" stroke-dasharray="3 5"/>
    <text x="1" y="${204 - t * 175}" fill="#6f8597" font-size="9">${Math.round(min + t * (max - min))}</text>
  `).join('') + `
    <polyline points="${pts('balance')}" fill="none" stroke="#6888bf" stroke-width="1.5"/>
    <polyline points="${pts('equity')}" fill="none" stroke="#5ce4c1" stroke-width="2.5"/>
  `;
  $('#chart-time').textContent = date(s.at(-1).ts);
}

// ---------------------------------------------------------------------------
// Admin Monitoring, LangSmith Tracing & ToolLoopAgent Approval Queue
// ---------------------------------------------------------------------------

async function loadAdmin() {
  const m = await api('/admin/monitor');
  const tracing = await api('/admin/tracing').catch(() => ({ langsmith_configured: false, recent_traces: [] }));

  $('#monitor-accounts').innerHTML = table(
    ['CHỦ SỞ HỮU', 'MT5 / SERVER', 'MODE', 'EQUITY', 'COPY', 'HEARTBEAT'],
    m.accounts.map(x => [
      escapeHtml(x.email),
      escapeHtml(x.login + ' / ' + x.server),
      badge(x.mode),
      money(x.equity),
      badge(x.enabled ? 'enabled' : 'paused'),
      x.seen ? date(x.seen) : '—'
    ])
  );

  $('#audit').innerHTML = table(
    ['THỜI ĐIỂM', 'ACTOR', 'SỰ KIỆN', 'CHI TIẾT'],
    m.audit.map(x => [
      date(x.ts),
      escapeHtml(x.actor.slice(0, 12)),
      escapeHtml(x.event),
      escapeHtml(x.detail)
    ])
  );

  // Vercel AI SDK 6 ToolLoopAgent Strategy Approval Queue Rendering
  $('#jobs').innerHTML = m.jobs.map(j => {
    let resultObj = null;
    try { if (j.result) resultObj = JSON.parse(j.result); } catch {}
    const report = resultObj?.report || {};
    const isWaiting = j.state === 'waiting_approval';

    return `
      <div class="card ${isWaiting ? 'border-amber' : ''}" style="margin-bottom:12px;padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <b>Ứng viên #${escapeHtml(j.id.slice(0, 10))}</b> · ${badge(j.state)}
            ${isWaiting ? '<span class="badge warn" style="margin-left:6px;">needsApproval: true</span>' : ''}
          </div>
          <small class="muted">${date(j.created)}</small>
        </div>
        ${report.oos_net_price_units !== undefined ? `
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;font-family:monospace;font-size:11px;">
            <div style="background:#080d1a;padding:6px;border-radius:4px;">
              <span class="muted">OOS Net PnL:</span> <b style="color:#5ce4c1;">${report.oos_net_price_units} pts</b>
            </div>
            <div style="background:#080d1a;padding:6px;border-radius:4px;">
              <span class="muted">Max DD:</span> <b style="color:#f43f5e;">${report.max_drawdown_price_units} pts</b>
            </div>
            <div style="background:#080d1a;padding:6px;border-radius:4px;">
              <span class="muted">Folds:</span> <b>${report.folds?.length || 13}</b>
            </div>
          </div>
        ` : ''}
        <details>
          <summary class="muted" style="cursor:pointer;font-size:11px;">Xem chi tiết báo cáo JSON</summary>
          <pre style="max-height:150px;overflow:auto;font-size:10px;">${escapeHtml(j.result ? JSON.stringify(resultObj, null, 2) : j.error || 'Đang xử lý...')}</pre>
        </details>
        ${isWaiting ? `
          <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
            <button data-job="${j.id}" data-approved="false" style="background:#3f1422;color:#fca5a5;border:1px solid #7f1d1d;">Từ chối (Reject)</button>
            <button data-job="${j.id}" data-approved="true" class="primary" style="background:#10b981;color:#052e16;">Phê duyệt (Approve)</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('') || '<p class="muted">Chưa có lượt nghiên cứu.</p>';

  $$('[data-job]').forEach(b => b.onclick = () => action(async () => {
    await api(`/admin/research/${b.dataset.job}/decision`, 'POST', { approved: b.dataset.approved === 'true' });
    notice(`Đã ghi nhận quyết định: ${b.dataset.approved === 'true' ? 'Phê duyệt' : 'Từ chối'}`);
    await loadAdmin();
  }));

  $('#news-list').innerHTML = table(
    ['SỰ KIỆN', 'THỜI ĐIỂM', 'TÁC ĐỘNG'],
    m.news.map(n => [escapeHtml(n.title), date(n.ts), badge(n.impact)])
  );
}

// ---------------------------------------------------------------------------
// Vercel AI SDK 6 Streaming Chat & Generative UI Consumer
// ---------------------------------------------------------------------------

async function askVercelAssistant(question) {
  const answerEl = $('#answer');
  if (!answerEl) return;
  answerEl.innerHTML = '<span class="muted">Đang kết nối luồng Vercel AI SDK 6...</span>';

  try {
    const res = await fetch('/api/chat/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zupirus': '1' },
      body: JSON.stringify({ messages: [{ role: 'user', content: question }] })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let text = '';
    let toolWidgetHtml = '';
    const processLine = (line) => {
      if (line.startsWith('0:')) {
        text += JSON.parse(line.slice(2));
      } else if (line.startsWith('9:')) {
        const toolCall = JSON.parse(line.slice(2));
        if (toolCall.toolName === 'renderPortfolioCard') {
          const p = toolCall.args;
          toolWidgetHtml = `
            <div style="margin-top:10px;padding:10px;background:#080d1a;border:1px solid #06b6d4;border-radius:8px;font-family:monospace;font-size:11px;">
              <div style="color:#06b6d4;font-weight:bold;margin-bottom:6px;">📊 Generative UI · Thẻ Danh Mục Tài Khoản</div>
              <div>Tổng Balance: <b>$${p.totalBalance?.toLocaleString()}</b></div>
              <div>Tổng Equity: <b>$${p.totalEquity?.toLocaleString()}</b></div>
              <div class="muted">Số tài khoản: ${p.accountsCount}</div>
            </div>
          `;
        }
      }
    };

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) processLine(line);
        }
        answerEl.innerHTML = `<div>${escapeHtml(text)}</div>${toolWidgetHtml}`;
      }
      if (buffer.trim()) {
        processLine(buffer);
        answerEl.innerHTML = `<div>${escapeHtml(text)}</div>${toolWidgetHtml}`;
      }
    } else {
      const raw = await res.text();
      for (const line of raw.split('\n')) {
        if (line.trim()) processLine(line);
      }
      answerEl.innerHTML = `<div>${escapeHtml(text)}</div>${toolWidgetHtml}`;
    }
    if (!text) throw new Error('Empty stream');
  } catch (err) {
    // Graceful fallback to standard assistant
    const r = await api('/assistant', 'POST', { question });
    answerEl.textContent = (r.ai ? 'AI · ' : 'Trợ lý quy tắc · ') + r.text;
  }
}

async function enter() {
  currentUser = await api('/me');
  $('#auth').hidden = true;
  $('#shell').hidden = false;
  $('#user-email').textContent = currentUser.email;
  $$('.admin-only').forEach(x => x.hidden = currentUser.role !== 'admin');
  $('#portal-label').textContent = location.hostname.startsWith('adm.') ? 'ADMIN & QUANT TERMINAL' : 'CLIENT TERMINAL';
  await load();
}

$('#login-form').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('/login', 'POST', { email: $('#email').value, password: $('#password').value });
    await enter();
  } catch (err) {
    $('#auth-message').textContent = err.message;
  }
};

$('#register').onclick = async () => {
  try {
    await api('/register', 'POST', { email: $('#email').value, password: $('#password').value });
    $('#auth-message').textContent = 'Đăng ký thành công. Bạn có thể đăng nhập.';
  } catch (e) {
    $('#auth-message').textContent = e.message;
  }
};

$('#logout').onclick = () => action(async () => {
  await api('/logout', 'POST');
  location.reload();
});

$$('nav button').forEach(b => b.onclick = () => navigate(b.dataset.page));
$('#refresh').onclick = () => action(load);
$('#chart-account').onchange = e => {
  selectedAccount = e.target.value;
  chart();
};

for (const id of ['quick-replay', 'new-replay']) {
  $('#' + id).onclick = () => action(async () => {
    await api('/replay', 'POST');
    navigate('accounts');
  });
}

$('#account-form').onsubmit = e => {
  e.preventDefault();
  action(async () => {
    await api('/accounts', 'POST', { ...Object.fromEntries(new FormData(e.target)), mode: 'DEMO' });
    e.target.reset();
    await load();
  });
};

$('#ask-form').onsubmit = e => {
  e.preventDefault();
  action(async () => {
    await askVercelAssistant($('#question').value);
  });
};

$('#run-research').onclick = () => action(async () => {
  await api('/admin/research', 'POST');
  notice('Đã xếp hàng nghiên cứu. LangGraph worker sẽ dừng ở bước chờ Admin duyệt (needsApproval: true).');
  await loadAdmin();
});

$('#news-form').onsubmit = e => {
  e.preventDefault();
  action(async () => {
    const f = new FormData(e.target);
    await api('/admin/news', 'POST', {
      title: f.get('title'),
      ts: new Date(f.get('when')).getTime() / 1000,
      currency: 'USD',
      impact: 'high'
    });
    e.target.reset();
    await loadAdmin();
  });
};

$('#vision-form').onsubmit = e => {
  e.preventDefault();
  action(async () => {
    const file = $('#vision-file').files[0];
    if (file.size > 1800000) throw Error('Ảnh tối đa 1.8 MB');
    const image = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    $('#vision-result').textContent = 'Đang phân tích…';
    const result = await api('/admin/vision', 'POST', { image });
    $('#vision-result').textContent = result.text;
  });
};

for (const [id, halted] of [["halt-system", true], ["release-system", false]]) {
  $("#" + id).onclick = () => action(async () => {
    await api("/admin/safety", "POST", { halted });
    notice(halted ? "Đã dừng toàn hệ thống; lệnh đã gửi vẫn được đối soát." : "Đã gỡ khóa. Mỗi khách cần bật lại copy cho tài khoản đã dừng.");
    await load();
  });
}

// Observational auto-refresh
setInterval(() => {
  if (currentUser && ['overview', 'orders', 'monitor', 'lab'].includes(currentPage) && !document.hidden) {
    action(load);
  }
}, 6000);

enter().catch(() => {});
